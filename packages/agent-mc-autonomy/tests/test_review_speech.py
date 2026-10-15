import json
import uuid

import pytest

from agent_mc_autonomy.death_memory import DeathMemory
from agent_mc_autonomy.review import ReviewPolicy, ReviewPort
from test_death_memory import SCOPE, event, facts
from test_review import snapshot


def setup(tmp_path):
    clock = [10000]
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    port.configure(ReviewPolicy(enabled=True))

    def publish(**kw):
        value = snapshot(clock[0], **kw)
        (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
        port.observe(value)
    return port, clock, publish


def test_default_idle_opportunity_is_45_seconds_and_delivery_resets_it(tmp_path):
    port, clock, publish = setup(tmp_path)
    assert ReviewPolicy.parse({}).idle_presence_seconds == 45
    publish()
    first = port.offer()["review"]
    port.delivered(first["id"], True)
    port.decide(first["id"], "continue", "Keep working")
    clock[0] += 44
    publish()
    assert not port.offer()["offered"]
    clock[0] += 1
    publish()
    idle = port.offer()["review"]
    assert idle["trigger"] == "idle_presence"
    assert idle["opportunity"]["id"] == idle["id"]
    assert not port.offer()["offered"]
    port.delivered(idle["id"], True)
    assert port.state()["submitted_at"] == clock[0]
    assert not port.state()["review"].get("result")  # Acceptance is neither speech nor decision.
    clock[0] += 90
    publish()
    assert port.offer()["review"]["id"] == idle["id"]  # Retry retains opportunity identity.
    assert not port.offer()["offered"]


def test_death_transport_inspection_and_decision_do_not_complete_reflection(tmp_path):
    port, clock, publish = setup(tmp_path)
    episode = DeathMemory(tmp_path).record(event(), facts(), [], [], [])
    publish(death_episode=episode, game_identity=SCOPE)
    review = port.offer()["review"]
    port.delivered(review["id"], True)
    pending = DeathMemory(tmp_path).entries(SCOPE, pending=True)[0]
    assert pending["host_review"]["transport_accepted"]
    assert pending["host_review"]["inspected_at"] is None
    assert not pending["host_review"]["acknowledged"]
    port.decide(review["id"], "inspect")
    assert not port.state()["review"].get("result")
    result = port.decide(review["id"], "continue", "Wait for inventory sync")
    assert result["reflection_pending"]
    clock[0] += 301
    publish(death_episode=episode, game_identity=SCOPE)
    retry = port.offer()["review"]
    assert retry["id"] != review["id"]
    assert retry["evidence"]["death_episode"]["id"] == episode["id"]
    deferred = {"episode_id": episode["id"], "outcome": "deferred", "reason": "Inventory is not synchronized yet"}
    result = port.decide(retry["id"], "continue", "Wait safely", death_reflection=deferred)
    assert not result["reflection_pending"]
    assert DeathMemory(tmp_path).entries(SCOPE, pending=True) == []
    assert DeathMemory(tmp_path).entries(SCOPE)[0]["lesson"] is None


def test_lesson_requires_fresh_inspection_and_evidence_and_is_idempotent(tmp_path):
    port, _, publish = setup(tmp_path)
    episode = DeathMemory(tmp_path).record(event(), facts(), [], [], [])
    fresh = facts()
    fresh["parts"].append({"key": "gear", "text": "empty"})
    publish(death_episode=episode, game_identity=SCOPE, facts=fresh)
    review = port.offer()["review"]
    lesson = {"episode_id": episode["id"], "outcome": "lesson", "lesson": "Recheck the old route",
              "applicability": "After respawn", "evidence": "native-run cursor 1; fresh inventory empty"}
    assert port.decide(review["id"], "continue", "Fresh plan", death_reflection=lesson)["error"] == "fresh_recovery_inspection_required"
    port.decide(review["id"], "inspect")
    assert port.decide(review["id"], "continue", "Fresh plan", death_reflection={**lesson, "evidence": ""})["is_error"]
    result = port.decide(review["id"], "continue", "Fresh plan", death_reflection=lesson)
    assert result == port.decide(review["id"], "continue", "Fresh plan", death_reflection=lesson)
    record = DeathMemory(tmp_path).entries(SCOPE)[0]
    assert record["reflection"]["source_event"] == episode["source_event"]
    assert record["lesson"]["hypothesis"] and not record["behavioral_improvement_verified"]
    assert DeathMemory(tmp_path).entries(SCOPE, pending=True) == []


@pytest.mark.parametrize("fails", [True, False])
def test_speech_enqueue_precedes_goal_and_never_controls_gameplay(tmp_path, fails):
    port, _, publish = setup(tmp_path)
    publish()
    review = port.offer()["review"]
    calls = []

    def enqueue(correlation):
        assert port.mailbox.get(correlation["decision_id"]) is None
        calls.append(correlation)
        if fails:
            raise OSError("output unavailable")
        return {"status": "enqueued", "playback_verified": False}

    result = port.decide(review["id"], "insert", "Need shelter", "Build a shelter", before_dispatch=enqueue)
    assert result["dispatched"] and result["delivery"] == "queued"
    assert result["speech"]["status"] == ("enqueue_failed" if fails else "enqueued")
    assert port.speech_current(calls[0])  # Own mailbox insertion is permitted.
    assert port.decide(review["id"], "insert", "Need shelter", "Build a shelter", before_dispatch=enqueue) == result
    assert len(calls) == 1
    port.mailbox.submit("feedback", {"goal": "User changed their mind", "mode": "insert", "origin": "user"}, str(uuid.uuid4()))
    assert not port.speech_current(calls[0])


def test_inspect_and_stopped_decisions_never_enqueue(tmp_path):
    port, _, publish = setup(tmp_path)
    publish()
    review = port.offer()["review"]
    def forbidden(_):
        raise AssertionError("No speech")
    assert port.decide(review["id"], "inspect", before_dispatch=forbidden)["error"] == "inspect_is_read_only"
    port.mailbox.submit("stop", {}, str(uuid.uuid4()))
    assert port.decide(review["id"], "continue", "Wait", before_dispatch=forbidden)["error"] == "disabled_or_stopped"
