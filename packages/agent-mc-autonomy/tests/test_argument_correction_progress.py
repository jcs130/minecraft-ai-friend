"""Syntactic rejection is independent of world drift; native failure is not."""
import copy
import dataclasses
import json

from test_controller import action, setup

BAD = {'steps': [{'skill': 'harvest', 'block': 'wheat', 'replant': True, 'text': 'at', 'tolerance': 1}]}


def correction():
    return {'protocol': 'agent-mc/v1', 'failed': True, 'execution': None,
            'text': '[mc_do 失败] 第 1 步 harvest 要 at:[x,y,z]',
            'meta': {'admission': {'accepted': False, 'dispatched': False, 'kind': 'correction',
                    'rule': 'arguments.steps', 'fieldPath': '/steps/0',
                    'recovery': [{'tool': 'mc_help', 'arguments': {'skill': 'harvest'},
                                  'text': 'harvest(block*,at*,replant?,tool?)'}]}}}


def test_argument_rejection_survives_world_drift_and_elapsed_time(framework_module, tmp_path, run_async, monkeypatch):
    async def unused(*_):
        raise AssertionError('no inference')
    module, bridge, controller = setup(framework_module, tmp_path, unused)
    clock = [100.0]
    monkeypatch.setattr(module.time, 'monotonic', lambda: clock[0])
    bridge.result = correction()
    controller.last_admission_facts = 'feet-y=61.15'
    controller.turn = 'first'
    run_async(controller.execute_model_call('mc_do', copy.deepcopy(BAD)))
    controller.last_admission_facts = 'feet-y=61.19'
    clock[0] += 181
    controller.turn = 'second'
    result, _, boundary = run_async(controller.execute_model_call('mc_do', copy.deepcopy(BAD)))
    assert result.get('dispatched') is False
    assert boundary is True
    assert len([x for x in bridge.calls if x[0] == 'mc_do']) == 1
    assert controller.planner_retry_at == 0  # Only the bad call is fenced, never the planner.
    assert not controller.pending and controller.inflight_request is None


def test_new_invalid_arguments_same_contract_end_correction_chain(framework_module, tmp_path, run_async):
    async def unused(*_):
        raise AssertionError('no inference')
    _, bridge, controller = setup(framework_module, tmp_path, unused)
    bridge.result = correction()
    controller.turn = 'first'
    run_async(controller.execute_model_call('mc_do', copy.deepcopy(BAD)))
    changed = {'steps': [{'skill': 'harvest', 'block': 'wheat', 'to': [1, 64, 0]}]}
    controller.turn = 'second'
    _, _, boundary = run_async(controller.execute_model_call('mc_do', changed))
    assert boundary is True
    assert controller.planner_retry_at == 0
    assert controller.tool_failure['argument_correction']['attempts'] == 2
    assert controller.tool_failure['argument_correction']['action_dispatched'] is False


def test_corrected_call_is_allowed_without_waiting_or_argument_repair(framework_module, tmp_path, run_async):
    async def unused(*_):
        raise AssertionError('no inference')
    _, bridge, controller = setup(framework_module, tmp_path, unused)
    bridge.result = correction()
    controller.turn = 'first'
    run_async(controller.execute_model_call('mc_do', copy.deepcopy(BAD)))
    args = {'steps': [{'skill': 'harvest', 'block': 'wheat', 'at': [1, 64, 0]}]}
    bridge.result = {'protocol': 'agent-mc/v1', 'text': 'accepted', 'execution': action()}
    controller.turn = 'fixed'
    result, _, _ = run_async(controller.execute_model_call('mc_do', args))
    assert result['execution']['id'] == 'body-1'
    assert next(x for x in reversed(bridge.calls) if x[0] == 'mc_do')[1]['steps'] == args['steps']
    assert controller.inflight_request is None


def test_repeated_argument_failure_yields_after_bounded_fake_model_rounds(framework_module, tmp_path, run_async):
    calls = []
    async def decide(*_):
        calls.append(True)
        return {'content': None, 'tool_calls': [{'id': f'call-{len(calls)}', 'type': 'function',
                'function': {'name': 'mc_do', 'arguments': json.dumps(BAD)}}]}
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.result = correction()
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=8)
    run_async(controller.turn_once('Choose your own activity', 'contract', module.model_tools(bridge.tools)))
    assert len(calls) <= 2
    assert not controller.pending and controller.inflight_request is None
    assert not any(x[0] == 'mc_stop' for x in bridge.calls)


