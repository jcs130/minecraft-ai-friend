"""The host must see reads made through all supported observation ports."""
import copy
import json

import pytest
from test_controller import action, packed, setup
from test_review import snapshot

from agent_mc_autonomy.context import read_progress
from agent_mc_autonomy.review import ReviewPolicy, ReviewPort


@pytest.mark.parametrize("name,args,queued", [
    ("mc_do", {"steps": [{"skill": "observe", "mode": "sites", "sites": [[1, 64, 1]]}]}, True),
    ("mc_do", {"steps": [{"skill": "probe", "bounds": [0, 63, 0, 2, 65, 2]}]}, True),
    ("mc_observe", {"mode": "sites", "sites": [[1, 64, 1]]}, False),
    ("mc_check", {"checks": []}, False),
    ("mc_visual", {}, False),
    ("mc_map", {}, False),
    ("mc_blueprint", {}, False),
])
def test_native_read_count_reaches_host_inspection(framework_module, tmp_path, run_async, name, args, queued):
    module, bridge, controller = setup(framework_module, tmp_path / "body", None)
    controller.data.mkdir(parents=True, exist_ok=True)
    original = bridge.call
    if name != "mc_do":
        bridge.tools.append({"name": name, "inputSchema": {"type": "object"}})

    async def call(tool, arguments, **metadata):
        if tool == name and not queued:
            bridge.calls.append((tool, copy.deepcopy(arguments), metadata))
            return packed({"protocol": "agent-mc/v1", "text": "Observed result; unknown cells remain unknown"})
        return await original(tool, arguments, **metadata)

    bridge.call = call
    result, _, _ = run_async(controller.execute_model_call(name, copy.deepcopy(args)))
    assert not result.get("failed")
    if queued:
        controller.receipt({"execution": {**action(True), "evidence": {"receipt": "Observed cells; no world changes"}}})
    assert controller.read_activity == {name: 1}
    port = ReviewPort(tmp_path / "review", now=lambda: 10000)
    port.configure(ReviewPolicy(enabled=True))
    value = snapshot(10000, read_activity=controller.read_activity)
    (port.directory / "status.json").write_text(json.dumps(value), encoding="utf-8")
    port.observe(value)
    offered = port.offer()["review"]
    assert offered["evidence"]["read_activity"] == {name: 1}
    assert port.decide(offered["id"], "inspect")["read_activity"] == {name: 1}
    assert "查询1次" in offered["summary"]
    # Evidence classification must not silently grant lookahead or batch rights.
    assert name not in {"mc_observe", "mc_visual", "mc_check"} or name not in module.IMMEDIATE_READ_TOOLS


def test_mixed_body_plan_is_not_a_read_counter(framework_module, tmp_path, run_async):
    _, _, controller = setup(framework_module, tmp_path, None)
    run_async(controller.execute_model_call("mc_do", {"steps": [
        {"skill": "observe"}, {"skill": "goto", "x": 1, "y": 64, "z": 1}]}))
    assert controller.read_activity == {}
    assert controller.pending


def test_read_guidance_allows_finishing_without_choosing_an_action():
    value = read_progress({"mc_do": 7, "mc_queue": 4})
    assert value["action_progress_verified"] is False
    assert "goal_report" in value["next_decision"]
    assert "unresolved" in value["next_decision"]


@pytest.mark.parametrize("name", ["mc_observe", "mc_visual", "mc_check"])
def test_failed_immediate_read_does_not_create_progress(framework_module, tmp_path, run_async, name):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append({"name": name, "inputSchema": {"type": "object"}})
    original = bridge.call

    async def call(tool, args, **metadata):
        if tool == name:
            return {**packed({"protocol": "agent-mc/v1", "text": "Observation unavailable"}), "isError": True}
        return await original(tool, args, **metadata)

    bridge.call = call
    result, _, _ = run_async(controller.execute_model_call(name, {}))
    assert result["failed"] and controller.read_activity == {}
    assert not controller.pending
