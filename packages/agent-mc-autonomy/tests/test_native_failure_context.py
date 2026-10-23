import json

import pytest
from test_controller import action, setup


def semantic_rejection():
    return {'protocol': 'agent-mc/v1', 'failed': True, 'execution': None,
            'text': 'No crafting recipe for cooked_chicken; use smelt input/fuel.',
            'meta': {'admission': {'accepted': False, 'rule': 'craft.invalid', 'kind': 'repeat',
                     'recovery': [{'tool': 'mc_help', 'arguments': {'skill': 'smelt'},
                                   'text': '{"skill":"smelt","input":"chicken","fuel":"oak_planks"}; take cooked output from the furnace.'}]}}}


def test_semantic_rejection_is_not_redispatched_in_another_turn(framework_module, tmp_path, run_async):
    async def unused(*_):
        raise AssertionError('No model call')

    _, bridge, controller = setup(framework_module, tmp_path, unused)
    bridge.result = semantic_rejection()
    arguments = {'steps': [{'skill': 'craft', 'item': 'cooked_chicken'}]}
    controller.last_admission_facts = 'same-observed-inventory'
    controller.turn = 'first-turn'
    run_async(controller.execute_model_call('mc_do', arguments))
    assert controller.tool_failure['admission']['rule'] == 'craft.invalid'
    assert controller.tool_failure['recovery'][0]['arguments'] == {'skill': 'smelt'}
    controller.turn = 'different-turn'
    result, _, _ = run_async(controller.execute_model_call('mc_do', arguments))
    assert result['dispatched'] is False
    assert len([call for call in bridge.calls if call[0] == 'mc_do']) == 1
    assert not controller.pending and controller.inflight_request is None


@pytest.mark.parametrize('change', ['facts', 'expiry'])
def test_semantic_rejection_can_be_rechecked_after_new_evidence_or_expiry(framework_module, tmp_path, run_async, monkeypatch, change):
    async def unused(*_):
        raise AssertionError('No model call')

    module, bridge, controller = setup(framework_module, tmp_path, unused)
    clock = [100.0]
    monkeypatch.setattr(module.time, 'monotonic', lambda: clock[0])
    bridge.result = semantic_rejection()
    controller.last_admission_facts = 'inventory-before'
    args = {'steps': [{'skill': 'craft', 'item': 'cooked_chicken'}]}
    run_async(controller.execute_model_call('mc_do', args))
    if change == 'facts':
        controller.last_admission_facts = 'inventory-after'
    else:
        clock[0] += 121
    bridge.result = {'protocol': 'agent-mc/v1', 'text': 'Accepted after a real change', 'execution': action()}
    result, _, _ = run_async(controller.execute_model_call('mc_do', args))
    assert result['execution']['id'] == 'body-1'
    assert len([call for call in bridge.calls if call[0] == 'mc_do']) == 2


def test_admission_fingerprint_ignores_clocks_but_observes_material_changes(framework_module):
    from agent_mc_autonomy.controller import admission_fingerprint

    first = {'parts': [{'key': 'gear', 'text': 'chicken=1'}, {'key': 'clock', 'text': 'day 1'},
                       {'key': 'lastTask', 'text': 'rejected at time 1'}]}
    second = {'parts': [{'key': 'gear', 'text': 'chicken=1'}, {'key': 'clock', 'text': 'day 2'},
                        {'key': 'lastTask', 'text': 'rejected at time 2'}]}
    assert admission_fingerprint(first) == admission_fingerprint(second)
    second['parts'][0]['text'] = 'cooked_chicken=1'
    assert admission_fingerprint(first) != admission_fingerprint(second)
    assert admission_fingerprint({'parts': [{'key': 'clock', 'text': 'day 2'}]}) is None


def test_recovery_reference_survives_budgeted_dynamic_tail(framework_module):
    from agent_mc_autonomy.context import assemble
    from agent_mc_autonomy.controller import failure_context

    failure = failure_context([], 'mc_do', {'steps': [{'skill': 'craft', 'item': 'cooked_chicken'}]}, semantic_rejection())
    failure['parameter_help'] = {'unrelated': 'Large irrelevant schema. ' * 500}
    messages, budget = assemble('stable rules', [], 'survive', {'parts': [{'key': 'body', 'text': 'health=1 food=7'}]}, [], [],
                                context_tokens=32768, reserved_output=2048, tool_failure=failure)
    tail = json.loads(messages[-1]['content'])
    assert tail['tool_failure']['recovery'][0]['arguments'] == {'skill': 'smelt'}
    assert '"input":"chicken"' in tail['tool_failure']['recovery'][0]['text']
    assert budget['total'] <= budget['limit']


