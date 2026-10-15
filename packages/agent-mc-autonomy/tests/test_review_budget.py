import json
from copy import deepcopy

import pytest

from agent_mc_autonomy.host_context import HostContextPort
from agent_mc_autonomy.observations import terminal_step_outcomes
from agent_mc_autonomy.review import ReviewPort
from test_death_reflection_contract import death_review
import test_review


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
