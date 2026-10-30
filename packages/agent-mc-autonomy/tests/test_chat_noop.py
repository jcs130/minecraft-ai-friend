"""Regress the native duplicate-chat loop without a model, game or host SDK."""
import copy
import json

import pytest

from agent_mc_autonomy import ChatNoopReview
from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.observations import native_outcome_view
from test_controller import action, setup


PLAN = {"steps": [{"skill": "chat", "text": "同伴，能分一点食物吗？"}]}


def terminal(number, outcome="noop"):
    return {"kind": "task", "id": f"executor:{number}", "terminal": True, "phase": "completed",
            "evidence": {"steps": [{"step": 1, "outcome": outcome,
                                    "decision": {"status": outcome}, "why": "原生回执，不按文字推测"}]}}


def reference(number, run="native-run"):
    return {"run": run, "cursor": number, "ts": "2026-10-30T17:26:47+08:00"}


def record(book, number, **kwargs):
    return book.record(copy.deepcopy(kwargs.get("plan", PLAN)), kwargs.get("execution", terminal(number)),
                       kwargs.get("scope", "realm/account"), kwargs.get("epoch", 0),
                       kwargs.get("reference", reference(number)))


def test_repeated_typed_noops_get_nonbinding_review_without_fake_effects():
    book = ChatNoopReview()
    assert record(book, 1) is None
    review = record(book, 2)
    assert review["native_noops"] == 2
    assert review["first_event"] == reference(1)
    assert review["latest_event"] == reference(2)
    assert review["physical_effect"] == "unknown"
    assert review["new_delivery_verified"] is False
    assert review["goal_verified"] is False
    assert PLAN["steps"][0]["text"] not in json.dumps(review, ensure_ascii=False)
    assert "observedEffect" not in review
    assert record(book, 2) is None  # Duplicate terminal is not another attempt.


@pytest.mark.parametrize("change", [
    lambda e: e.update(terminal=False),
    lambda e: e.update(phase="blocked"),
    lambda e: e.update(evidence=[]),
    lambda e: e["evidence"]["steps"][0].update(step=2),
    lambda e: e["evidence"]["steps"][0].update(decision={"status": "completed"}),
    lambda e: e["evidence"]["steps"][0].pop("decision"),
])
def test_incomplete_contradictory_or_nondated_evidence_does_not_create_review(change):
    book = ChatNoopReview()
    record(book, 1)
    broken = terminal(2)
    change(broken)
    assert record(book, 2, execution=broken) is None
    assert record(book, 3, reference={}) is None
    assert record(book, 4, reference={**reference(4), "ts": "undated"}) is None


def test_new_scope_death_run_expiry_and_actual_chat_completion_retire_episodes(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("agent_mc_autonomy.chat_noop.time.monotonic", lambda: clock[0])
    book = ChatNoopReview()
    assert record(book, 1) is None
    assert record(book, 2, scope="other-account") is None
    assert record(book, 3, scope="other-account", epoch=1) is None
    assert record(book, 4, scope="other-account", epoch=1, reference=reference(4, "new-run")) is None
    clock[0] += 120
    assert record(book, 5, scope="other-account", epoch=1, reference=reference(5, "new-run")) is None
    assert record(book, 6, scope="other-account", epoch=1, reference=reference(6, "new-run"))["native_noops"] == 2
    assert record(book, 7, scope="other-account", epoch=1, execution=terminal(7, "ok")) is None
    assert record(book, 8, scope="other-account", epoch=1) is None


def test_mixed_work_commands_and_different_messages_are_not_conflated():
    book = ChatNoopReview()
    record(book, 1)
    assert record(book, 2, plan={"steps": [{"skill": "chat", "text": "另一条消息"}]}) is None
    assert record(book, 3, plan={"steps": PLAN["steps"] + [{"skill": "goto", "at": [1, 2, 3]}]}) is None
    assert record(book, 4, plan={"steps": [{"skill": "chat", "text": "/mycli status"}]}) is None
    assert record(book, 5, scope=None) is None
    for number in range(30):
        record(book, number + 100, plan={"steps": [{"skill": "chat", "text": f"消息{number}"}]})
    assert len(book.rows) <= 16


@pytest.mark.parametrize("mode", ["full", "compact"])
def test_native_controller_and_planner_projection_preserve_review_without_blocking_dispatch(
    framework_module, tmp_path, run_async, mode,
):
    from dataclasses import replace

    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.settings = replace(controller.settings, context_mode=mode)
    controller.game_scope = "realm/account"
    for number in (1, 2):
        bridge.result["execution"] = {**action(), "id": f"executor:{number}"}
        run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
        execution = terminal(number)
        controller.receipt({"execution": execution, "events": [
            {**reference(number), "execution": execution}]})
    review = controller.native_outcomes[-1]["chat_noop_review"]
    assert review["native_noops"] == 2
    assert native_outcome_view(controller.native_outcomes[-1])["chat_noop_review"] == review
    messages, _ = assemble("rules", [], "goal", {}, [], [], context_tokens=32768,
                           reserved_output=2048, native_outcomes=controller.native_outcomes)
    assert json.loads(messages[-1]["content"])["recent_native_outcomes"][-1]["chat_noop_review"] == review
    bridge.result["execution"] = {**action(), "id": "executor:3"}
    run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 3
    assert controller.pending[("task", "executor:3")]["terminal"] is False
