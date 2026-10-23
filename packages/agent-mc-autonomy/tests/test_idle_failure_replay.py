"""Replay the live rejected-plan -> queued observation -> repeated-plan seam."""
import copy
import json

import pytest
from agent_mc_autonomy.context import assemble
from test_controller import action, setup

REJECTED = "这一单我没接:这片区域已连续 3 次没找到生鸡肉；暂缓在周围 32 格内重复找它"
PLAN = {"steps": [{"skill": "collect", "block": "oak_log", "count": 3},
                  {"skill": "find", "target": "chicken", "distance": 32}]}


@pytest.mark.parametrize("tool,arguments", [
    ("mc_scout", {"steps": [{"skill": "observe", "mode": "voxels"}]}),
    ("mc_do", {"steps": [{"skill": "observe", "mode": "rays"},
                         {"skill": "find", "target": "oak_log", "distance": 24}]}),
])
@pytest.mark.parametrize("invalid_read_first", [False, True])
def test_queued_observation_does_not_erase_rejected_survival_plan(
        framework_module, tmp_path, run_async, tool, arguments, invalid_read_first):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "rejected-plan"
    bridge.result = {"failed": True, "protocol": "agent-mc/v1", "text": REJECTED}
    run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
    failure = copy.deepcopy(controller.tool_failure)
    native_call = bridge.call

    async def call(name, args, **metadata):
        return await native_call("mc_do" if name == "mc_scout" else name, args, **metadata)

    bridge.call = call
    if invalid_read_first:
        bridge.result = {"protocol": "agent-mc/v1", "failed": True,
                         "text": "Invalid arguments: voxel volume 1183 exceeds 512; no observation was read"}
        invalid = {"steps": [{"skill": "observe", "mode": "voxels", "bounds": [-6, -2, -6, 6, 4, 6]}]}
        run_async(controller.execute_model_call(tool, invalid))
        run_async(controller.execute_model_call(tool, invalid))  # Cached rejection is another read, not recovery.
    bridge.result = {"protocol": "agent-mc/v1", "text": "observations queued, not body progress",
                     "execution": action()}
    run_async(controller.execute_model_call(tool, arguments))
    controller.receipt({"execution": action(terminal=True)})
    controller.groups.clear()  # Older exchanges really are evicted by the budget.
    messages, _ = assemble("native rules", [], "Survive", {}, [], controller.groups,
                           context_tokens=32768, reserved_output=2048,
                           tool_failure=controller.tool_failure, read_activity=controller.read_activity)
    tail = json.loads(messages[-1]["content"])
    assert tail.get("tool_failure", {}).get("error") == failure["error"]
    assert tail["read_activity"]["action_progress_verified"] is False
    assert tail["read_activity"]["calls_since_body_action"][tool] == 1
    receipts = [json.loads(line) for line in (tmp_path / "receipts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(receipts) == (3 if invalid_read_first else 2) and receipts[0]["result"]["failed"] is True


@pytest.mark.parametrize("steps,expected", [
    ([{"skill": "find", "target": "chicken"}], True),
    ([{"skill": "find", "target": "chicken", "direction": "south"}], False),
    ([{"skill": "observe"}, {"skill": "collect", "block": "oak_log", "count": 1}], False),
    ([{"skill": "look"}], True),
    ([{"skill": "new_native_skill"}], False),
    ([], False),
    ("bad steps", False),
])
def test_only_known_observation_steps_are_classified_as_reads(framework_module, steps, expected):
    from agent_mc_autonomy.controller import observation_call

    assert observation_call("mc_do", {"steps": steps}) is expected


def test_corrected_body_plan_replaces_its_rejection_without_claiming_completion(
        framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.result = {"failed": True, "protocol": "agent-mc/v1", "text": REJECTED}
    run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
    assert "earlier steps did not run" in controller.tool_failure["next_step"]
    bridge.result = {"protocol": "agent-mc/v1", "text": "accepted", "execution": action()}
    run_async(controller.execute_model_call("mc_do", {"steps": PLAN["steps"][:1]}))
    assert controller.tool_failure is None
    assert controller.pending[("task", "body-1")]["terminal"] is False
    assert controller.pending[("task", "body-1")]["goalCompleted"] is False


def test_feedback_waits_for_its_queued_scout_before_planning_again(framework_module, tmp_path, run_async):
    seen = []

    async def decide(messages, _):
        seen.append(messages)
        return {"content": None, "tool_calls": [{"id": "scout-1", "type": "function",
                "function": {"name": "mc_scout", "arguments": '{"steps":[{"skill":"observe","mode":"voxels"}]}'}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_scout", "inputSchema": {"type": "object"}})
    original = bridge.call

    async def call(name, args, **metadata):
        return await original("mc_do" if name == "mc_scout" else name, args, **metadata)

    bridge.call = call
    controller.active_goal = {"id": "new-intent", "goal": "Inspect a local site", "mode": "insert", "origin": "user"}
    controller.feedback_pending = True
    run_async(controller.turn_once("survive", "rules", module.model_tools(bridge.tools)))
    assert len(seen) == 1  # Acceptance is not the queued observation's result.
    assert controller.pending[("task", "body-1")]["terminal"] is False
    assert controller.feedback_pending  # A read does not consume the body's insertion policy.
    assert [a["action"] for name, a, _ in bridge.calls if name == "mc_protocol"][-1] == "end_turn"
