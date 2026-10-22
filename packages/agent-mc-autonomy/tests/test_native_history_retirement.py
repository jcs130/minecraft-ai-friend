"""An evicted native history source must not be resurrected as a full tail copy."""
import copy
import dataclasses
import json

from test_controller import setup

from agent_mc_autonomy.context import assemble, encode
from agent_mc_autonomy.context_evidence import (
    outcome_id,
    outcome_message,
    retire_native_sources,
)
from agent_mc_autonomy.scene_history import capture_scene


def outcomes(count=24):
    return [{"tool": "mc_do", "execution_kind": "task", "execution_id": f"native:{i}",
             "terminal": True, "phase": "completed", "observation_only": False,
             "goal_verified": False, "receipt": (f"Original terminal {i}. " * 180),
             "original_event": {"run": "native", "cursor": i + 1}} for i in range(count)]


def request(rows, groups, limit):
    return assemble("fixed contract", [], "continue playing", {"parts": [{"key": "health", "text": "20"}]}, [], groups,
                    context_mode="full", context_tokens=limit, reserved_output=512, native_outcomes=rows)


def test_real_window_retirement_does_not_reinline_evicted_native_sources():
    rows = outcomes()
    before = copy.deepcopy(rows)
    _, inline = request(rows, [], 1000000)
    groups = [[outcome_message(row)] for row in rows]
    messages, budget = request(rows, groups, inline["total"])
    assert budget["history"]["evicted"] > 0
    retired = budget["history"].get("retired_native_outcome_ids", [])
    assert retired, "Native groups were evicted, but their identical full receipts returned in the fresh tail."
    tail = json.loads(messages[-1]["content"])
    assert not any(outcome_id(row) in retired for row in tail.get("recent_native_outcomes", []))
    assert any(row.get("execution_id") == rows[-1]["execution_id"] for row in
               tail.get("retired_native_outcomes", [])) is False
    assert tail["context_omissions"]["native_outcomes_retired_with_history"] == len(retired)
    assert {row["execution_id"] for row in tail["retired_native_outcomes"]} == {
        row["execution_id"] for row in rows if outcome_id(row) in retired}
    assert rows == before


def test_fitting_originals_are_never_retired_to_anticipate_a_slow_model():
    rows = outcomes()
    groups = [[outcome_message(row)] for row in rows]
    messages, budget = request(rows, groups, 1000000)
    assert budget["history"]["evicted"] == 0
    assert not budget["history"].get("retired_native_outcome_ids")
    assert "retired_native_outcomes" not in json.loads(messages[-1]["content"])
    assert messages[2:-1] == [m for group in groups for m in group]


def test_unrelated_history_retirement_does_not_discard_other_terminal_evidence():
    rows = outcomes(3)
    _, inline = request(rows, [], 1000000)
    old = [[{"role": "user", "content": "historical text " * 1000}, {"role": "assistant", "content": "past"}]]
    messages, budget = request(rows, old, inline["total"])
    assert budget["history"]["evicted"] == 1
    assert not budget["history"].get("retired_native_outcome_ids")
    assert json.loads(messages[-1]["content"])["recent_native_outcomes"] == rows


def test_controller_does_not_reintroduce_retired_terminal_on_following_turn(framework_module, tmp_path, run_async):
    captured = []
    async def decide(messages, tools):
        captured.append(copy.deepcopy(messages))
        return {"content": "Continue after observing the latest facts.", "tool_calls": []}
    _, _, controller = setup(framework_module, tmp_path, decide)
    rows = outcomes()
    controller.settings = dataclasses.replace(controller.settings, context_mode="full", context_tokens=26000)
    controller.native_outcomes = copy.deepcopy(rows)
    controller.groups = [[outcome_message(row)] for row in rows]
    controller.outcome_history_ids = {outcome_id(row) for row in rows}
    original_ids = set(controller.outcome_history_ids)
    controller.retain_history()
    retained = {outcome_id(row) for row in controller.native_outcomes}
    assert retained < original_ids, "Standalone history overflow kept all retired receipts in the recent tail."
    assert outcome_id(rows[-1]) in retained
    assert controller.pending == {}
    for _ in range(2):
        run_async(controller.turn_once("continue playing", "fixed contract", []))
    assert {outcome_id(row) for row in controller.native_outcomes} <= retained
    assert len(captured) == 2
    assert all(len(encode(messages).encode()) <= controller.settings.context_tokens for messages in captured)


