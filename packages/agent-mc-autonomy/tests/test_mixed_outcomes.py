"""Real cursor463/467 receipts through controller ingestion and public review."""
import copy
import json
from pathlib import Path

import pytest
from test_controller import setup
from test_review import runtime as review_runtime

from agent_mc_autonomy.commentary import commentary_observation

FIXTURE = json.loads((Path(__file__).parent / "fixtures/mixed_outcomes.json").read_text(encoding="utf-8"))


@pytest.fixture
def runtime(tmp_path):
    return review_runtime.__wrapped__(tmp_path)


def ingest(framework_module, tmp_path, run_async, event, count=4):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    terminal = event["execution"]
    preview = FIXTURE["accepted_task74" if count == 5 else "accepted_tool"]["text"]
    accepted = {**terminal, "phase": "accepted", "terminal": False,
                "evidence": {"receipt": preview}}
    bridge.result = {"protocol": "agent-mc/v1", "text": preview, "execution": accepted}
    # Submitted arguments go through the actual dispatch/correlation path.
    steps = [
        {"skill": "craft", "item": item, "count": amount} for item, amount in
        [("oak_planks", 16), ("crafting_table", 1), ("wooden_axe", 1), ("torch", 8)]
    ]
    for index, needs in ((1, [1]), (2, [2]), (3, [2])):
        steps[index]["needs"] = needs
    if count == 5:
        steps = [{"skill": "craft", "item": item, "count": amount} for item, amount in
                 [("stick", 4), ("crafting_table", 1), ("wooden_shovel", 1), ("wooden_axe", 1)]]
        steps.append({"skill": "find", "target": "stone", "distance": 48})
    elif count != 4:
        steps = [{"skill": "craft", "item": "oak_planks", "count": 4}] * count
    run_async(controller.execute_model_call("mc_do", {"steps": steps}))
    assert not controller.native_outcomes  # Accepted preview is never terminal evidence.
    controller.receipt({"execution": terminal, "events": [event]})
    return controller, accepted


def inspect(runtime, controller):
    port, _, publish = runtime
    status = publish(native_outcomes=controller.native_outcomes)
    review = port.offer().get("review") or port.state()["review"]
    return port.decide(review["id"], "inspect"), review, status


@pytest.mark.parametrize("cursor,count,expected", [("463", 5, {1: "ok", 2: "fail", 3: "ok", 4: "fail", 5: "ok"}),
                                                   ("467", 4, {1: "ok", 2: "ok", 3: "ok", 4: "fail"})])
def test_real_mixed_terminal_survives_public_review_and_commentary(framework_module, tmp_path, run_async, runtime, cursor, count, expected):
    event = FIXTURE[cursor]
    controller, accepted = ingest(framework_module, tmp_path, run_async, event, count)
    controller.receipt({"execution": accepted})  # An older preview cannot evict the measured terminal.
    assert ("task", accepted["id"]) not in controller.pending
    detail, review, status = inspect(runtime, controller)
    row = detail["native_outcomes"][-1]
    assert row["phase"] == "blocked" and row["terminal"] is True
    assert row["goalCompleted"] is False and row["goal_verified"] is False
    steps = row["step_outcomes"]
    assert {s["step"]: s["outcome"] for s in steps["samples"]} == expected
    assert steps["mixed"] is True and steps["omitted"] == 0
    assert steps["counts"]["ok"] == 3 and steps["counts"]["fail"] == count - 3
    assert row["original_event"] == {key: event[key] for key in ("run", "cursor", "ts")}
    assert "mc_protocol" in steps["query"] and "original_event.cursor" in steps["query"]
    assert all("verified" not in step for step in steps["samples"])
    assert len(row["receipt"].encode()) <= 450
    assert "成功与未成功并存" in review["summary"]
    commentary = commentary_observation(status, runtime[1][0])
    assert commentary["payload"]["body_feedback"]["native_outcomes"][-1] == row
    assert "terminal" in detail["outcome_precedence"]
    if cursor == "467":
        original = event["execution"]["evidence"]["receipt"]
        assert original.encode().find("做成的".encode()) == 458
        assert "做成的" not in row["receipt"]


@pytest.mark.parametrize("raw", [None, {}, "bad", [], [None], [{"step": 1, "outcome": "invented"}],
    [{"step": True, "outcome": "ok"}], [{"step": 0, "outcome": "ok"}],
    [{"step": 5, "outcome": "ok"}], [{"step": 1, "outcome": "ok", "why": {}}],
    [{"step": 1, "outcome": "ok"}, {"step": 1, "outcome": "fail"}]])
