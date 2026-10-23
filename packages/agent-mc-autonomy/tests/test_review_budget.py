import json
from copy import deepcopy

import pytest
import test_review
from test_death_reflection_contract import death_review

from agent_mc_autonomy.host_context import HostContextPort
from agent_mc_autonomy.observations import terminal_step_outcomes
from agent_mc_autonomy.review import ReviewPort


def test_minimal_completion_contract_is_neutral_and_ordinary_final_needs_no_extras(runtime):
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    contract = port.decide(rid, "inspect", compact=True)["completion_contract"]
    assert contract["required"]["heartbeat_id"] == rid
    assert contract["required"]["decision"] == ["continue", "insert", "revise"]
    assert set(contract["required"]) == {"heartbeat_id", "decision", "reason"}
    assert "death_reflection" not in contract
    assert "spoken_text" not in json.dumps(contract) and "context" not in json.dumps(contract)
    result = port.decide(rid, "continue", "当前队列仍在执行", require_inspection=True)
    assert result["acknowledged"] and not result["verified"]
    assert not port.mailbox.ready()


def test_short_checkpoint_guidance_survives_real_full_and_compact_inspection(runtime):
    port, _, publish = runtime
    publish()
    rid = port.offer()['review']['id']
    full = port.decide(rid, 'inspect')['completion_contract']
    compact = port.decide(rid, 'inspect', compact=True)['completion_contract']
    assert full == compact
    guidance = full['reasoning_guidance']
    assert 'brief strategic checkpoint' in guidance
    assert 'Keep reasoning brief and focused' in guidance
    assert 'uncertainty' in guidance
    assert len(guidance.encode()) < 500
    assert all(value not in guidance for value in ['512', 'xhigh', 'Neko', 'qwen', 'farm'])
    assert full['required']['decision'] == ['continue', 'insert', 'revise']
    assert not port.state()['review'].get('result') and not port.mailbox.ready()


@pytest.mark.parametrize("outcome", ["lesson", "deferred"])
def test_completion_contract_death_paths_are_minimal_and_evidence_bound(tmp_path, outcome):
    port, _, _, _, review = death_review(tmp_path)
    inspected = port.decide(review["id"], "inspect", compact=True)
    contract = inspected["completion_contract"]["death_reflection"]
    assert contract["required"] == {"evidence_ref": inspected["evidence_ref"]}
    assert {row["outcome"] for row in contract["one_of"]} == {"lesson", "deferred"}
    assert "evidence-based" in contract["one_of"][0]["lesson"]
    reflection = {**contract["required"], "outcome": outcome}
    reflection.update({"lesson": "复活后重新核对资源", "applicability": "准备返回旧路线时"}
                      if outcome == "lesson" else {"reason": "现场不能确定死因，暂不推断"})
    result = port.decide(review["id"], "continue", "当前背包为空，旧路线尚未核实", death_reflection=reflection)
    assert result["acknowledged"] and not result["reflection_pending"]


@pytest.mark.parametrize("saved", [False, True])
def test_legacy_completion_contract_preserves_original_choice_without_replay(tmp_path, saved):
    from test_death_memory import SCOPE
    from test_death_reflection_contract import legacy

    from agent_mc_autonomy.death_memory import DeathMemory
    port, _, episode, _, review = death_review(tmp_path)
    choice, _ = legacy(port, review)
    if saved:
        DeathMemory(tmp_path).execute(SCOPE, {"action": "report", "id": episode["id"],
            "lesson": "Historical hypothesis", "applicability": "Fresh facts needed", "evidence": "native-run cursor 1"})
    inspected = port.decide(review["id"], "inspect", compact=True)
    contract = inspected["completion_contract"]
    assert contract["required"] == {"heartbeat_id": review["id"], **choice}
    assert ("death_reflection" in contract) is not saved
    before = port.mailbox.get(port.request_id(review["id"]))
    result = port.decide(review["id"], **choice, **({} if saved else {"death_reflection": {
        "evidence_ref": inspected["evidence_ref"], "outcome": "deferred", "reason": "死因未知"}}))
    assert result["acknowledged"] and not result["reflection_pending"]
    assert port.mailbox.get(port.request_id(review["id"])) == before


@pytest.fixture
def runtime(tmp_path):
    return test_review.runtime.__wrapped__(tmp_path)


def read_original(port, review_id, reference, path):
    chunks, offset = [], 0
    while True:
        page = port.decide(review_id, "inspect", evidence_ref=reference, detail_path=path, detail_offset=offset)
        assert page["historical"] and not page["grants_inspection"]
        assert len(json.dumps(page, ensure_ascii=False).encode()) < 6500
        chunks.append(page["json_chunk"])
        if not page["has_more"]:
            return json.loads("".join(chunks))
        assert page["next_offset"] > offset
        offset = page["next_offset"]


