"""Retiring standalone receipt history must not duplicate it in every scene."""
import copy
import json

import pytest

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.context_evidence import outcome_message
from agent_mc_autonomy.scene_history import capture_scene


def outcome(execution="task-1", receipt=None):
    return {"execution_id": execution, "terminal": True, "phase": "completed",
            "goal_verified": False, "receipt": receipt or "原始动作回执；保护拒绝不可当成成功。" * 150}


def scene(groups=(), outcomes=()):
    return assemble("stable", [], "survive", {"parts": []}, [], list(groups),
                    native_outcomes=list(outcomes), context_mode="full",
                    context_tokens=131072, reserved_output=8192)[0]


def test_surviving_scene_is_an_exact_receipt_source_after_standalone_history_retires():
    receipt = outcome()
    first = capture_scene(scene(outcomes=[receipt]))
    second = scene([[first]], [receipt])
    value = json.loads(second[-1]["content"])
    source = json.loads(first["content"])["context_id"]
    assert value["recent_native_outcomes"] == [{"context_ref": source,
                                                "pointer": "/recent_native_outcomes/0"}]
    assert json.loads(capture_scene(second)["content"])["recent_native_outcomes"] == [receipt]
    assert len(second[-1]["content"].encode()) < len(first["content"].encode()) / 2


def test_scene_receipt_refs_rebase_without_chains_and_preserve_append_prefix():
    receipt = outcome()
    first = capture_scene(scene(outcomes=[receipt]))
    second_messages = scene([[first]], [receipt])
    second = capture_scene(second_messages)
    third = scene([[first], [second]], [receipt])
    assert third[:-1] == second_messages
    assert json.loads(capture_scene(third)["content"])["recent_native_outcomes"] == [receipt]
    # The oldest literal scene has now retired. The surviving one must become
    # literal, with a fresh direct reference in the current scene.
    retired = scene([[second]], [receipt])
    assert json.loads(retired[2]["content"])["recent_native_outcomes"] == [receipt]
    assert json.loads(retired[-1]["content"])["recent_native_outcomes"] == [
        {"context_ref": json.loads(second["content"])["context_id"],
         "pointer": "/recent_native_outcomes/0"}]
    assert json.loads(capture_scene(retired)["content"])["recent_native_outcomes"] == [receipt]


def test_native_source_precedes_scene_ref_and_different_attempts_remain_distinct():
    old = outcome()
    original = copy.deepcopy(old)
    first = capture_scene(scene(outcomes=[old]))
    changed = outcome("task-2", old["receipt"])
    newest = scene([[first], [outcome_message(changed)]], [old, changed, outcome("task-3")])
    projected = json.loads(newest[-1]["content"])["recent_native_outcomes"]
    assert "pointer" in projected[0]
    assert set(projected[1]) == {"context_ref"}
    assert projected[2]["execution_id"] == "task-3"
    assert json.loads(capture_scene(newest)["content"])["recent_native_outcomes"] == [old, changed, outcome("task-3")]
    assert old == original


@pytest.mark.parametrize("field", ["phase", "goal_verified", "receipt"])
def test_changed_receipt_and_unverified_outcome_are_not_reused(field):
    old = outcome()
    first = capture_scene(scene(outcomes=[old]))
    changed = {**old, field: {"phase": "failed", "goal_verified": True, "receipt": "different"}[field]}
    not_terminal = {**old, "terminal": False}
    messages = scene([[first]], [changed, not_terminal])
    assert json.loads(messages[-1]["content"])["recent_native_outcomes"] == [changed, not_terminal]


def test_tampered_scene_receipt_source_is_rejected_by_integrity_check():
    receipt = outcome()
    first = capture_scene(scene(outcomes=[receipt]))
    messages = scene([[first]], [receipt])
    source = json.loads(messages[2]["content"])
    source["recent_native_outcomes"][0]["receipt"] += "tampered"
    messages[2]["content"] = json.dumps(source)
    with pytest.raises(ValueError, match="scene_integrity_invalid"):
        capture_scene(messages)