def test_unusable_steps_remain_unknown_in_public_review(framework_module, tmp_path, run_async, runtime, raw):
    event = copy.deepcopy(FIXTURE["467"])
    event["execution"]["evidence"]["steps"] = raw
    controller, _ = ingest(framework_module, tmp_path, run_async, event)
    row = inspect(runtime, controller)[0]["native_outcomes"][-1]
    assert row["step_outcomes"]["status"] == "unknown"
    assert not row["step_outcomes"]["samples"]
    assert not row["goal_verified"] and row["goalCompleted"] is False


def test_large_steps_keep_counts_both_groups_and_utf8_bound(framework_module, tmp_path, run_async, runtime):
    event = copy.deepcopy(FIXTURE["467"])
    event["execution"]["evidence"]["steps"] = [
        {"step": i + 1, "outcome": "ok" if i < 997 else ["noop", "partial", "fail"][i - 997],
         "why": None if i < 997 else "多字节理由" * 5000} for i in range(1000)]
    controller, _ = ingest(framework_module, tmp_path, run_async, event, 1000)
    row = inspect(runtime, controller)[0]["native_outcomes"][-1]
    steps = row["step_outcomes"]
    assert steps["total"] == steps["valid"] == 1000 and steps["invalid"] == 0
    assert steps["counts"]["ok"] == 997 and steps["counts"]["fail"] == 1
    assert steps["omitted"] == 1000 - len(steps["samples"])
    assert {s["outcome"] for s in steps["samples"]} == {"ok", "noop", "partial", "fail"}
    assert len(json.dumps(row, ensure_ascii=False).encode()) < 3200
    assert all(s["why"] is None or len(s["why"].encode()) <= 120 for s in steps["samples"])
    assert len(json.dumps(controller.native_outcomes, ensure_ascii=False).encode()) < 3200


def test_missing_evidence_and_partial_validation_are_explicit(framework_module, tmp_path, run_async, runtime):
    event = copy.deepcopy(FIXTURE["467"])
    event["execution"]["evidence"] = {"steps": [{"step": 1, "outcome": "noop"},
        {"step": 2, "outcome": "skip", "why": None}, {"step": 3, "outcome": "cut", "why": "cancelled"},
        {"step": 9, "outcome": "ok"}]}
    controller, _ = ingest(framework_module, tmp_path, run_async, event)
    steps = inspect(runtime, controller)[0]["native_outcomes"][-1]["step_outcomes"]
    assert steps["status"] == "partial" and steps["invalid"] == 1 and steps["valid"] == 3
    assert steps["counts"] == {"ok": 0, "noop": 1, "partial": 0, "fail": 0, "skip": 1, "cut": 1}
    assert "why" not in steps["samples"][0]


@pytest.mark.parametrize("evidence", [None, {}, {"receipt": "旧回执"}])
def test_absent_steps_do_not_acquire_status_from_prose(framework_module, tmp_path, run_async, runtime, evidence):
    event = copy.deepcopy(FIXTURE["467"])
    event["execution"]["evidence"] = evidence
    controller, _ = ingest(framework_module, tmp_path, run_async, event)
    row = inspect(runtime, controller)[0]["native_outcomes"][-1]
    assert row["step_outcomes"]["status"] == "unknown"
    assert row["step_outcomes"]["total"] is None


def test_public_projection_rejects_older_preview_and_bounds_corrupt_summary(framework_module, tmp_path, run_async, runtime):
    controller, _ = ingest(framework_module, tmp_path, run_async, FIXTURE["467"])
    terminal = controller.native_outcomes[-1]
    controller.native_outcomes.append({**terminal, "terminal": False, "phase": "accepted"})
    row = inspect(runtime, controller)[0]["native_outcomes"][-1]
    assert row["phase"] == "blocked" and row["step_outcomes"]["counts"]["ok"] == 3
    controller.native_outcomes = [{**terminal, "step_outcomes": {"samples": ["坏"] * 20000}}]
    row = inspect(runtime, controller)[0]["native_outcomes"][-1]
    assert row["step_outcomes"]["status"] == "unknown"
    assert len(json.dumps(row, ensure_ascii=False).encode()) < 3200
