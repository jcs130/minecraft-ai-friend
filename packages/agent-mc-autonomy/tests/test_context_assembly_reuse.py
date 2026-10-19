"""Do not repeatedly project/count the same unchanged full request candidate."""
import copy
import json

import pytest

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.context_counter import FRAMING_RESERVE


class Counter:
    name = 'offline-assembly-spy'

    def __init__(self):
        self.calls = 0

    def __call__(self, messages, tools):
        self.calls += 1
        return len(json.dumps([messages, tools]).encode()) // 3


def test_fitting_full_candidate_is_projected_and_counted_once():
    counter = Counter()
    facts = {'parts': [{'key': 'body', 'text': 'health 20/20'}, {'key': 'inventoryIds', 'text': 'observed inventory ' * 100}]}
    events = [{'run': 'r', 'cursor': 1, 'text': 'actual server refusal'}]
    groups = [[{'role': 'assistant', 'content': 'previous plan'}]]
    original = copy.deepcopy((facts, events, groups))
    messages, budget = assemble('rules', [], 'survive', facts, events, groups,
        context_tokens=131072, reserved_output=8192, context_mode='full', context_counter=counter,
        native_outcomes=[{'text': 'known receipt'}, {'text': 'other receipt'}])
    assert counter.calls == 1
    expected = len(json.dumps([messages, []]).encode()) // 3
    assert budget['total'] == expected + 8192 + FRAMING_RESERVE
    assert (facts, events, groups) == original


@pytest.mark.parametrize('fail_at', [1, 2])
def test_counter_failure_restarts_the_whole_assembly_in_byte_mode(fail_at):
    class Broken(Counter):
        def __call__(self, messages, tools):
            if self.calls + 1 >= fail_at:
                raise RuntimeError('private content must not cross the diagnostic boundary')
            return super().__call__(messages, tools)

    kwargs = dict(context_tokens=12000, reserved_output=1024, context_mode='full')
    groups = [[{'role': 'assistant', 'content': str(i) * 1800}] for i in range(30)]
    expected, reference = assemble('rules', [], 'survive', {'parts': []}, [], groups, **kwargs)
    actual, budget = assemble('rules', [], 'survive', {'parts': []}, [], groups, context_counter=Broken(), **kwargs)
    assert actual == expected and budget['total'] == reference['total']
    assert budget['counter_fallback'] == 'RuntimeError'
