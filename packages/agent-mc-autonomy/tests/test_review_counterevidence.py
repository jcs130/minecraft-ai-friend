"""Anonymous retained task140/143/144/145 ordering through real inspect."""
from copy import deepcopy
import json

import pytest

from agent_mc_autonomy.observations import terminal_step_outcomes
from agent_mc_autonomy.review_evidence import compact, encoded
from test_review import runtime as review_runtime
from test_review_budget import read_original


@pytest.fixture
def runtime(tmp_path):
    return review_runtime.__wrapped__(tmp_path)


def outcome(task, cursor, *, fail=False, read=False, run="native-run", samples=None):
    return {"execution_id": "body-session:" + str(task), "tool": "mc_read" if read else "mc_do",
            "observation_only": read, "terminal": True, "phase": "blocked" if fail else "completed",
            "goalCompleted": False, "goal_verified": False,
            "original_event": {"run": run, "cursor": cursor, "ts": "2026-10-16T05:24:11.243Z"},
            "receipt": "鸡蛋不是可进食物品" if fail else "搜索完成，未找到目标",
            "step_outcomes": terminal_step_outcomes({"evidence": {"steps": samples or [
                {"step": 1, "outcome": "fail" if fail else "ok", "why": "鸡蛋不是可进食物品" if fail else None}]}}, {})}


def retained():
    return [outcome(140, 705, fail=True), outcome(143, 710),
            outcome(144, 713, read=True), outcome(145, 716)]


def inspect(runtime, rows, **changes):
    port, _, publish = runtime
    publish(native_outcomes=rows, pending=[{"kind": "task", "id": "146", "phase": "running", "terminal": False}],
            facts={"parts": [{"key": "body", "text": "生命1/20，饥饿0/20"},
                             {"key": "gear", "text": "鸡蛋×1"},
                             {"key": "foodReserve", "text": "安全口粮0；风险食物spider_eye×1"},
                             {"key": "queue", "text": "当前任务146仍在执行"}]}, **changes)
    rid = port.offer()["review"]["id"]
    return port.decide(rid, "inspect", compact=True), rid


def test_displaced_actual_failure_and_previous_main_judgment_survive_real_compact(runtime):
    port, _, publish = runtime
    publish()
    previous = port.offer()["review"]["id"]
    port.decide(previous, "inspect")
    port.decide(previous, "insert", "鸡蛋不能被直接吃；需要寻找食物", "向东寻找食物")
    original_judgment = deepcopy(port.state()["last_decision"])
    runtime[1][0] += 180
    value, rid = inspect(runtime, retained())
    assert [r["execution_id"] for r in value["native_outcomes"]] == ["body-session:140", "body-session:144", "body-session:145"]
    failure, _, newest = value["native_outcomes"]
    assert failure["samples"][0]["why"] == "鸡蛋不是可进食物品"
    assert failure["original_event"] == retained()[0]["original_event"]
    assert newest["step_outcomes"]["counts"]["ok"] == 1
    assert value["pending"][0]["id"] == "146" and "spider_eye" in value["facts"]["foodReserve"]
    prior = value["prior_main_judgment"]
    assert prior["source"] == "prior_main_model_judgment" and prior["historical"] is True
    assert prior["reason"] == original_judgment["reason"]
    assert prior["request_id"] == original_judgment["request_id"]
    assert prior["at"] == original_judgment["at"]
    assert value["stage_delivery"]["delivery"] == "queued"
    assert "fresh" in value["evidence_precedence"] and "replay" in value["evidence_precedence"]
    selection = value["native_outcome_selection"]
    assert selection["omitted"] == 1 and selection["duplicates"] == 0
    assert read_original(port, rid, value["evidence_ref"], selection["detail_path"])[0]["receipt"] == retained()[0]["receipt"]
    assert read_original(port, rid, value["evidence_ref"], prior["detail_path"]) == original_judgment
    assert len(encoded(value).encode()) < 14000
    assert len(encoded(prior).encode()) <= 1100


def test_previous_judgment_is_labeled_and_does_not_replace_fresh_goal_or_scope(runtime):
    port, clock, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    port.decide(rid, "inspect")
    port.decide(rid, "continue", "鸡蛋不能被直接吃")
    original = deepcopy(port.state()["last_decision"])
    clock[0] += 180
    value, _ = inspect(runtime, [outcome(146, 1, run="new-native-run")],
                       current_goal={"id": "new-stage", "goal": "新阶段", "origin": "user"},
                       game_identity={"realm": "new-world", "username": "anonymous"})
    assert value["prior_main_judgment"]["reason"] == original["reason"]
    assert value["prior_main_judgment"]["source"] == "prior_main_model_judgment"
    assert value["current_goal"]["id"] == "new-stage" and value["current_goal"]["origin"] == "user"
    assert value["native_outcomes"][-1]["original_event"]["run"] == "new-native-run"
    assert port.state()["last_decision"] == original and not port.mailbox.ready()