def test_latest_terminal_remains_literal_when_even_its_source_group_must_go():
    rows = outcomes(1)
    _, inline = request(rows, [], 1000000)
    messages, budget = request(rows, [[outcome_message(rows[0])]], inline["total"])
    assert budget["history"]["evicted"] == 1
    assert not budget["history"]["retired_native_outcome_ids"]
    assert json.loads(capture_scene(messages)["content"])["recent_native_outcomes"] == rows


def test_retirement_requires_exact_content_and_execution_kind_not_just_number():
    first = outcomes(1)[0]
    method = {**first, "execution_kind": "method"}
    revised = {**first, "receipt": "different terminal evidence"}
    latest = outcomes(2)[-1]
    rows = [first, method, revised, latest]
    kept, retired = retire_native_sources(rows, {outcome_id(first), outcome_id(latest)})
    assert kept == [method, revised, latest]
    assert [v["outcome_id"] for v in retired] == [outcome_id(first)]


def test_margin_probes_use_real_native_retirement_without_mutating_sources():
    rows = outcomes(12)
    groups = [[outcome_message(row)] for row in rows]
    original = copy.deepcopy((rows, groups))
    _, inline = request(rows, [], 1000000)
    messages, budget = assemble("fixed contract", [], "continue playing", {"parts": []}, [], groups,
        context_mode="full", context_tokens=inline["total"], reserved_output=512,
        context_history_headroom_tokens=1024, native_outcomes=rows)
    assert budget["history"]["retirement_growth_units"] >= len(rows[0]["receipt"].encode()) - 512
    assert budget["history"]["retired_native_outcome_ids"]
    assert capture_scene(messages) is not None
    assert (rows, groups) == original


def test_controller_commits_assembly_retirement_even_before_model_failure(framework_module, tmp_path, run_async):
    async def rejected(*_):
        raise TimeoutError("offline original deadline")
    _, _, controller = setup(framework_module, tmp_path, rejected)
    controller.settings = dataclasses.replace(controller.settings, context_mode="full", context_tokens=26000)
    rows = outcomes(6)
    controller.native_outcomes = copy.deepcopy(rows)
    controller.groups = [[outcome_message(row)] for row in rows]
    controller.outcome_history_ids = {outcome_id(row) for row in rows}
    controller.groups.insert(0, [{"role": "user", "content": "Old exchange. " * 1000}])
    run_async(controller.turn_once("continue playing", "contract", []))
    assert 0 < len(controller.native_outcomes) < len(rows)
    assert controller.native_outcomes[-1] == rows[-1]
    retired = {outcome_id(row) for row in rows} - {outcome_id(row) for row in controller.native_outcomes}
    controller.freeze_native_history()
    assert not retired.intersection(controller.outcome_history_ids)


def test_replay_retirement_never_changes_originals_or_pending_barriers(framework_module, tmp_path):
    _, _, controller = setup(framework_module, tmp_path, None)
    rows = outcomes(3)
    controller.native_outcomes = copy.deepcopy(rows)
    controller.pending = {("task", "live"): {"phase": "accepted"}}
    controller.inflight_request = {"request_id": "unknown-dispatch"}
    before = copy.deepcopy((controller.pending, controller.inflight_request))
    journal = tmp_path / "receipts.jsonl"
    journal.write_text(encode(rows), encoding="utf-8")
    original = journal.read_bytes()
    controller.retire_native_history({outcome_id(row) for row in rows})
    assert controller.native_outcomes == [rows[-1]]
    assert (controller.pending, controller.inflight_request) == before
    assert journal.read_bytes() == original
