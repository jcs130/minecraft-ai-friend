import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from unittest.mock import Mock

import pytest

from agent_mc_autonomy.death_memory import DeathMemory
from agent_mc_autonomy.review import ReviewPort, review_observation
from test_death_memory import SCOPE, event, facts
from test_review import snapshot
from test_review_speech import setup


def death_review(tmp_path):
    port, clock, publish = setup(tmp_path)
    episode = DeathMemory(tmp_path).record(event(), facts(), [], [], [])
    fresh = facts()
    fresh["parts"].append({"key": "gear", "text": "empty"})
    publish(death_episode=episode, game_identity=SCOPE, facts=fresh)
    review = port.offer()["review"]
    return port, clock, episode, fresh, review


def reflection(episode, outcome="lesson"):
    if outcome == "deferred":
        return {"episode_id": episode["id"], "outcome": outcome,
                "reason": "Inventory/lifecycle is not known yet; inspect again before choosing a route."}
    return {"episode_id": episode["id"], "outcome": outcome, "lesson": "Recheck the route after respawn",
            "applicability": "Before returning; current inventory is empty and route safety is unknown",
            "evidence": episode["id"] + "; native-run cursor 1; fresh inventory empty"}


@pytest.mark.parametrize("outcome", ["lesson", "deferred"])
def test_missing_reflection_has_no_effect_and_same_heartbeat_can_correct(tmp_path, outcome):
    port, _, episode, _, review = death_review(tmp_path)
    port.decide(review["id"], "inspect")
    before = deepcopy(port.state())
    speak = Mock(return_value={"status": "enqueued"})
    rejected = port.decide(review["id"], "insert", "Empty inventory; start locally", "Gather nearby wood",
                           before_dispatch=speak, host_context={"agent_name": "TestRole", "current_intent": "recover", "memories": []})
    assert rejected["error"] == "death_reflection_required" and rejected["next"]
    assert port.state() == before
    assert port.mailbox.get(port.request_id(review["id"])) is None
    assert not (tmp_path / "host-context.json").exists()
    speak.assert_not_called()
    result = port.decide(review["id"], "insert", "Empty inventory; start locally", "Gather nearby wood",
                         death_reflection=reflection(episode, outcome), before_dispatch=speak)
    assert result["acknowledged"] and not result["reflection_pending"]
    speak.assert_called_once()
    restarted = ReviewPort(tmp_path, now=port.now)
    assert restarted.decide(review["id"], "insert", "Empty inventory; start locally", "Gather nearby wood",
                            death_reflection=reflection(episode, outcome), before_dispatch=speak) == result
    saved = DeathMemory(tmp_path).entries(SCOPE)[0]
    assert saved["reflection"]["outcome"] == outcome
    assert not saved["reflection"]["behavioral_improvement_verified"]
    assert bool(saved["lesson"]) == (outcome == "lesson")
    assert DeathMemory(tmp_path).entries(SCOPE, pending=True) == []


