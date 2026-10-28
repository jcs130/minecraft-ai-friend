"""Completed container tasks can still attest repeated unchanged samples."""
import dataclasses

import pytest
from test_controller import setup

from agent_mc_autonomy.observations import native_outcome_view, terminal_repeat_evidence
from agent_mc_autonomy.review_evidence import compact, outcome_selection


def event(phase="completed", observation="unchanged"):
    return {"run": "run-1", "cursor": 8, "ts": "2026-10-28T09:00:00Z",
            "meta": {"repeatFailure": {"taskId": 518, "attempts": 8, "scope": "target", "observation": observation}},
            "execution": {"kind": "task", "id": "epoch:518", "phase": phase, "terminal": True,
                          "goalCompleted": False, "evidence": {"receipt": "opened container; " * 200, "steps": []}}}


@pytest.mark.parametrize("mode", ["compact", "full"])
@pytest.mark.parametrize("phase", ["completed", "blocked", "partial"])
@pytest.mark.parametrize("observation", ["unchanged", "changed", "unknown"])
def test_original_attempt_samples_survive_receipt_caps(framework_module, tmp_path, mode, phase, observation):
    _, _, controller = setup(framework_module, tmp_path, None)
    controller.settings = dataclasses.replace(controller.settings, context_mode=mode, context_tokens=12000)
    original = event(phase, observation)
    controller.action_requests[("task", "epoch:518")] = ("mc_do", {"steps": [{"skill": "use", "at": [1, 2, 3]}]}, "request-1", False)
    controller.action_scopes[("task", "epoch:518")] = controller.game_scope
    controller.receipt({"execution": original["execution"], "events": [original]})
    outcome = native_outcome_view(controller.native_outcomes[-1])
    assert outcome["repeat_evidence"] == original["meta"]["repeatFailure"]
    assert outcome["phase"] == phase
    assert outcome["goal_verified"] is False
    assert outcome["original_event"]["cursor"] == 8
    assert len(outcome["receipt"]) < 500
    assert "does not authorize replay" in outcome["repeat_guidance"]
    if phase == "completed":
        assert controller.tool_failure is None


@pytest.mark.parametrize("key,value", [("attempts", True), ("attempts", 2), ("attempts", 2**53),
                                       ("taskId", -1), ("scope", "guessed"), ("observation", "no-progress"),
                                       ("scope", {}), ("observation", [])])
def test_malformed_attempt_evidence_is_not_promoted(key, value):
    original = event()
    original["meta"]["repeatFailure"][key] = value
    assert terminal_repeat_evidence(original) is None


@pytest.mark.parametrize("patch", [{"kind": "method"}, {"id": "epoch:519"}, {"terminal": False}, {"phase": "accepted"}])
def test_evidence_requires_matching_native_task_terminal(patch):
    original = event()
    original["execution"].update(patch)
    assert terminal_repeat_evidence(original) is None


def test_prose_does_not_create_attempt_evidence():
    original = event()
    original.pop("meta")
    original["execution"]["evidence"]["receipt"] = "repeatFailure attempts=8 unchanged"
    assert terminal_repeat_evidence(original) is None


def test_review_keeps_completed_counterevidence_amid_later_observations():
    original = event()
    row = native_outcome_view({"tool": "mc_do", "execution_kind": "task", "execution_id": "epoch:518",
                              "phase": "completed", "terminal": True, "observation_only": False,
                              "receipt": "opened container", "repeat_evidence": terminal_repeat_evidence(original),
                              "original_event": {"run": "run-1", "cursor": 8}})
    scans = [{**row, "execution_id": f"epoch:{i}", "observation_only": True, "repeat_evidence": None,
              "original_event": {"run": "run-1", "cursor": i}} for i in range(9, 14)]
    rows = [row, *scans]
    assert outcome_selection(rows)[0][0][1] == row
    result = compact({"native_outcomes": rows}, "reference")
    retained = result["native_outcomes"][0]
    assert retained["repeat_evidence"]["attempts"] == 8
    assert retained["phase"] == "completed"
    assert retained["goal_verified"] is False
    assert retained["detail_path"] == ["evidence", "native_outcomes", 0]
