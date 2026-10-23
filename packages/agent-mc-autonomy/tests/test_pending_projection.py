import json

from test_controller import action, setup


def test_terminal_refreshes_public_pending_without_waiting_for_next_inference(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    status = {}
    controller.publish = lambda **value: status.update(value)
    run_async(controller.execute_model_call('mc_do', {'steps': []}))
    status['pending'] = list(controller.pending.values())  # Already-published request-start snapshot.
    assert status['pending'][0]['id'] == 'body-1'
    calls = len(bridge.calls)

    controller.receipt({'execution': action(terminal=True)})
    assert json.loads(controller.state_path.read_text())['pending'] == []
    assert status['pending'] == [], 'A fresh facts heartbeat must not leave an old accepted task on screen'
    assert not controller.pending and len(bridge.calls) == calls

    controller.receipt({'execution': action()})  # Late acceptance cannot resurrect the completed task.
    assert status['pending'] == [] and not controller.pending
    assert controller.native_outcomes[-1]['phase'] == 'completed'