def test_duplicate_source_does_not_displace_distinct_attempts():
    rows = retained()
    rows.append(deepcopy(rows[-1]))
    value = compact({"native_outcomes": rows}, "reference")
    assert [r["execution_id"] for r in value["native_outcomes"]] == ["body-session:140", "body-session:144", "body-session:145"]
    assert value["native_outcome_selection"]["duplicates"] == 1
    distinct = outcome(146, 719, run="different-run")
    rows.append(distinct)
    result = compact({"native_outcomes": rows}, "reference")
    assert [r["execution_id"] for r in result["native_outcomes"]] == ["body-session:140", "body-session:145", "body-session:146"]
    assert result["native_outcomes"][-1]["original_event"] == distinct["original_event"]


def test_later_actual_success_has_priority_without_erasing_dated_failure(runtime):
    rows = retained()[:3] + [outcome(146, 719)]
    rows[-1]["receipt"] = "实际进食成功，饥饿恢复"
    value, rid = inspect(runtime, rows)
    assert value["native_outcomes"][0]["phase"] == "blocked"
    assert value["native_outcomes"][-1]["receipt"] == rows[-1]["receipt"]
    assert value["native_outcomes"][-1]["phase"] == "completed"
    assert value["acknowledged"] is False and not runtime[0].state()["review"].get("result")
    assert "fresh" in value["evidence_precedence"]
    # Selection is a view, never a blacklist, queue mutation or automatic closure.
    assert read_original(runtime[0], rid, value["evidence_ref"], ["evidence", "native_outcomes"])[-1]["receipt"] == rows[-1]["receipt"]


def test_field_aware_samples_keep_failure_reason_and_partial_success_under_700_bytes():
    rows = [outcome(140, 705, fail=True, samples=[
        {"step": i, "outcome": "fail" if i == 8 else "ok", "why": "雪\"\\" * 1000 if i != 8 else "鸡蛋不是可进食物品"}
        for i in range(1, 9)])]
    value = compact({"native_outcomes": rows}, "reference")
    row = value["native_outcomes"][0]
    assert isinstance(row["samples"], list)
    assert {s["outcome"] for s in row["samples"]} == {"ok", "fail"}
    assert next(s for s in row["samples"] if s["outcome"] == "fail")["why"] == "鸡蛋不是可进食物品"
    assert len(encoded(row["samples"]).encode()) <= 700 and row["samples_omitted"] > 0
    assert row["step_outcomes"]["mixed"] and row["step_outcomes"]["counts"]["ok"] == 7


def test_unknown_null_and_readonly_failure_are_not_invented_action_constraints():
    unknown = outcome(140, 705)
    unknown.update(terminal=None, phase="unknown", step_outcomes=terminal_step_outcomes({}, {}))
    rows = [unknown, outcome(143, 710, fail=True, read=True), outcome(144, 713), outcome(145, 716)]
    value = compact({"native_outcomes": rows}, "reference")
    assert [r["execution_id"] for r in value["native_outcomes"]] == ["body-session:143", "body-session:144", "body-session:145"]
    direct = compact({"native_outcomes": [unknown]}, "reference")["native_outcomes"][0]
    assert direct["terminal"] is None and direct["step_outcomes"]["status"] == "unknown"


def test_real_review_preserves_failed_target_when_why_is_abridged(runtime):
    from test_effect_recovery import effect
    raw_effect = effect()
    raw_effect.update(skill="goto", at=[-540, 67, -486])
    rows = [outcome(154, 900, fail=True, samples=[
        {"step": 1, "outcome": "fail", "why": "路面高度与支撑不符；" * 50,
         "observedEffect": raw_effect}])]
    original = deepcopy(rows)
    value, rid = inspect(runtime, rows)
    sample = value["native_outcomes"][0]["samples"][0]
    assert sample["observed_effect"]["skill"] == "goto"
    assert sample["observed_effect"]["at"] == [-540, 67, -486]
    assert sample["observed_effect"]["changed"]["position"] is False
    assert sample["observed_effect"]["goal_verified"] is False
    assert len(encoded(value["native_outcomes"][0]["samples"]).encode()) <= 700
    assert rows == original
    assert read_original(runtime[0], rid, value["evidence_ref"], ["evidence", "native_outcomes"])[0]["step_outcomes"]["samples"][0]["observed_effect"]["at"] == [-540, 67, -486]