def test_large_death_and_mixed_receipts_remain_exactly_queryable(tmp_path):
    port, _, episode, _, review = death_review(tmp_path)
    snapshot = json.loads((tmp_path / "status.json").read_text(encoding="utf-8"))
    episode["receipts"] = [{"text": "long historical receipt 雪" * 2000}] * 10
    episode["actions"] = [{"arguments": {"nested": ["original" * 1000]}}] * 10
    snapshot["death_episode"] = episode
    snapshot["native_outcomes"] = [{"execution_id": "mixed-task", "tool": "mc_do", "phase": "partial",
        "receipt": "failure then success " * 500,
        "step_outcomes": terminal_step_outcomes({"evidence": {"steps": [{"step": 1, "outcome": "ok"},
            {"step": 2, "outcome": "fail", "why": "blocked"}]}}, {})}]
    (tmp_path / "status.json").write_text(json.dumps(snapshot), encoding="utf-8")
    full = port.decide(review["id"], "inspect")
    compact = port.decide(review["id"], "inspect", compact=True)
    assert len(json.dumps(compact, ensure_ascii=False).encode()) < 14000
    assert len(json.dumps(full).encode()) > 200000
    assert compact["native_outcomes"][0]["step_outcomes"]["mixed"]
    assert compact["death_episode"]["cause"] is None
    reference = compact["evidence_ref"]
    assert read_original(port, review["id"], reference, ["evidence", "death_episode", "receipts"]) == episode["receipts"]
    assert read_original(port, review["id"], reference, ["evidence", "death_episode", "actions"]) == episode["actions"]
    assert read_original(port, review["id"], reference, ["goal_lineage"]) == []
    assert not port.state()["review"].get("result") and not port.mailbox.ready()


def test_historical_pages_do_not_authorize_or_replace_fresh_inspection(runtime):
    port, clock, publish = runtime
    publish()
    first = port.offer()["review"]["id"]
    ref = port.decide(first, "inspect", compact=True)["evidence_ref"]
    assert port.decide(first, "continue", "Continue", require_inspection=True)["acknowledged"]
    clock[0] += 180
    publish()
    second = port.offer()["review"]["id"]
    before = deepcopy(port.state())
    read_original(ReviewPort(port.directory, now=port.now), first, ref, ["evidence"])
    assert port.state() == before
    assert port.decide(second, "continue", "Continue", require_inspection=True)["error"] == "fresh_inspection_required"
    assert port.decide(second, "inspect", evidence_ref=ref)["error"] == "evidence_not_found"
    port.decide(second, "inspect", compact=True)
    accepted = port.decide(second, "continue", "Continue", require_inspection=True)
    assert accepted["acknowledged"]
    clock[0] += 500
    assert port.decide(second, "continue", "Continue", require_inspection=True) == accepted


@pytest.mark.parametrize("outcome", ["lesson", "deferred"])
def test_compact_death_reference_expands_only_validated_provenance(tmp_path, outcome):
    port, _, episode, _, review = death_review(tmp_path)
    ref = port.decide(review["id"], "inspect", compact=True)["evidence_ref"]
    reflection = {"evidence_ref": "0" * 24, "outcome": outcome,
                  **({"lesson": "Inspect the route", "applicability": "After respawn"} if outcome == "lesson"
                     else {"reason": "Cause remains unknown"})}
    assert port.decide(review["id"], "continue", "Recover", death_reflection=reflection)["error"] == "death_evidence_reference_mismatch"
    reflection["evidence_ref"] = ref
    assert port.decide(review["id"], "continue", "Recover", death_reflection=reflection)["acknowledged"]
    saved = port.state()["review"]["reflection"]
    assert saved["source_event"] == episode["source_event"]
    assert saved["episode_id"] == episode["id"] and saved["outcome"] == outcome
    assert not saved["behavioral_improvement_verified"]


def test_static_profile_survives_revision_but_never_revives_dynamic_context(runtime):
    port, clock, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    ref = port.decide(rid, "inspect", compact=True)["evidence_ref"]
    profile = {"agent_name": "Role", "persona": "public traits", "persona_source": "character_profile"}
    assert port.bind_character(rid, ref, profile)["available"]
    host = HostContextPort(port.directory, now=port.now)
    assert host.read(999)["dynamic"] == {"current_intent": "", "memories": [], "memories_selected": False}
    host.publish({"agent_name": "Role", "persona": "explicit", "current_intent": "fresh intent", "memories": []},
                 session="123:", revision=0)
    port.bind_character(rid, ref, profile)
    assert host.read(0)["stable"]["persona"] == "explicit"
    assert host.read(0)["dynamic"]["current_intent"] == "fresh intent"
    assert host.read(1)["stable"]["persona"] == "public traits"
    assert host.read(1)["dynamic"]["current_intent"] == ""
    publish(owner_pid=124)
    assert host.read(0)["dynamic"]["current_intent"] == ""
    host.publish_static({**profile, "agent_name": "NewRole"}, scope=None)
    assert not host.path.exists() and host.read(0)["stable"]["agent_name"] == "NewRole"
    host.invalidate()
    assert host.read(0) is None
    assert not port.state()["review"].get("result")


