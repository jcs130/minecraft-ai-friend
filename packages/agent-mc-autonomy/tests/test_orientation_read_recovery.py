"""Turning to inspect a scene is not recovery from an earlier body failure."""
import copy
import json

import pytest
from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.controller import observation_call, spatial_read_key
from test_controller import action, setup


SCANS = [
    [{"skill": "look", "at": ["~0", "~2", "~0"]}],
    [{"skill": "look", "at": ["~0", "~3", "~0"]},
     {"skill": "observe", "mode": "voxels", "bounds": [-3, -1, -3, 3, 3, 3]}],
    [{"skill": "look", "at": [1, 65, 2]},
     {"skill": "find", "target": "log", "distance": 24}],
]


@pytest.mark.parametrize("steps", SCANS)
def test_orientation_scans_are_reads_but_are_never_replayed_from_cache(steps):
    arguments = {"steps": steps}
    assert observation_call("mc_do", arguments)
    # A queued look changes the camera. An old observation cannot replace it,
    # even if the same coordinates are requested again after an intervening look.
    assert spatial_read_key("mc_do", arguments) is None


@pytest.mark.parametrize("context_mode", ["compact", "full"])
@pytest.mark.parametrize("steps", SCANS)
def test_completed_orientation_scan_retains_native_failure_and_read_count(
        framework_module, tmp_path, run_async, context_mode, steps):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "failed-body"
    controller.last_admission_facts = "same-observed-site"
    run_async(controller.execute_model_call("mc_do", {
        "steps": [{"skill": "goto", "at": [4, 65, 2]}]}))
    blocked = {**action(True), "phase": "blocked", "evidence": {
        "receipt": "No verified standing support at the requested landing; no path was executed."}}
    controller.receipt({"execution": blocked})
    failure = copy.deepcopy(controller.tool_failure)

    for index in range(2):
        task = {**action(), "id": f"orientation-{index}"}
        bridge.result = {"protocol": "agent-mc/v1", "text": "queued look", "execution": task}
        result, _, _ = run_async(controller.execute_model_call("mc_do", {"steps": steps}))
        assert result["execution"]["id"] == task["id"]
        assert controller.tool_failure == failure, "acceptance must not retire the failed plan"
        controller.receipt({"execution": {**task, "terminal": True, "phase": "completed",
            "evidence": {"receipt": "Turned the camera and read the visible scene; body position unchanged."}}})
        assert controller.tool_failure == failure, "a completed view is not recovery"
        assert controller.native_outcomes[-1]["observation_only"] is True
        assert controller.read_activity["mc_do"] == index + 1

    controller.groups.clear()  # The retained cause must survive history pressure.
    messages, _ = assemble("core rules", [], "survive", {}, [], [],
        context_tokens=32768, reserved_output=2048, context_mode=context_mode,
        tool_failure=controller.tool_failure, read_activity=controller.read_activity)
    tail = json.loads(messages[-1]["content"])
    assert tail["tool_failure"]["error"] == failure["error"]
    assert tail["read_activity"]["calls_since_body_action"]["mc_do"] == 2
    assert tail["read_activity"]["action_progress_verified"] is False


@pytest.mark.parametrize("step", [
    {"skill": "goto", "at": [1, 65, 2]},
    {"skill": "collect", "block": "stone", "count": 1},
    {"skill": "find", "target": "log", "direction": "west", "distance": 16},
    {"skill": "use", "at": [1, 65, 2]},
    {"skill": "control", "keys": ["forward"], "durationMs": 500},
    {"skill": "unknown_native_skill"},
])
def test_look_before_a_body_action_does_not_make_the_batch_a_read(step):
    assert not observation_call("mc_do", {"steps": [SCANS[0][0], step]})