def test_review_effect_projection_keeps_mixed_outcomes_without_private_stack_data():
    from test_effect_recovery import effect
    rows = [outcome(161, 906, fail=True, samples=[
        {"step": 1, "outcome": "ok", "observedEffect": effect(True)},
        {"step": 2, "outcome": "fail", "why": "目标仍被占据；" * 30,
         "observedEffect": effect()}])]
    rows[0]["step_outcomes"]["samples"][1]["observed_effect"]["private_nbt"] = "never-copy-this"
    value = compact({"native_outcomes": rows}, "reference")
    samples = value["native_outcomes"][0]["samples"]
    assert {s["outcome"] for s in samples} == {"ok", "fail"}
    assert all(s["observed_effect"]["goal_verified"] is False for s in samples)
    assert "never-copy-this" not in encoded(value)
    assert len(encoded(samples).encode()) <= 700


def test_field_preview_reserves_success_and_failure_before_other_groups():
    samples = [{"step": i, "outcome": group, "why": "边界雪\"\\" * 500} for i, group in
               enumerate(["fail", "ok", "partial", "noop", "skip", "cut"], 1)]
    value = compact({"native_outcomes": [outcome(140, 705, fail=True, samples=samples)]}, "reference")
    row = value["native_outcomes"][0]
    assert {"fail", "ok"} <= {sample["outcome"] for sample in row["samples"]}
    assert len(encoded(row["samples"]).encode()) <= 700
    assert row["samples_omitted"] > 0


@pytest.mark.parametrize("length", [59, 60, 61, 299, 300, 301])
def test_previous_judgment_long_unicode_is_explicitly_abridged_and_small(length):
    decision = {"decision": "revise", "at": 10000.0, "request_id": "a" * 36, "heartbeat_id": "b" * 12,
                "reason": "雪\"\\" * length, "goal": "雪\"\\" * length}
    value = compact({}, "reference", decision)["prior_main_judgment"]
    assert len(encoded(value).encode()) <= 1100
    assert len(encoded(value["reason"]).encode()) <= 300
    assert len(encoded(value["goal"]).encode()) <= 180
    assert value["at"] == decision["at"] and value["request_id"] == decision["request_id"]
    assert value["goal"]["abridged"] is True


def test_unicode_assembled_budget_and_full_retained_details(runtime):
    rows = retained()
    rows[0]["receipt"] = "雪\"\\" * 3000
    rows[0]["step_outcomes"]["samples"][0]["why"] = "鸡蛋不是可进食物品"
    value, rid = inspect(runtime, rows, standing_goal="自主生活雪" * 500)
    assert len(json.dumps(value, ensure_ascii=False).encode()) < 14000
    assert len(encoded(value["native_outcomes"][0]["samples"]).encode()) <= 700
    all_rows = read_original(runtime[0], rid, value["evidence_ref"], ["evidence", "native_outcomes"])
    assert all_rows == runtime[0].decide(rid, "inspect")["native_outcomes"]
    assert all_rows[0]["step_outcomes"]["samples"][0]["why"] == "鸡蛋不是可进食物品"
    # Detail is lossless for the owning retained review projection, not original raw journal text.
    assert len(all_rows[0]["receipt"].encode()) <= 450


def test_real_inspect_retains_native_projects_and_method_evidence(runtime):
    port, _, publish = runtime
    publish(facts={'parts': [{'key': 'body', 'text': 'health=20 food=20'},
                            {'key': 'gear', 'text': 'bread x4'},
                            {'key': 'goals', 'text': 'Project farm; milestone 1 verified; next sow seeds', 'original': 'log:goals'},
                            {'key': 'methods', 'text': 'Method planting v2; selected v1; last outcome unknown', 'original': 'log:methods'}]})
    rid = port.offer()['review']['id']
    value = port.decide(rid, 'inspect', compact=True)
    assert value['facts']['goals'] == 'Project farm; milestone 1 verified; next sow seeds'
    assert value['facts']['methods'] == 'Method planting v2; selected v1; last outcome unknown'
    assert value['fact_originals']['goals'] == 'log:goals'
    assert value['fact_originals']['methods'] == 'log:methods'
    full = port.decide(rid, 'inspect')
    assert full['facts']['goals'] == value['facts']['goals']
    assert full['facts']['methods'] == value['facts']['methods']


def test_long_project_and_method_summaries_are_bounded_and_keep_query_handles(runtime):
    port, _, publish = runtime
    publish(facts={'parts': [{'key': 'body', 'text': 'health=20'}, {'key': 'gear', 'text': 'bread x4'},
        {'key': 'goals', 'text': '目标雪' * 1000, 'original': 'log:goals'},
        {'key': 'methods', 'text': '方法雪' * 1000, 'original': 'log:methods'}]})
    rid = port.offer()['review']['id']
    value = port.decide(rid, 'inspect', compact=True)
    assert len(encoded(value['facts']['goals']).encode()) <= 900
    assert len(encoded(value['facts']['methods']).encode()) <= 700
    assert 'abridged' in encoded(value['facts']['goals'])
    assert value['fact_originals']['goals'] == 'log:goals'
    assert value['fact_originals']['methods'] == 'log:methods'
