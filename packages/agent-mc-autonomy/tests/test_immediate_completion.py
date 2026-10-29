import dataclasses
import json

import pytest
from test_controller import action, setup

PLAN = {"steps": [{"skill": "goto", "at": [10, 64, 20]}]}


def immediate(**data):
    return {"protocol": "agent-mc/v1", "failed": False, "execution": None,
            "text": "Arrival condition already satisfied; no movement and no new task.",
            "data": {"status": "completed", "completed": 1, "remaining": 0,
                     "goal_completed": False, **data}}


def test_immediate_completion_yields_without_inventing_work(framework_module, tmp_path, run_async):
    published = []
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.publish = lambda **value: published.append(value)
    bridge.result = immediate()
    result, compact, boundary = run_async(controller.execute_model_call("mc_do", PLAN))
    assert boundary
    assert result["data"] == bridge.result["data"]
    assert json.loads(compact)["text"] == bridge.result["text"]
    assert controller.unactioned_replies == 0
    assert controller.planner_retry_at == 0
    assert controller.continuation_needed and "no new task" in controller.planner_notice
    assert not controller.pending and controller.inflight_request is None
    assert controller.action_requests == {}
    sent = next(args for name, args, _ in bridge.calls if name == "mc_do")
    assert sent == {**PLAN, "queue": "append"}  # Existing queue policy, unchanged steps.
    rows = [json.loads(line) for line in (tmp_path / "receipts.jsonl").read_text().splitlines()]
    assert len(rows) == 1 and rows[0]["result"]["execution"] is None
    assert published[-1]["planner_retry_seconds"] == 0
    bridge.result = {"protocol": "agent-mc/v1", "text": "accepted", "execution": action()}
    run_async(controller.execute_model_call("mc_do", {"steps": [{"skill": "goto", "at": [12, 64, 20]}]}))
    assert controller.unactioned_replies == 0 and ("task", "body-1") in controller.pending


def test_completed_no_task_ends_model_chain_and_retains_original_receipt(framework_module, tmp_path, run_async):
    seen = []
    async def decide(messages, _):
        seen.append(messages)
        return {"content": None, "tool_calls": [{"id": "call-" + str(len(seen)), "type": "function",
            "function": {"name": "mc_do", "arguments": json.dumps(PLAN)}}]}
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode="full", max_tool_rounds=6)
    bridge.result = immediate()
    run_async(controller.turn_once("Choose useful work", "body contract", module.model_tools(bridge.tools)))
    assert len(seen) == 1
    assert sum(name == "mc_do" for name, *_ in bridge.calls) == 1
    assert controller.groups[-1][-1]["role"] == "tool"
    assert json.loads(controller.groups[-1][-1]["content"])["text"] == bridge.result["text"]
    assert [args["action"] for name, args, _ in bridge.calls if name == "mc_protocol"][-1] == "end_turn"
    assert not controller.pending and controller.inflight_request is None


@pytest.mark.parametrize("data", [
    {"status": "accepted"}, {"completed": True}, {"completed": 1.0},
    {"completed": 0}, {"remaining": False}, {"remaining": 1}, {"goal_completed": True},
])
def test_other_envelopes_are_not_inferred_as_known_no_task_work(framework_module, tmp_path, run_async, data):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.result = immediate(**data)
    run_async(controller.execute_model_call("mc_do", PLAN))
    assert controller.unactioned_replies == 0


def test_read_preview_is_not_treated_as_idle_action(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.result = immediate()
    _, _, boundary = run_async(controller.execute_model_call("mc_do", {"steps": [{"skill": "build", "dryRun": True}]}))
    assert not boundary and controller.unactioned_replies == 0
    assert controller.read_activity == {"mc_do": 1}


def test_unknown_still_keeps_original_dispatch_fence(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.result = immediate(status="unknown")
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(controller.execute_model_call("mc_do", PLAN))
    assert controller.inflight_request and controller.unactioned_replies == 0
    assert not controller.pending
