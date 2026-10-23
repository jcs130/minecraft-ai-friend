import dataclasses
import json

import pytest

from agent_mc_autonomy.commentary import commentary_changes, commentary_observation
from test_commentary import sample
from test_controller import setup
from test_review import runtime as review_runtime


@pytest.fixture
def runtime(tmp_path):
    return review_runtime.__wrapped__(tmp_path)


def body_event(phase="inhibited", cursor=7, text="[身体受限] server restraint"):
    return {"type": "minecraft.body", "run": "run-1", "cursor": cursor, "ts": "sample-time",
            "text": text, "phase": phase}


def failed_outcome(execution_id="task-7"):
    return {"tool": "mc_do", "execution_id": execution_id, "phase": "blocked",
            "receipt": "path_stalled: no route", "observation_only": False,
            "goal_verified": False, "original_event": {"run": "run-1", "cursor": 8, "ts": "sample-time"}}


def test_body_restriction_and_native_failure_are_inspectable_material_changes(runtime):
    port, clock, publish = runtime
    publish()
    first = port.offer()["review"]
    assert port.decide(first["id"], "continue", "keep useful work")["acknowledged"]
    clock[0] += 60
    value = publish(native_outcomes=[failed_outcome()])
    value["facts"]["parts"].append({"key": "bodyRestriction", "text": "身体当前受限：server restraint", "original": "fact:restriction"})
    (port.directory / "status.json").write_text(json.dumps(value), encoding="utf-8")
    port.observe(value)
    review = port.offer()["review"]
    detail = port.decide(review["id"], "inspect")
    assert detail["facts"]["bodyRestriction"].endswith("server restraint")
    assert detail["fact_originals"]["bodyRestriction"] == "fact:restriction"
    assert detail["native_outcomes"][0]["original_event"]["cursor"] == 8
    assert not detail["native_outcomes"][0]["goal_verified"]
    assert review["trigger"] == "state_changed"


def test_body_episode_dedup_ignores_timestamps_and_recovery_changes_signal(runtime):
    port, clock, publish = runtime
    publish(body_events=[body_event("stalled", text="native stall")])
    first = port.offer()["review"]
    assert port.decide(first["id"], "continue", "keep useful work")["acknowledged"]
    clock[0] += 60
    publish(body_events=[{**body_event("stalled", text="native stall"), "ts": "new-time"}])
    assert not port.offer()["offered"]
    clock[0] += 60
    publish(body_events=[body_event("recovered", 9, "[身体恢复] actual recovery")])
    recovered = port.offer()["review"]
    assert recovered["trigger"] == "state_changed"
    assert recovered["evidence"]["body_events"][0]["phase"] == "recovered"
    assert port.decide(recovered["id"], "continue", "check actual recovery")["acknowledged"]
    clock[0] += 60
    publish(native_outcomes=[failed_outcome("new-task")])
    assert port.offer()["review"]["trigger"] == "state_changed"


def test_native_failure_projection_is_bounded_and_private_arguments_are_omitted(runtime):
    port, _, publish = runtime
    publish(native_outcomes=[{**failed_outcome(str(i)), "receipt": "x" * 5000, "arguments": "PRIVATE"} for i in range(20)])
    evidence = port.offer()["review"]["evidence"]
    assert len(evidence["native_outcomes"]) <= 6
    assert len(json.dumps(evidence["native_outcomes"])) < 7000
    assert "PRIVATE" not in json.dumps(evidence)


def test_body_restriction_only_change_promotes_pending_periodic_review(runtime):
    port, clock, publish = runtime
    publish()
    assert port.decide(port.offer()["review"]["id"], "continue", "keep working")["acknowledged"]
    clock[0] += 180
    value = publish()
    periodic_id = port.state()["review"]["id"]
    assert port.state()["review"]["trigger"] == "periodic_review"
    value["facts"]["parts"].append({"key": "bodyRestriction", "text": "native inhibition reason"})
    (port.directory / "status.json").write_text(json.dumps(value), encoding="utf-8")
    port.observe(value)
    offered = port.offer()["review"]
    assert offered["id"] == periodic_id and offered["trigger"] == "state_changed"
    assert offered["evidence"]["facts"]["bodyRestriction"] == "native inhibition reason"
    assert port.defer(offered["id"], True)["error"] == "meaningful_review_requires_decision"


def test_event_added_to_pending_review_does_not_wake_again_after_ack(runtime):
    port, clock, publish = runtime
    publish()
    first_id = port.state()["review"]["id"]
    clock[0] += 1
    publish(body_events=[body_event()])
    assert port.offer()["review"]["id"] == first_id
    assert port.decide(first_id, "continue", "Wait for authoritative recovery")["acknowledged"]
    clock[0] += 60
    publish(body_events=[{**body_event(), "ts": "later sample"}])
    assert not port.offer()["offered"]


def test_native_failure_inhibition_recovery_each_offer_one_factual_reaction():
    first = commentary_observation(sample(), 10000)
    previous = first["baseline"]
    for changes, topic in (({"native_outcomes": [failed_outcome()]}, "task_failure"),
                           ({"body_events": [body_event()]}, "body_inhibited"),
                           ({"body_events": [body_event("recovered", 9, "[身体恢复] actual recovery")]}, "body_recovered")):
        event = commentary_observation({**sample(10010), **changes}, 10010)
        assert topic in commentary_changes(event, previous)["topics"]
        assert "task_progress" not in commentary_changes(event, previous)["topics"]
        assert not event["payload"]["progress"] and event["payload"]["task_outcome"] is None
        assert event["payload"]["body_feedback"]
        assert not commentary_changes(event, event["baseline"])["topics"]
        previous = event["baseline"]


def test_controller_projects_only_current_body_events(framework_module, tmp_path, run_async):
    _, _, controller = setup(framework_module, tmp_path, None)
    publications = []
    controller.publish = lambda **value: publications.append(value)
    for event in (body_event(), body_event(), {**body_event(cursor=8), "contextDelivery": "archive-only"},
                  {**body_event(cursor=9), "meta": {"staleEpoch": True}}):
        controller.receipt({"events": [event]})
    events = [value["body_events"] for value in publications if "body_events" in value]
    assert events and len(events[-1]) == 1
    assert events[-1][0]["original_event"]["cursor"] == 7


@pytest.mark.parametrize("message, expected", [("outcome_unknown: PRIVATE", "outcome_unknown"),
    ("connection_lost: PRIVATE", "connection_lost"), ("context_budget_exceeded: PRIVATE", "context_budget_exceeded"),
    ("PRIVATE", "RuntimeError")])
def test_runtime_persists_allowlisted_cause_without_exception_text(framework_module, tmp_path, run_async, monkeypatch, message, expected):
    from agent_mc_autonomy import runner
    settings = dataclasses.replace(framework_module.Settings(), enabled=True, host="example.test", username="test")
    async def fail(*_):
        raise RuntimeError(message)
    monkeypatch.setattr(runner.Controller, "run", fail)
    with pytest.raises(RuntimeError):
        run_async(runner.run_session(settings, tmp_path / "fake", tmp_path, None, "survive", lambda **_: None, lambda: False,
                                    bridge_factory=lambda *_: object()))
    persisted = json.loads((tmp_path / "sessions" / settings.identity / "host" / "status.json").read_text())
    assert persisted["error"] == expected and "PRIVATE" not in json.dumps(persisted)