def test_many_corrections_never_pause_the_planner_and_scope_changes_remain_independent(framework_module, tmp_path, run_async, monkeypatch):
    async def unused(*_):
        raise AssertionError('no inference')
    module, bridge, controller = setup(framework_module, tmp_path, unused)
    now = 1000.0
    monkeypatch.setattr(module.time, 'monotonic', lambda: now)
    bridge.result = correction()
    controller.game_scope = 'realm-a/account'
    for i in range(12):
        controller.turn = str(i)
        run_async(controller.execute_model_call('mc_do', copy.deepcopy(BAD)))
    assert controller.planner_retry_at == 0
    assert controller.tool_failure['argument_correction']['attempts'] == 12
    assert len([x for x in bridge.calls if x[0] == 'mc_do']) == 1
    controller.game_scope = 'realm-b/account'
    controller.turn = 'new-scope'
    run_async(controller.execute_model_call('mc_do', copy.deepcopy(BAD)))
    assert len([x for x in bridge.calls if x[0] == 'mc_do']) == 2
    assert controller.tool_failure['argument_correction']['attempts'] == 1


def test_correction_retains_an_independent_provider_deadline(framework_module, tmp_path, run_async, monkeypatch):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    monkeypatch.setattr(module.time, 'monotonic', lambda: 1000)
    controller.planner_retry_at = 1017  # A genuine provider wait belongs to another lane.
    published = []
    controller.publish = lambda **patch: published.append(patch)
    bridge.result = correction()
    for _ in range(4):
        run_async(controller.execute_model_call('mc_do', copy.deepcopy(BAD)))
    assert controller.planner_retry_at == 1017
    assert published[-1]['planner_retry_seconds'] == 17
    assert published[-1]['planner_correction']['global_backoff_added'] is False
    assert len([x for x in bridge.calls if x[0] == 'mc_do']) == 1


def test_real_scheduler_can_read_help_and_dispatch_corrected_action_at_normal_cadence(
        framework_module, tmp_path, run_async, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    seen = []
    clock = [1000.0]

    async def decide(messages, _):
        seen.append(clock[0])
        n = len(seen)
        name, args = ('mc_do', BAD) if n < 3 else ('mc_help', {'skill': 'harvest'}) if n == 3 else (
            'mc_do', {'steps': [{'skill': 'harvest', 'block': 'wheat', 'at': [1, 64, 0]}]})
        return {'tool_calls': [{'id': f'correction-{n}', 'type': 'function',
            'function': {'name': name, 'arguments': json.dumps(args)}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    bridge.tools.append({'name': 'mc_help', 'inputSchema': {'type': 'object'}})
    original_call = bridge.call

    async def call(name, arguments, **kwargs):
        if name == 'mc_do':
            bridge.result = correction() if 'at' not in arguments['steps'][0] else {
                'protocol': 'agent-mc/v1', 'text': 'fixture completed', 'execution': action(terminal=True), 'endsTurn': True}
        return await original_call(name, arguments, **kwargs)

    bridge.call = call
    sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await sleep(0)

    monkeypatch.setattr(module.asyncio, 'sleep', tick)
    controller.settings = dataclasses.replace(controller.settings, min_decision_seconds=2, idle_decision_seconds=60)
    run_async(controller.run('original standing goal'))
    assert len(seen) == 4
    assert seen[-1] - seen[0] < 15  # The old second rejection imposed 60 seconds here.
    actual = [args for name, args, _ in bridge.calls if name == 'mc_do']
    assert len(actual) == 2  # Initial bad call once, then the exact model-selected corrected call.
    assert actual[-1]['steps'][0]['at'] == [1, 64, 0]
    assert any(name == 'mc_help' for name, *_ in bridge.calls)
    assert controller.tool_failure is None


def test_native_typed_correction_and_count_survive_budgeted_context(framework_module):
    from agent_mc_autonomy.context import assemble
    from agent_mc_autonomy.controller import failure_context
    from agent_mc_autonomy.observations import tool_failure_view
    result = correction()
    schema = {'type': 'object', 'properties': {'at': {'type': 'array', 'minItems': 3, 'maxItems': 3}}, 'required': ['at']}
    result['meta']['admission']['inputSchema'] = schema
    failure = failure_context([], 'mc_do', BAD, result)
    assert failure['correction_schema'] == schema
    failure['argument_correction'] = {'attempts': 3, 'action_dispatched': False}
    assert tool_failure_view(failure)['argument_correction'] == failure['argument_correction']
    messages, _ = assemble('stable', [], 'Choose your own next activity', {'parts': []}, [], [],
                          context_tokens=8192, reserved_output=512, tool_failure=failure)
    tail = json.loads(messages[-1]['content'])
    assert tail['tool_failure']['correction_schema'] == schema
    assert tail['tool_failure']['argument_correction']['attempts'] == 3


def test_unknown_or_game_failure_does_not_enter_argument_correction_counter():
    from agent_mc_autonomy.argument_correction import ArgumentCorrections
    tracker = ArgumentCorrections()
    for change in [{'dispatched': True}, {'kind': 'repeat'}, {'rule': 'path_stalled'}, {'dispatched': None}]:
        failure = {'admission': {**correction()['meta']['admission'], **change}}
        assert tracker.record('mc_do', failure, 'world') is None
    assert not tracker.counts
