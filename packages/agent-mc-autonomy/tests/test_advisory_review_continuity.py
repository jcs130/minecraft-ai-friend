"""A queued host stage is not a new human interrupt of current inference."""
import dataclasses
import uuid

import pytest
from test_controller import choose, setup

from agent_mc_autonomy.mailbox import Mailbox


@pytest.mark.parametrize('origin,mode,choice', [('host_review', 'insert', 'revise'),
    ('host_review', 'insert', 'insert'), ('user', 'insert', None), ('unknown', 'insert', None),
    ('host_review', 'replace', 'insert')])
def test_actual_mailbox_distinguishes_advisory_stage_from_interrupting_feedback(
        framework_module, tmp_path, run_async, origin, mode, choice):
    request_id = str(uuid.uuid4())
    mailbox = Mailbox(tmp_path)

    async def decide(*_):
        payload = {'goal': 'Build a shelter next', 'mode': mode, 'origin': origin}
        if choice:
            payload['review_decision'] = choice
        if choice == 'revise':
            parent = str(uuid.uuid4())
            mailbox.submit('goal', {'goal': 'Make a shelter', 'origin': 'host_review',
                                   'stage_baseline': controller.stage_baseline()}, parent)
            assert mailbox.claim()['id'] == parent
            controller.active_goal = mailbox.active_goal()
            payload['revision_of'] = parent
        mailbox.submit('feedback', payload, request_id)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.commands = mailbox
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    run_async(controller.turn_once('survive', 'body contract', module.model_tools(bridge.tools)))
    dispatched = sum(name == 'mc_do' for name, _, _ in bridge.calls)
    advisory = choice == 'revise'
    assert dispatched == (1 if advisory else 0), (
        'Routine host stage review discards current inference like an urgent human command'
    )
    assert mailbox.get(request_id)['delivery'] == 'queued'
    if not advisory:
        import json
        records = [json.loads(line) for line in (tmp_path/'decisions.jsonl').read_text(encoding='utf-8').splitlines()]
        assert records[-1]['controller_cancelled'] == 'explicit_command' and records[-1]['dispatched'] is False
    assert mailbox.ready()  # Normal next-boundary admission still sees it.
    claimed = mailbox.claim()
    assert claimed['id'] == request_id and claimed['payload']['origin'] == origin


def test_stop_remains_an_interrupt_even_behind_a_queued_host_review(tmp_path):
    mailbox = Mailbox(tmp_path)
    parent = str(uuid.uuid4())
    mailbox.submit('goal', {'goal': 'House', 'origin': 'host_review'}, parent)
    assert mailbox.claim()['id'] == parent
    mailbox.submit('feedback', {'goal': 'Continue the house', 'mode': 'insert', 'origin': 'host_review',
        'review_decision': 'revise', 'revision_of': parent}, str(uuid.uuid4()))
    assert not mailbox.interrupt_ready()
    stop_id = str(uuid.uuid4())
    mailbox.submit('stop', {}, stop_id)
    assert mailbox.interrupt_ready()
    assert mailbox.claim()['id'] == stop_id
