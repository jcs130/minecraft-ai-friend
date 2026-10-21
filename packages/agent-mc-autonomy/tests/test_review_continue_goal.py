"""A contradictory review must not acknowledge and silently drop a stage."""

import pytest
import test_review


@pytest.fixture
def runtime(tmp_path):
    return test_review.runtime.__wrapped__(tmp_path)


def test_continue_cannot_acknowledge_and_discard_a_new_corrective_goal(runtime):
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    port.decide(rid, "inspect", compact=True)
    result = port.decide(rid, "continue", "The current attempt is ineffective",
                         "Repair the water source before planting again", require_inspection=True)
    assert result.get("error") == "continue_cannot_deliver_new_goal", result
    assert not result.get("acknowledged")
    assert not port.state()["review"].get("result")
    assert port.mailbox.get(port.request_id(rid)) is None


def test_refused_continue_has_no_speech_context_or_choice_effects(runtime):
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    port.decide(rid, "inspect")
    spoken = []
    result = port.decide(rid, "continue", "Correct this ineffective approach", "New stage",
                         before_dispatch=lambda opportunity: spoken.append(opportunity),
                         host_context={"agent_name": "TestRole", "current_intent": "New stage"})
    assert result["error"] == "continue_cannot_deliver_new_goal"
    assert spoken == []
    assert not (port.directory / "host-context.json").exists()
    assert not port.state()["review"].get("choice")
    assert port.mailbox.intent_revision() == 0


def test_explicit_corrected_insert_uses_same_review_and_dispatches_once(runtime):
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    port.decide(rid, "inspect")
    goal = "Inspect the source before trying to plant again"
    refused = port.decide(rid, "continue", "The previous method did not work", goal)
    assert refused["error"] == "continue_cannot_deliver_new_goal"
    accepted = port.decide(rid, "insert", "The previous method did not work", goal)
    assert accepted["acknowledged"] and accepted["dispatched"]
    assert not accepted["verified"]
    command = port.mailbox.claim()
    assert command["id"] == accepted["request_id"]
    assert command["payload"]["goal"] == goal
    assert command["payload"]["origin"] == "host_review"
    assert port.mailbox.claim() is None
    assert port.mailbox.intent_revision() == 1
    assert port.decide(rid, "insert", "The previous method did not work", goal) == accepted
    assert port.mailbox.intent_revision() == 1


def test_plain_continue_keeps_existing_plan_without_new_mailbox_work(runtime):
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    inspected = port.decide(rid, "inspect", compact=True)
    assert "For continue, omit goal" in inspected["completion_contract"]["goal"]
    accepted = port.decide(rid, "continue", "Existing work is still useful", "  ")
    assert accepted["acknowledged"] and not accepted["dispatched"]
    assert not port.mailbox.ready()


def test_previous_acknowledged_continue_with_goal_is_immutable_and_not_replayed(runtime):
    port, _, publish = runtime
    publish()
    rid = port.offer()["review"]["id"]
    original = port.decide(rid, "continue", "Prior model judgment")
    # A durable choice saved by the previous version must remain queryable.
    with port.transaction() as state:
        state["review"]["choice"]["goal"] = "Previously ignored proposal"
    assert port.decide(rid, "continue", "Prior model judgment", "Previously ignored proposal") == original
    assert port.mailbox.intent_revision() == 0