@pytest.mark.parametrize("change,error", [
    ("episode", "death_episode_mismatch"), ("evidence", "death_evidence_must_reference_episode_or_source_run"),
    ("applicability", "death_reflection_evidence_or_deferral_required"),
    ("inventory", "fresh_recovery_inspection_required"), ("lifecycle", "critical_baseline_changed"),
    ("position", "fresh_recovery_inspection_required"), ("scope", "death_episode_superseded"),
    ("new_death", "death_episode_superseded"), ("restriction", "critical_baseline_changed"),
])
def test_invalid_reflection_and_changed_evidence_cannot_partially_deliver(tmp_path, change, error):
    port, clock, episode, fresh, review = death_review(tmp_path)
    port.decide(review["id"], "inspect")
    payload = reflection(episode)
    value = snapshot(clock[0], death_episode=episode, game_identity=SCOPE, facts=fresh)
    if change == "episode":
        payload["episode_id"] = "unrelated"
    elif change in {"evidence", "applicability"}:
        payload[change] = "unrelated" if change == "evidence" else ""
    elif change in {"inventory", "position"}:
        part = next(p for p in fresh["parts"] if p["key"] == "recoveryState")
        recovery = json.loads(part["text"])
        recovery["inventorySynced" if change == "inventory" else "position"] = False if change == "inventory" else None
        part["text"] = json.dumps(recovery)
    elif change == "lifecycle":
        next(p for p in fresh["parts"] if p["key"] == "deathLifecycle")["text"] = json.dumps({"phase": "respawn_pending", "episodeId": episode["id"]})
    elif change == "restriction":
        fresh["parts"].append({"key": "bodyRestriction", "text": "incapacitated"})
    elif change == "scope":
        value["game_identity"] = {**SCOPE, "account": "other"}
    else:
        value["death_episode"] = DeathMemory(tmp_path).record(event(2), facts(episode_id="death-2"), [], [], [])
    (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
    speak = Mock()
    result = port.decide(review["id"], "insert", "Fresh recovery", "Gather nearby wood", death_reflection=payload,
                         before_dispatch=speak)
    assert result["error"] == error
    assert not port.state()["review"].get("result")
    assert port.mailbox.get(port.request_id(review["id"])) is None
    speak.assert_not_called()
    assert not DeathMemory(tmp_path).entries(SCOPE)[0].get("reflection")


def test_honest_deferral_allows_unknown_inventory_and_lifecycle(tmp_path):
    port, clock, episode, fresh, review = death_review(tmp_path)
    fresh["parts"] = [p for p in fresh["parts"] if p["key"] not in {"deathLifecycle", "recoveryState"}]
    (tmp_path / "status.json").write_text(json.dumps(snapshot(clock[0], death_episode=episode, game_identity=SCOPE, facts=fresh)))
    port.decide(review["id"], "inspect")
    assert port.decide(review["id"], "continue", "Need actual recovery facts", death_reflection=reflection(episode))["is_error"]
    assert port.decide(review["id"], "continue", "Need actual recovery facts", death_reflection=reflection(episode, "deferred"))["acknowledged"]


def legacy(port, review, decision="insert"):
    choice = {"decision": decision, "reason": "Original accepted strategy", "goal": "Original nearby stage" if decision == "insert" else ""}
    receipt = port.mailbox.submit("feedback", {"goal": choice["goal"], "mode": "insert", "origin": "host_review"},
                                  port.request_id(review["id"])) if decision == "insert" else None
    result = {"acknowledged": True, "dispatched": bool(receipt), "decision": decision, "verified": False,
              "reflection_pending": True, "speech": {"status": "accepted", "playback_verified": False}}
    if receipt:
        result.update(request_id=receipt["request_id"], delivery=receipt["delivery"])
    with port.transaction() as state:
        state["review"].update(choice=choice, result=result, inspected_at=port.now())
        state["retry_after"] = port.now() + 300
        state["last_decision"] = {**choice, "heartbeat_id": review["id"], "at": port.now()}
    return choice, deepcopy(result)


@pytest.mark.parametrize("outcome", ["lesson", "deferred"])
def test_legacy_fresh_completion_is_atomic_durable_and_concurrent_without_replay(tmp_path, outcome):
    port, clock, episode, fresh, review = death_review(tmp_path)
    choice, original = legacy(port, review)
    original_state = deepcopy(port.state())
    clock[0] += 400  # Legacy receipt can outlive the old gameplay review window.
    (tmp_path / "status.json").write_text(json.dumps(snapshot(clock[0], death_episode=episode, game_identity=SCOPE, facts=fresh)))
    payload = reflection(episode, outcome)
    assert port.decide(review["id"], **choice, death_reflection=payload)["error"] == "fresh_recovery_inspection_required"
    assert port.decide(review["id"], "inspect")["death_episode"]["id"] == episode["id"]
    def finish(_):
        restarted = ReviewPort(tmp_path, now=port.now)
        def forbidden(*a, **kw):
            raise AssertionError("Legacy completion must not replay speech, goal or context")
        restarted.mailbox.submit = forbidden
        return restarted.decide(review["id"], **choice, death_reflection=payload, before_dispatch=forbidden,
                                host_context={"agent_name": "TestRole", "current_intent": "recover", "memories": []})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(finish, range(8)))
    assert all(r == results[0] for r in results)
    completed = results[0]
    assert {k: completed[k] for k in original if k != "reflection_pending"} == {k: v for k, v in original.items() if k != "reflection_pending"}
    assert not completed["reflection_pending"]
    saved = DeathMemory(tmp_path).entries(SCOPE)[0]
    assert saved["reflection_completion"] == completed["reflection_completion"]
    assert saved["reflection"]["outcome"] == outcome and DeathMemory(tmp_path).entries(SCOPE, pending=True) == []
    assert port.state()["last_decision"] == original_state["last_decision"]
    assert "retry_after" not in port.state()
    assert not (tmp_path / "host-context.json").exists()


def test_new_death_cannot_inherit_legacy_lesson_or_replay_old_stage(tmp_path):
    port, clock, episode, fresh, review = death_review(tmp_path)
    choice, _ = legacy(port, review)
    newer = DeathMemory(tmp_path).record(event(2), facts(episode_id="death-2"), [], [], [])
    (tmp_path / "status.json").write_text(json.dumps(snapshot(clock[0], death_episode=newer, game_identity=SCOPE, facts=fresh)))
    assert port.decide(review["id"], "inspect")["error"] == "death_episode_superseded"
    assert port.decide(review["id"], **choice, death_reflection=reflection(episode))["error"] == "death_episode_superseded"
    assert all(not r.get("reflection") for r in DeathMemory(tmp_path).entries(SCOPE))


