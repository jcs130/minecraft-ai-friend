"""Rejected local reports must not disconnect a healthy native body."""
import copy
import dataclasses
import json

from test_controller import choose, setup


def test_pending_goal_report_is_a_no_dispatch_receipt(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.active_goal = {'id': 'stage', 'goal': 'continue real work', 'mode': 'insert'}
    controller.pending = {('task', 'owned'): {'kind': 'task', 'id': 'owned', 'phase': 'running'}}
    controller.persist(stopped=False, uncertain=False)
    before = copy.deepcopy(controller.pending)
    result, compact = run_async(controller.dispatch('goal_report', {
        'outcome': 'reported_done', 'evidence': 'model claims done before the native terminal'}, 'invalid-report'))
    assert result['failed'] and result['dispatched'] is False and result['execution'] is None
    assert result['origin'] == 'controller_validation' and 'pending' in compact
    assert controller.pending == before and controller.active_goal['id'] == 'stage'
    assert bridge.calls == [] and controller.inflight_request is None
    state = json.loads((tmp_path / 'host-state.json').read_text())
    assert not state['stopped'] and not state['uncertain']


def test_work_arriving_during_inference_cannot_turn_a_report_into_runtime_failure(framework_module, tmp_path, run_async):
    async def decide(*_):
        controller.pending = {('task', 'owned'): {'kind': 'task', 'id': 'owned', 'phase': 'running'}}
        response = choose()
        response['tool_calls'][0]['function'] = {'name': 'goal_report', 'arguments': json.dumps({
            'outcome': 'reported_done', 'evidence': 'native work has not ended'})}
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode='full')
    controller.active_goal = {'id': 'stage', 'goal': 'continue real work', 'mode': 'insert'}
    controller.persist(stopped=False)
    run_async(controller.turn_once('survive', 'body contract', module.model_tools(bridge.tools)))
    assert controller.turn is None and controller.active_goal['id'] == 'stage'
    assert ('task', 'owned') in controller.pending
    tool = controller.groups[-1][-1]
    result = json.loads(tool['content'])
    assert tool['role'] == 'tool' and result['failed'] and result['dispatched'] is False
    assert not any(name == 'mc_connection' for name, _, _ in bridge.calls)
    assert not json.loads((tmp_path / 'host-state.json').read_text())['stopped']
