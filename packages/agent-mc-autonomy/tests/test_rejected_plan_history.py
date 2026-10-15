"""Rejected proposals must not crowd real evidence out of the next decision."""

import copy
import json

import pytest

from agent_mc_autonomy.context import assemble, encode
from test_controller import setup


def rejected(index, *, name="mc_do", result=None, steps=None):
    call_id = f"call-{index}"
    return [{"role": "assistant", "content": None, "tool_calls": [{
        "id": call_id, "type": "function", "function": {"name": name, "arguments": encode({
            "steps": steps or [{"skill": "craft", "item": "cooked_cod", "count": index + 1}]})}}]},
        {"role": "tool", "tool_call_id": call_id, "content": encode(result or {
            "failed": True, "execution": None, "text": "Use smelt input/fuel; no crafting recipe.",
            "meta": {"admission": {"accepted": False, "rule": "craft.invalid", "kind": "repeat"}},
            "original_chunks": [f"artifact-{index}"]})}]


def request(groups, **options):
    return assemble("stable-prefix", [], "survive", {"parts": [{"key": "gear", "text": "cod=6"}]}, [], groups,
                    context_tokens=32768, reserved_output=2048, **options)


def test_only_latest_known_rejected_plan_is_replayed_and_originals_stay_queryable():
    groups = [rejected(i) for i in range(6)]
    before = copy.deepcopy(groups)
    failure = {"tool": "mc_do", "error": "Cooking requires smelt", "recovery": [
        {"tool": "mc_help", "arguments": {"skill": "smelt"}, "text": "smelt input/fuel"}]}
    messages, budget = request(groups, tool_failure=failure)
    calls = [call["id"] for message in messages for call in message.get("tool_calls", [])]
    assert calls == ["call-5"]
    assert [m["tool_call_id"] for m in messages if m["role"] == "tool"] == calls
    tail = json.loads(messages[-1]["content"])
    assert tail["superseded_rejected_plans"]["count"] == 5
    assert {r["handle"] for r in tail["superseded_rejected_plans"]["originals"]} == {
        f"artifact-{i}" for i in range(5)}
    assert tail["tool_failure"]["recovery"][0]["arguments"] == {"skill": "smelt"}
    assert tail["current_facts"][0]["text"] == "cod=6"
    assert budget["total"] <= budget["limit"]
    assert groups == before
    empty, _ = request([], tool_failure=failure)
    assert messages[:2] == empty[:2], "changing failures must not change the stable request prefix"


@pytest.mark.parametrize("result", [
    {"failed": True, "execution": {"id": "accepted-task", "phase": "blocked"},
     "meta": {"admission": {"accepted": False}}},
    {"failed": True, "execution": None, "text": "Outcome unknown; reconcile before replay"},
    {"failed": False, "execution": {"id": "accepted-task", "phase": "accepted"}},
    {"failed": True, "dispatched": False, "origin": "untrusted_external"},
    {"failed": True, "execution": None, "uncertain": True, "meta": {"admission": {"accepted": False}}},
])
def test_actual_execution_and_unconfirmed_outcomes_are_never_superseded(result):
    groups = [rejected(0, result=result), rejected(1), rejected(2)]
    messages, _ = request(groups, tool_failure={"tool": "mc_do", "error": "recipe rejected"})
    calls = [call["id"] for m in messages for call in m.get("tool_calls", [])]
    assert calls == ["call-0", "call-2"]


@pytest.mark.parametrize("name,steps", [
    ("mc_bag", [{"skill": "craft", "item": "cooked_cod"}]),
    ("mc_scout", [{"skill": "observe", "mode": "voxels"}]),
    ("mc_do", [{"skill": "find", "target": "coal"}]),
])
def test_read_exchanges_remain_available(name, steps):
    groups = [rejected(0, name=name, steps=steps), rejected(1), rejected(2)]
    messages, _ = request(groups, tool_failure={"tool": "mc_do", "error": "recipe rejected"})
    calls = [call["id"] for m in messages for call in m.get("tool_calls", [])]
    assert calls == ["call-0", "call-2"]


def test_large_rejection_projection_retains_native_admission_proof(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    result = {"failed": True, "execution": None, "text": "Cannot craft cooked_cod.",
              "meta": {"admission": {"accepted": False, "rule": "craft.invalid", "kind": "correction",
                                    "recovery": [{"tool": "mc_help", "arguments": {"skill": "smelt"},
                                                  "text": "native guide " * 1000}]}}}
    before = copy.deepcopy(result)
    compact = json.loads(run_async(controller.archive_receipt("rejected-original", "mc_do", result)))
    assert compact["meta"]["admission"] == {"accepted": False, "rule": "craft.invalid", "kind": "correction"}
    assert compact["original_chunks"]
    assert result == before
    original = json.loads((tmp_path / "receipts.jsonl").read_text(encoding="utf-8"))
    assert original["result"] == result
    assert all(call[0] == "mc_artifact" for call in bridge.calls)


def test_mixed_read_action_exchange_and_history_without_active_failure_are_kept():
    mixed = rejected(0)
    mixed[0]["tool_calls"].insert(0, {"id": "bag", "type": "function", "function": {
        "name": "mc_bag", "arguments": "{}"}})
    mixed.insert(1, {"role": "tool", "tool_call_id": "bag", "content": encode({"text": "cod=6"})})
    messages, _ = request([mixed, rejected(1), rejected(2)], tool_failure={"error": "rejected"})
    assert [m["tool_call_id"] for m in messages if m["role"] == "tool"] == ["bag", "call-0", "call-2"]
    messages, _ = request([rejected(1), rejected(2)])
    assert [m["tool_call_id"] for m in messages if m["role"] == "tool"] == ["call-1", "call-2"]
