import json

from test_controller import action, setup


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
    controller.receipt({'execution': {**action(True), 'id': 'body-2'}})
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