@pytest.mark.parametrize("change", ["intent", "stop", "baseline"])
def test_profile_binding_cannot_bypass_current_fences(runtime, change):
    import uuid
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    ref = port.decide(rid, "inspect", compact=True)["evidence_ref"]
    if change in {"intent", "stop"}:
        port.mailbox.submit("feedback" if change == "intent" else "stop",
                            {"goal": "new", "mode": "insert"} if change == "intent" else {}, str(uuid.uuid4()))
    else:
        publish(pending=[{"id": "unknown", "phase": "unknown"}])
    result = port.bind_character(rid, ref, {"agent_name": "Role", "persona": "public", "persona_source": "character_profile"})
    assert result["reason"] == "inspection_superseded"
    assert not (port.directory / "host-character.json").exists()


@pytest.mark.parametrize("reference", [None, "", " ", 1, [], {}, "z" * 24, "a" * 23, "a" * 24])
def test_invalid_or_uninspected_death_reference_is_recoverable_without_effects(tmp_path, reference):
    from unittest.mock import Mock
    port, _, _, _, review = death_review(tmp_path)
    before = deepcopy(port.state())
    speak = Mock()
    result = port.decide(review["id"], "continue", "Evaluate recovery", before_dispatch=speak,
                         host_context={"agent_name": "Role"}, death_reflection={"evidence_ref": reference,
                         "outcome": "lesson", "lesson": "Check resources", "applicability": "After respawn"})
    assert result["error"] == "death_evidence_reference_mismatch"
    assert port.state() == before and not port.mailbox.ready()
    assert not (tmp_path / "host-context.json").exists()
    speak.assert_not_called()


def test_missing_death_reference_keeps_original_recoverable_validation(tmp_path):
    port, _, _, _, review = death_review(tmp_path)
    before = deepcopy(port.state())
    result = port.decide(review["id"], "continue", "Evaluate recovery", death_reflection={
        "outcome": "lesson", "lesson": "Check resources", "applicability": "After respawn"})
    assert result["error"] == "death_episode_mismatch" and port.state() == before


def test_new_explicit_actor_retires_old_static_without_losing_intent_or_memories(runtime):
    port, _, publish = runtime
    publish()
    host = HostContextPort(port.directory, now=port.now)
    host.publish_static({"agent_name": "A", "persona": "public A", "persona_source": "character_profile"}, scope=None)
    memories = [{"id": "m", "source": "main_brain_recall", "text": "Selected by B"}]
    host.publish({"agent_name": "B", "persona": "explicit B", "current_intent": "B's intent", "memories": memories},
                 session="123:", revision=0)
    value = host.read(0)
    assert value["stable"]["agent_name"] == "B" and value["stable"]["persona"] == "explicit B"
    assert value["dynamic"]["current_intent"] == "B's intent" and value["dynamic"]["memories"] == memories
    assert not (port.directory / "host-character.json").exists()
    assert host.read(1) is None  # Old static A cannot reappear after B's revision expires.


def test_concurrent_final_wins_over_profile_read_started_before_it(runtime):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    ref = port.decide(rid, "inspect", compact=True)["evidence_ref"]
    final_done = Event()
    with ThreadPoolExecutor(max_workers=1) as pool:
        def late_profile():
            assert final_done.wait(5)
            return ReviewPort(port.directory, now=port.now).bind_character(rid, ref,
                {"agent_name": "A", "persona": "old public A", "persona_source": "character_profile"})
        pending = pool.submit(late_profile)
        accepted = port.decide(rid, "continue", "Current work", require_inspection=True,
            host_context={"agent_name": "B", "persona": "explicit B", "current_intent": "fresh B intent",
                          "memories": [{"id": "m", "source": "main_brain", "text": "fresh B memory"}]})
        final_done.set()
        assert pending.result()["reason"] == "inspection_superseded"
    assert accepted["acknowledged"]
    context = HostContextPort(port.directory, now=port.now).read(0)
    assert context["stable"]["agent_name"] == "B"
    assert context["dynamic"]["current_intent"] == "fresh B intent"
    assert context["dynamic"]["memories"][0]["text"] == "fresh B memory"
