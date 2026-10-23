"""Unavailable transport time must not become an unanswered host decision."""
import json

import pytest
from test_review import snapshot

from agent_mc_autonomy.review import ReviewPolicy, ReviewPort


def setup(tmp_path):
    clock = [10000]
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    port.configure(ReviewPolicy(enabled=True, idle_presence_seconds=900))

    def publish(**changes):
        value = snapshot(clock[0], **changes)
        (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
        port.observe(value)

    publish()
    return port, clock, publish


@pytest.mark.parametrize("persisted_false_timeout", [False, True])
def test_first_delivery_after_long_unavailability_uses_fresh_evidence_without_failure_backoff(tmp_path, persisted_false_timeout):
    port, clock, publish = setup(tmp_path)
    previous = port.state()["review"]["id"]
    clock[0] += 10
    publish(phase="reconnecting", game_connected=False)
    assert not port.offer()["offered"]
    if persisted_false_timeout:
        # Older versions could persist a timeout despite having made no offer.
        with port.transaction() as state:
            state["review"]["result"] = {"acknowledged": False, "error": "main_brain_not_acknowledged"}
            state["retry_after"] = clock[0] + 600
    clock[0] += 200
    publish()
    offered = port.offer()
    assert offered["offered"]
    assert offered["review"]["id"] != previous
    assert offered["review"]["evidence"]["sampled_at"] == snapshot(clock[0])["updated_at"]
    assert offered["review"]["attempts"] == 1
    assert port.decide(previous, "continue", "old inspection")["error"] == "review_superseded"
    assert port.mailbox.get(port.request_id(previous)) is None
    with port.mailbox.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM commands").fetchone()[0] == 0


@pytest.mark.parametrize("accepted", [True, False, None])
def test_an_actual_offer_keeps_its_bounded_acknowledgement_deadline_and_backoff(tmp_path, accepted):
    port, clock, publish = setup(tmp_path)
    previous = port.offer()["review"]["id"]
    port.delivered(previous, accepted)
    clock[0] += 181
    publish()
    assert not port.offer()["offered"]
    assert port.state()["review"]["id"] == previous
    assert port.state()["review"]["result"]["error"] == "main_brain_not_acknowledged"
    assert port.state()["retry_after"] > clock[0]


def test_directly_inspected_review_is_not_treated_as_never_seen(tmp_path):
    port, clock, publish = setup(tmp_path)
    previous = port.state()["review"]["id"]
    port.decide(previous, "inspect")
    clock[0] += 181
    publish()
    assert port.state()["review"]["id"] == previous
    assert not port.offer()["offered"]


def test_fresh_unoffered_request_keeps_id_and_explicit_stop_prevents_renewal(tmp_path):
    port, clock, publish = setup(tmp_path)
    previous = port.state()["review"]["id"]
    clock[0] += 100
    publish()
    assert port.state()["review"]["id"] == previous
    port.mailbox.submit("stop", {}, "00000000-0000-4000-8000-000000000001")
    clock[0] += 200
    publish()
    assert not port.offer()["offered"]
    assert port.state()["review"]["id"] == previous
