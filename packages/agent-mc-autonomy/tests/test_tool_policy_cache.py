"""Keep a provider's capability prefix independent of current admission policy."""
import copy
import dataclasses
import hashlib
import json

import pytest

from test_controller import action, setup


def catalogue(bridge):
    bridge.tools += [
        {'name': 'mc_help', 'inputSchema': {'type': 'object'}, '_meta': {'agent-mc/v1': {'tags': ['query']}}},
        {'name': 'mc_script', 'inputSchema': {'type': 'object'}, '_meta': {'agent-mc/v1': {'tags': ['act']}}},
    ]


def capture(framework_module, directory, run_async, *, ahead=False, deferred=False, reply=None):
    captured = []

    async def decide(messages, tools):
        captured.append((copy.deepcopy(messages), copy.deepcopy(tools)))
        return reply or {'content': 'Await the existing native result.', 'tool_calls': []}

    directory.mkdir()
    module, bridge, controller = setup(framework_module, directory, decide)
    catalogue(bridge)
    controller.settings = dataclasses.replace(controller.settings, context_mode='full', context_tokens=131072)
    if ahead:
        controller.pending[('task', 'body-1')] = action()
        controller.lookahead_anchor = ('task', 'body-1')
    if deferred:
        controller.deferred_read_tools = lambda _: {'mc_help'}
    run_async(controller.turn_once('survive', 'unchanged core contract', module.model_tools(bridge.tools, context_mode='full')))
    return captured[0], bridge, controller


@pytest.mark.parametrize('state', ['ahead', 'deferred'])
def test_full_provider_declarations_do_not_change_with_temporary_tool_policy(
        framework_module, tmp_path, run_async, state):
    ordinary, _, _ = capture(framework_module, tmp_path / 'ordinary', run_async)
    restricted, _, _ = capture(framework_module, tmp_path / state, run_async,
                               ahead=state == 'ahead', deferred=state == 'deferred')
    assert ordinary[1] == restricted[1], 'Temporary policy rewrites the provider tool-schema prefix'
    assert ordinary[0][:2] == restricted[0][:2], 'Stable instructions must remain a reusable prefix'
    policy = json.loads(restricted[0][-1]['content'])['current_tool_policy']
    if state == 'ahead':
        assert policy['native_queue'] == 'append_only'
        assert 'mc_script' not in policy['allowed_tools']
    else:
        assert 'mc_help' not in policy['allowed_tools']
        assert policy['native_queue'] == 'normal'


def test_full_declared_but_currently_deferred_read_is_still_rejected_before_dispatch(
        framework_module, tmp_path, run_async):
    reply = {'content': None, 'tool_calls': [{'id': 'deferred', 'type': 'function',
        'function': {'name': 'mc_help', 'arguments': '{}'}}]}
    (messages, tools), bridge, controller = capture(framework_module, tmp_path / 'deferred', run_async,
                                                   deferred=True, reply=reply)
    assert any(x['function']['name'] == 'mc_help' for x in tools)
    assert 'mc_help' not in json.loads(messages[-1]['content'])['current_tool_policy']['allowed_tools']
    assert not any(name == 'mc_help' for name, _, _ in bridge.calls)
    assert controller.invalid_tool_calls == 1


@pytest.mark.parametrize('queue', ['now', 'afterCheckpoint'])
def test_full_stable_declarations_cannot_authorize_ahead_queue_replacement(
        framework_module, tmp_path, run_async, queue):
    reply = {'content': None, 'tool_calls': [{'id': 'replace', 'type': 'function',
        'function': {'name': 'mc_do', 'arguments': json.dumps({'steps': [], 'queue': queue})}}]}
    (messages, tools), bridge, controller = capture(framework_module, tmp_path / queue, run_async,
                                                   ahead=True, reply=reply)
    assert json.loads(messages[-1]['content'])['current_tool_policy']['native_queue'] == 'append_only'
    assert not any(name == 'mc_do' for name, _, _ in bridge.calls)
    assert controller.invalid_tool_calls == 1
    assert ('task', 'body-1') in controller.pending


@pytest.mark.parametrize('name,arguments', [('mc_script', {'code': 'return 1'}),
                                          ('mc_invoke', {'name': 'mc_script', 'arguments': {'code': 'return 1'}})])
def test_full_stable_catalogue_does_not_authorize_other_ahead_mutations(
        framework_module, tmp_path, run_async, name, arguments):
    reply = {'content': None, 'tool_calls': [{'id': 'forbidden', 'type': 'function',
        'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
    (_, tools), bridge, controller = capture(framework_module, tmp_path / name, run_async, ahead=True, reply=reply)
    assert any(x['function']['name'] == name for x in tools)
    assert not any(called == name for called, _, _ in bridge.calls)
    assert controller.invalid_tool_calls == 1
    assert ('task', 'body-1') in controller.pending


def test_request_journal_records_non_content_prefix_and_policy_diagnostics(
        framework_module, tmp_path, run_async):
    (messages, tools), _, _ = capture(framework_module, tmp_path / 'record', run_async)
    row = json.loads((tmp_path / 'record/decisions.jsonl').read_text(encoding='utf-8').splitlines()[-1])
    data = row['request_context']
    encoded = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    policy = json.loads(messages[-1]['content'])['current_tool_policy']
    assert data['input'] > 0 and data['limit'] == 131072
    assert data['layout']['tools_sha256'] == hashlib.sha256(encoded(tools)).hexdigest()
    assert data['layout']['tool_policy_sha256'] == hashlib.sha256(encoded(policy)).hexdigest()
    assert 'unchanged core contract' not in json.dumps(data)
    assert 'allowed_tools' not in json.dumps(data)


def test_current_tool_policy_remains_literal_when_history_retires_and_counter_falls_back():
    from agent_mc_autonomy.context import assemble

    class Broken:
        name = 'offline-broken-policy-counter'

        def __call__(self, *_):
            raise RuntimeError('private details')

    policy = {'allowed_tools': ['mc_do'], 'native_queue': 'append_only'}
    messages, budget = assemble('native contract', [], 'survive', {'parts': []}, [],
        [[{'role': 'user', 'content': 'old observation ' * 2000}]],
        context_mode='full', context_tokens=16384, reserved_output=512,
        current_tool_policy=policy, context_counter=Broken())
    assert json.loads(messages[-1]['content'])['current_tool_policy'] == policy
    assert budget['history']['evicted'] == 1 and budget['total'] <= 16384
    assert budget['counter_fallback'] == 'RuntimeError'
