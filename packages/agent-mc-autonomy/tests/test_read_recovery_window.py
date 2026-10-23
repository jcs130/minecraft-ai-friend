"""Replay alternating inventory/queue queries with no intervening body effect."""
import dataclasses
import json

import pytest
from test_controller import packed, setup

from agent_mc_autonomy.context import assemble


@pytest.mark.parametrize('context_mode', ['compact', 'full'])
def test_answered_read_survives_history_eviction_at_real_request_boundary(
        framework_module, tmp_path, run_async, context_mode):
    captured, budgets = [], []
    answer = 'Inventory 36/36 occupied; zero empty slots; cursor empty. Original answer.'

    async def decide(messages, tools):
        available = ({tool['function']['name'] for tool in tools} if context_mode != 'full'
                     else set(json.loads(messages[-1]['content'])['current_tool_policy']['allowed_tools']))
        captured.append((messages, available))
        return {'tool_calls': [{'id': f'call-{len(captured)}', 'type': 'function',
                               'function': {'name': 'mc_bag', 'arguments': '{}'}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1,
        context_mode=context_mode, context_tokens=16384, max_output_tokens=512)
    controller.publish = lambda **value: budgets.append(value)
    bridge.tools.append({'name': 'mc_bag', 'inputSchema': {'type': 'object'}})
    original = bridge.call

    async def call(name, arguments, **metadata):
        if name == 'mc_bag':
            bridge.calls.append((name, arguments, metadata))
            return {'structuredContent': {'protocol': 'agent-mc/v1', 'text': answer}}
        return await original(name, arguments, **metadata)

    bridge.call = call
    tools = module.model_tools(bridge.tools, context_mode=context_mode)
    for _ in range(2):
        run_async(controller.turn_once('survive', 'native contract', tools))
    assert 'mc_bag' in controller.read_recovery_tools
    # Real full-window pressure can evict the whole tool exchange while the
    # answer cache/deferred tool still survives. The dated answer must remain
    # selected input, not merely a hidden dictionary or an archive handle.
    controller.groups = [[{'role': 'user', 'content': 'large old observation ' * 2000}]]
    run_async(controller.turn_once('survive', 'native contract', tools))
    assert 'mc_bag' not in captured[-1][1]
    tail = json.loads(captured[-1][0][-1]['content'])
    selected = next((row for row in tail.get('answered_reads', []) if row['tool'] == 'mc_bag'), None)
    assert selected, 'Answered tool hidden after eviction, but its answer is absent from the model request'
    assert selected['answer']['text'] == answer
    assert selected['fresh'] is False and selected['arguments'] == {}
    assert selected['request_id'] and selected['received_at']
    assert len([row for row in bridge.calls if row[0] == 'mc_bag']) == 1
    assert 'large old observation' not in json.dumps(captured[-1][0])
    if context_mode == 'full':
        assert any(value.get('context', {}).get('history', {}).get('evicted', 0) for value in budgets)


@pytest.mark.parametrize('invalidate', ['facts', 'scope', 'expiry', 'pending'])
def test_retained_answer_never_crosses_its_read_reuse_fence(
        framework_module, tmp_path, run_async, monkeypatch, invalidate):
    import agent_mc_autonomy.controller as module
    ticks = [100.0]
    monkeypatch.setattr(module.time, 'monotonic', lambda: ticks[0])
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append({'name': 'mc_bag', 'inputSchema': {'type': 'object'}})
    facts = {'parts': [{'key': 'world', 'text': 'unchanged inventory'}]}
    controller.last_admission_facts = module.admission_fingerprint(facts)
    run_async(controller.execute_model_call('mc_bag', {}))
    before = controller.current_answered_reads(facts)
    assert len(before) == 1 and before[0]['fresh'] is False
    if invalidate == 'facts':
        facts['parts'][0]['text'] = 'inventory changed'
    elif invalidate == 'scope':
        controller.game_scope = 'different account/realm'
    elif invalidate == 'expiry':
        ticks[0] += 301
    else:
        controller.pending[('task', 'body-work')] = {'terminal': False}
    assert controller.current_answered_reads(facts) == []
    assert len([row for row in bridge.calls if row[0] == 'mc_bag']) == 1


@pytest.mark.parametrize('context_mode', ['compact', 'full'])
def test_oversized_retained_answers_obey_window_and_report_omission(context_mode):
    answer = {'tool': 'mc_bag', 'fresh': False, 'answer': {'text': 'old result ' * 10000}}
    messages, budget = assemble('rules', [], 'survive', {'parts': []}, [], [],
        context_mode=context_mode, context_tokens=16384, reserved_output=512, answered_reads=[answer])
    assert budget['total'] <= 16384
    assert budget['answered_reads'] == {'available': 1, 'included': 0}
    assert 'old result' not in messages[-1]['content']


@pytest.mark.parametrize('context_mode', ['compact', 'full'])
def test_alternating_answered_reads_keep_a_recovery_window(
        framework_module, tmp_path, run_async, context_mode):
    offered = []

    async def decide(messages, tools):
        available = ({tool['function']['name'] for tool in tools} if context_mode != 'full'
                     else set(json.loads(messages[-1]['content'])['current_tool_policy']['allowed_tools']))
        offered.append(available)
        # The planner chooses work once both redundant reads have yielded.
        name = next((n for n in ('mc_bag', 'mc_queue') if n in available), 'mc_do')
        return {'tool_calls': [{'id': f'call-{len(offered)}', 'type': 'function', 'function': {
            'name': name, 'arguments': json.dumps({'steps': [{'skill': 'goto', 'at': [1, 65, 1]}]}
                                                  if name == 'mc_do' else {})}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1, context_mode=context_mode)
    bridge.tools.extend({'name': n, 'inputSchema': {'type': 'object'}} for n in ('mc_bag', 'mc_queue'))
    tools = module.model_tools(bridge.tools, context_mode=context_mode)
    for _ in range(7):
        run_async(controller.turn_once('survive', 'native contract', tools))
        if controller.pending:
            break
    assert len([row for row in bridge.calls if row[0] == 'mc_do']) == 1, offered
    assert len([row for row in bridge.calls if row[0] == 'mc_bag']) == 1
    assert len([row for row in bridge.calls if row[0] == 'mc_queue']) == 1
    assert {'mc_do', 'mc_original', 'mc_tool_help'} <= offered[-1]
    assert not {'mc_bag', 'mc_queue'}.intersection(offered[-1])
    assert controller.read_activity == {'mc_bag': 1, 'mc_queue': 1}


@pytest.mark.parametrize('change', ['facts', 'scope', 'expiry'])
def test_recovery_window_releases_for_fresh_state_or_bounded_expiry(
        framework_module, tmp_path, run_async, monkeypatch, change):
    import agent_mc_autonomy.controller as module
    ticks = [100.0]
    monkeypatch.setattr(module.time, 'monotonic', lambda: ticks[0])
    available = []

    async def decide(_messages, tools):
        names = {tool['function']['name'] for tool in tools}
        available.append(names)
        name = 'mc_bag' if 'mc_bag' in names else 'mc_queue'
        return {'tool_calls': [{'id': f'call-{len(available)}', 'type': 'function',
                               'function': {'name': name, 'arguments': '{}'}}]}

    _, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    bridge.tools.extend({'name': n, 'inputSchema': {'type': 'object'}} for n in ('mc_bag', 'mc_queue'))
    tools = module.model_tools(bridge.tools)
    for _ in range(2):
        run_async(controller.turn_once('survive', 'native contract', tools))
    assert 'mc_bag' in controller.read_recovery_tools
    if change == 'facts':
        original = bridge.call
        async def call(name, arguments, **metadata):
            if name == 'mc_protocol' and arguments['action'] == 'facts':
                return packed({'parts': [{'key': 'world', 'text': 'inventory changed'}]})
            return await original(name, arguments, **metadata)
        bridge.call = call
    elif change == 'scope':
        controller.game_scope = 'new connection/account'
    else:
        ticks[0] += 301
    run_async(controller.turn_once('survive', 'native contract', tools))
    assert 'mc_bag' in available[-1]
    assert len([row for row in bridge.calls if row[0] == 'mc_bag']) == 2


def test_full_context_carries_same_read_progress_guidance_as_compact():
    counts = {'mc_bag': 44, 'mc_queue': 11, 'mc_scout': 3}
    tails = []
    for mode in ('compact', 'full'):
        messages, _ = assemble('native contract', [], 'survive', {}, [], [], context_tokens=65536,
                               reserved_output=8192, context_mode=mode, read_activity=counts)
        tails.append(json.loads(messages[-1]['content'])['read_activity'])
    assert tails[0] == tails[1]
    assert 'next_decision' in tails[1]
    assert tails[1]['action_progress_verified'] is False
    assert tails[1]['calls_since_body_action'] == counts


def test_running_native_work_can_still_read_its_real_queue(framework_module, tmp_path, run_async):
    offered = []

    async def decide(_messages, tools):
        offered.append({tool['function']['name'] for tool in tools})
        return {'tool_calls': [{'id': f'call-{len(offered)}', 'type': 'function',
                               'function': {'name': 'mc_queue', 'arguments': '{}'}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    bridge.tools.append({'name': 'mc_queue', 'inputSchema': {'type': 'object'}})
    tools = module.model_tools(bridge.tools)
    for _ in range(2):
        run_async(controller.turn_once('survive', 'native contract', tools))
    assert 'mc_queue' in controller.read_recovery_tools
    controller.pending[('task', 'running-body')] = {'terminal': False}
    run_async(controller.turn_once('survive', 'native contract', tools))
    assert 'mc_queue' in offered[-1]
    assert len([row for row in bridge.calls if row[0] == 'mc_queue']) == 2
    assert controller.read_activity == {'mc_queue': 2}


def test_recovery_window_outlasts_slow_alternating_query_decisions(
        framework_module, tmp_path, run_async, monkeypatch):
    import agent_mc_autonomy.controller as module
    ticks, offered = [100.0], []
    monkeypatch.setattr(module.time, 'monotonic', lambda: ticks[0])

    async def decide(_messages, tools):
        available = {tool['function']['name'] for tool in tools}
        offered.append(available)
        # Replay inference/scheduling latency; no sleeping or actual model call.
        ticks[0] += 20
        name = next((n for n in ('mc_bag', 'mc_queue', 'mc_blocked') if n in available), 'mc_do')
        return {'tool_calls': [{'id': f'call-{len(offered)}', 'type': 'function', 'function': {
            'name': name, 'arguments': json.dumps({'steps': [{'skill': 'goto', 'at': [1, 65, 1]}]}
                                                  if name == 'mc_do' else {})}}]}

    _, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    bridge.tools.extend({'name': n, 'inputSchema': {'type': 'object'}} for n in ('mc_bag', 'mc_queue', 'mc_blocked'))
    original = bridge.call
    async def call(name, arguments, **metadata):
        if name == 'mc_blocked':
            bridge.calls.append((name, arguments, metadata))
            return packed({'text': 'No new failed task'})
        return await original(name, arguments, **metadata)
    bridge.call = call
    for _ in range(9):
        run_async(controller.turn_once('survive', 'native contract', module.model_tools(bridge.tools)))
        if controller.pending:
            break
    assert controller.pending, 'Answered tools reopened before the slow recovery decision could choose work'
    assert len([row for row in bridge.calls if row[0] == 'mc_bag']) == 1
