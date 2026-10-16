"""A real native completion can hand off once, without relaxing failure backoff."""

import asyncio
import dataclasses
from types import SimpleNamespace

import pytest

from test_controller import action, choose, setup


@pytest.mark.parametrize("phase,read_only,retry_until,early", [
    ("completed", False, 0, True),
    ("completed", True, 0, False),
    ("blocked", False, 0, False),
    ("completed", False, 1020, False),
])
def test_native_completion_handoff_timing(
        framework_module, tmp_path, run_async, monkeypatch, phase, read_only, retry_until, early):
    clock, decisions, delivered = [1000], [], [False]

    async def decide(*_):
        decisions.append(clock[0])
        response = choose()
        response["tool_calls"][0]["function"]["arguments"] = (
            '{"steps":[{"skill":"observe"}]}' if read_only
            else '{"steps":[{"skill":"collect","block":"oak_log","count":2}]}')
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1030)
    controller.settings = dataclasses.replace(controller.settings, min_decision_seconds=10, max_tool_rounds=1)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)

    def complete():
        if not delivered[0] and clock[0] >= 1002 and controller.pending:
            delivered[0] = True
            controller.planner_retry_at = retry_until
            bridge.event_pages.append([{"cursor": 1, "trigger": "piggyback",
                "execution": {**action(terminal=True), "phase": phase,
                              "evidence": {"receipt": "Original terminal evidence"}}}])

    bridge.on_poll = complete
    run_async(controller.run("survive"))
    assert len(decisions) == 2 and decisions[0] == 1000
    assert decisions[1] == (1002 if early else retry_until or 1010)
    assert bridge.closed


def test_completion_handoff_is_consumed_and_duplicate_receipts_cannot_rearm_it(
        framework_module, tmp_path, run_async):
    async def decide(*_):
        return {"content": "Wait for useful new evidence", "tool_calls": []}

    _, _, controller = setup(framework_module, tmp_path, decide)
    controller.action_requests[("task", "body-1")] = (
        "mc_do", {"steps": [{"skill": "collect", "block": "oak_log", "count":2}]}, "request-1", False)
    controller.receipt({"execution": action(terminal=True)})
    assert controller.continuation_ready is True
    run_async(controller.turn_once("survive", "stable prefix", []))
    assert controller.continuation_ready is False
    controller.receipt({"execution": action(terminal=True)})
    assert controller.continuation_ready is False
    assert controller.planner_retry_at > 0  # A plain reply retains its normal bounded wait.


@pytest.mark.parametrize("active", [True, False])
def test_only_an_actual_goal_transition_readies_the_next_stage(
        framework_module, tmp_path, run_async, active):
    _, _, controller = setup(framework_module, tmp_path, None)
    reports = []
    controller.commands = SimpleNamespace(
        report_goal=lambda goal_id, report: reports.append((goal_id, report)),
        resume_goal=lambda: {"id": "parent", "goal": "survive"},
        reassess_host_stages=lambda _: False, active_goal=lambda: controller.active_goal,
        historical_goal=lambda _: None)
    controller.active_goal = {"id": "child", "goal": "gather wood"} if active else None
    result, _ = run_async(controller.dispatch("goal_report", {
        "outcome": "reported_done", "evidence": "Original inventory and terminal receipt"}, "report-request"))
    assert getattr(controller, "continuation_ready", False) is active
    if active:
        assert controller.active_goal["id"] == "parent"
        assert reports[0][1]["verified"] is False
    else:
        assert result["failed"] is True and reports == []
