"""Known tool no-ops must not throttle unrelated model-selected work."""
import asyncio
import dataclasses
import json
from types import SimpleNamespace

import pytest
from test_controller import action, packed, setup
from test_death_memory import event, facts
from test_death_report_progress import report
from test_immediate_completion import PLAN, immediate


@pytest.mark.parametrize("kind", ["arrival", "saved_lesson"])
def test_repeated_tool_noop_preserves_independent_wait_and_idle_reply_count(
        framework_module, tmp_path, run_async, monkeypatch, kind):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: 1000))
    published = []
    controller.publish = lambda **patch: published.append(patch)
    if kind == "saved_lesson":
        controller.observe_game_facts(facts())
        controller.death_memory.record(event(), facts(), [], [], [])
        run_async(controller.execute_model_call("death_review", report()))
        name, arguments = "death_review", report()
    else:
        bridge.result = immediate()
        name, arguments = "mc_do", PLAN
    controller.planner_retry_at = 1027  # A separate real provider deadline.
    controller.unactioned_replies = 4  # Plain replies have their own idle policy.
    for _ in range(12):
        result, _, boundary = run_async(controller.execute_model_call(name, arguments))
        assert boundary and not result.get("failed")
        assert controller.planner_retry_at == 1027
        assert controller.unactioned_replies == 4
        assert controller.continuation_needed
        assert published[-1]["planner_retry_seconds"] == 27
    assert not controller.pending and controller.inflight_request is None
    assert not any(name == "mc_stop" for name, *_ in bridge.calls)


@pytest.mark.parametrize("kind", ["arrival", "saved_lesson"])
def test_real_scheduler_can_choose_new_work_after_tool_noops_at_normal_cadence(
        framework_module, tmp_path, run_async, monkeypatch, kind):
    clock, seen = [1000.0], []

    async def decide(messages, _):
        seen.append((clock[0], messages))
        name, arguments = ("death_review", report()) if kind == "saved_lesson" else ("mc_do", PLAN)
        if len(seen) == 4:
            name, arguments = "mc_do", {"steps": [{"skill": "goto", "at": [12, 64, 20]}]}
        return {"tool_calls": [{"id": f"noop-{len(seen)}", "type": "function",
                "function": {"name": name, "arguments": json.dumps(arguments)}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    controller.settings = dataclasses.replace(controller.settings, min_decision_seconds=2,
        idle_decision_seconds=60, max_decisions=3 if kind == "saved_lesson" else 4)
    original_call = bridge.call

    async def call(name, arguments, **kwargs):
        if name == "mc_protocol" and arguments["action"] == "facts" and kind == "saved_lesson":
            return packed(facts())
        if name == "mc_do":
            bridge.result = immediate() if arguments["steps"] == PLAN["steps"] else {
                "protocol": "agent-mc/v1", "text": "fixture completed",
                "execution": action(terminal=True), "endsTurn": True}
        return await original_call(name, arguments, **kwargs)

    bridge.call = call
    if kind == "saved_lesson":
        controller.observe_game_facts(facts())
        controller.death_memory.record(event(), facts(), [], [], [])
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)
    run_async(controller.run("original standing goal"))
    assert len(seen) == 4
    times = [at for at, _ in seen]
    assert times == ([1000, 1000, 1002, 1004] if kind == "saved_lesson" else [1000, 1002, 1004, 1006])
    actual = [args for name, args, _ in bridge.calls if name == "mc_do"]
    assert actual[-1]["steps"] == [{"skill": "goto", "at": [12, 64, 20]}]
    assert controller.unactioned_replies == 0 and controller.planner_retry_at == 0
    assert controller.inflight_request is None
    receipts = [json.loads(line) for line in (tmp_path / "receipts.jsonl").read_text().splitlines()]
    assert len(receipts) == 4  # All original results, including no-ops, remain journaled.
    assert not any(name == "mc_stop" for name, *_ in bridge.calls)