def test_newer_durable_death_fences_still_stale_status(tmp_path):
    port, _, episode, _, review = death_review(tmp_path)
    choice, _ = legacy(port, review, "continue")
    DeathMemory(tmp_path).record(event(2), facts(episode_id="death-2"), [], [], [])
    assert port.decide(review["id"], "inspect")["error"] == "death_episode_superseded"
    assert port.decide(review["id"], **choice, death_reflection=reflection(episode))["error"] == "death_episode_superseded"
    assert all(not r.get("reflection") for r in DeathMemory(tmp_path).entries(SCOPE))


def test_first_decision_concurrent_retry_and_full_scope_isolation(tmp_path):
    port, _, episode, _, review = death_review(tmp_path)
    others = [{**SCOPE, key: "other"} for key in SCOPE]
    for scope in others:
        DeathMemory(tmp_path).record(event(scope=scope), facts(scope=scope), [], [], [])
    port.decide(review["id"], "inspect")
    calls = []
    def finish(_):
        restarted = ReviewPort(tmp_path, now=port.now)
        return restarted.decide(review["id"], "insert", "Empty inventory; recover locally", "Gather nearby wood",
            death_reflection=reflection(episode), before_dispatch=lambda c: calls.append(c) or {"status": "enqueued"})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(finish, range(8)))
    assert all(r == results[0] for r in results) and results[0]["acknowledged"]
    assert len(calls) == 1
    for scope in others:
        assert not DeathMemory(tmp_path).entries(scope)[0].get("reflection")


def test_legacy_inspection_expires_and_baseline_must_be_reinspected(tmp_path):
    port, clock, episode, fresh, review = death_review(tmp_path)
    choice, _ = legacy(port, review, "continue")
    port.decide(review["id"], "inspect")
    fresh["parts"].append({"key": "bodyRestriction", "text": "immobilized"})
    def write():
        (tmp_path / "status.json").write_text(json.dumps(snapshot(clock[0], death_episode=episode, game_identity=SCOPE, facts=fresh)))
    write()
    assert port.decide(review["id"], **choice, death_reflection=reflection(episode))["error"] == "critical_baseline_changed"
    port.decide(review["id"], "inspect")
    clock[0] += 181
    write()
    assert port.decide(review["id"], **choice, death_reflection=reflection(episode, "deferred"))["error"] == "fresh_recovery_inspection_required"
    port.decide(review["id"], "inspect")
    assert port.decide(review["id"], **choice, death_reflection=reflection(episode, "deferred"))["acknowledged"]


def test_ordinary_review_still_needs_no_reflection(tmp_path):
    port, _, publish = setup(tmp_path)
    publish()
    review = port.offer()["review"]
    assert port.decide(review["id"], "continue", "Keep useful work")["acknowledged"]


def test_older_pending_episode_never_becomes_current_after_a_new_death(tmp_path):
    _, clock, episode, _, _ = death_review(tmp_path)
    fresh = facts(episode_id="newer-current-death")
    fresh["parts"].append({"key": "gear", "text": "empty"})
    observed = review_observation(snapshot(clock[0], death_episode=episode, game_identity=SCOPE, facts=fresh), clock[0])
    assert "death_episode" not in observed["evidence"] and observed["urgent"] is None
    assert observed["evidence"]["body_baseline"]["lifecycle"]["episodeId"] == "newer-current-death"
    assert DeathMemory(tmp_path).entries(SCOPE, pending=True)[0]["id"] == episode["id"]  # Historical, never a replay.


@pytest.mark.parametrize("outcome", ["lesson", "deferred"])
def test_body_report_cannot_erase_concurrently_completed_reflection(tmp_path, monkeypatch, outcome):
    port, _, episode, _, review = death_review(tmp_path)
    choice, _ = legacy(port, review, "continue")
    port.decide(review["id"], "inspect")
    store = DeathMemory(tmp_path)
    original = store.entries
    def stale_entries(scope, **kw):
        rows = original(scope, **kw)
        assert port.decide(review["id"], **choice, death_reflection=reflection(episode, outcome))["acknowledged"]
        return rows  # Mimic the producer's stale pre-transaction history read.
    monkeypatch.setattr(store, "entries", stale_entries)
    result = store.execute(SCOPE, {"action": "report", "id": episode["id"], "lesson": "Planner historical hypothesis",
        "applicability": "Requires fresh review before reuse", "evidence": "native-run cursor 1"})
    saved = DeathMemory(tmp_path).entries(SCOPE)[0]
    assert saved["reflection"]["outcome"] == outcome
    assert saved["reflection_completion"] == port.state()["review"]["result"]["reflection_completion"]
    if outcome == "lesson":
        assert not result["saved"] and saved["lesson"]["source"] == "main_brain_review"
    assert saved["historical"] and not saved["behavioral_improvement_verified"]