def test_accepted_body_failure_remains_actionable_after_read_and_next_acceptance(framework_module, tmp_path, run_async):
    async def unused(*_):
        raise AssertionError('No model call in this regression')

    _, bridge, controller = setup(framework_module, tmp_path, unused)
    controller.turn = 'turn-1'
    arguments = {'steps': [{'skill': 'collect', 'block': 'oak_log', 'count': 8}]}
    run_async(controller.execute_model_call('mc_do', arguments))
    terminal = {**action(True), 'phase': 'blocked', 'evidence': {'receipt': 'Nearby oak logs are not visible; nothing was mined.'}}
    event = {'run': 'run-1', 'cursor': 9, 'type': 'minecraft.task', 'execution': terminal}
    controller.receipt({'events': [event], 'execution': terminal})
    assert controller.tool_failure['native_execution']['phase'] == 'blocked'
    assert 'not visible' in controller.tool_failure['error']
    assert controller.tool_failure['native_event'] == {'run': 'run-1', 'cursor': 9}
    assert json.loads(controller.tool_failure['arguments'])['steps'][0]['block'] == 'oak_log'
    assert 'not accepted' not in controller.tool_failure['next_step']
    assert controller.native_outcomes[-1]['phase'] == 'blocked'
    controller.receipt({'events': [event], 'execution': terminal})
    assert len(controller.native_outcomes) == 1, 'duplicate delivery must not multiply failed attempts'
    run_async(controller.execute_model_call('mc_bag', {}))
    assert controller.tool_failure['native_execution']['phase'] == 'blocked'
    bridge.result = {**bridge.result, 'execution': {**action(), 'id': 'body-2'}}
    run_async(controller.execute_model_call('mc_do', {'steps': [{'skill': 'goto', 'at': [1, 64, 0]}]}))
    assert controller.tool_failure['native_execution']['phase'] == 'blocked', 'new acceptance is not recovery'
    from test_effect_recovery import effect
    moved = effect()
    moved.update(skill='goto', at=[1, 64, 0], status='changed')
    moved['before']['position'] = [0, 64, 0]
    moved['after']['position'] = [1, 64, 0]
    moved['changed']['position'] = True
    controller.receipt({'execution': {**action(True), 'id': 'body-2', 'evidence': {
        'steps': [{'step': 1, 'outcome': 'ok', 'observedEffect': moved}]}}})
    assert controller.tool_failure is None
    assert controller.native_outcomes[-1]['phase'] == 'completed'
    assert controller.native_outcomes[-1]['goal_verified'] is False


def test_unowned_or_read_task_terminal_does_not_erase_failed_body_plan(framework_module, tmp_path, run_async):
    async def unused(*_):
        raise AssertionError('No model call')

    _, bridge, controller = setup(framework_module, tmp_path, unused)
    controller.turn = 'turn-1'
    run_async(controller.execute_model_call('mc_do', {'steps': [{'skill': 'collect', 'block': 'oak_log'}]}))
    controller.receipt({'execution': {**action(True), 'phase': 'blocked', 'evidence': {'receipt': 'Cannot see target'}}})
    failure = controller.tool_failure
    controller.receipt({'execution': {**action(True), 'id': 'foreign-task'}})
    assert controller.tool_failure == failure
    assert len(controller.native_outcomes) == 1
    assert not controller.pending


def test_native_outcomes_are_dynamic_budgeted_tail_and_terminal_originals_remain_queryable(framework_module):
    from agent_mc_autonomy.context import assemble

    rows = [{'execution_id': str(i), 'phase': 'blocked', 'receipt': 'x' * 2000} for i in range(6)]
    event = {'run': 'run-1', 'cursor': 9, 'type': 'minecraft.task',
             'execution': {**action(True), 'evidence': {'receipt': 'head ' + 'y' * 9000 + ' tail'}}}
    messages, budget = assemble('stable', [], 'survive', {'parts': []}, [event], [],
                                context_tokens=6500, reserved_output=200, native_outcomes=rows)
    assert budget['total'] <= 6500
    tail = json.loads(messages[-1]['content'])
    assert len(tail.get('recent_native_outcomes', [])) < 6
    projected = tail['events'][0]
    assert projected['execution']['evidence']['abridged'] is True
    assert projected['execution']['evidence']['receipt'].startswith('head ')
    assert projected['execution']['evidence']['receipt'].endswith(' tail')
    assert projected['original'] == {'tool': 'mc_protocol', 'action': 'archive', 'run': 'run-1', 'after': 8, 'limit': 1}
