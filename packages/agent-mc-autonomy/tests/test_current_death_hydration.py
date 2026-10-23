import json
from copy import deepcopy

import pytest

from agent_mc_autonomy.death_memory import DeathMemory, scope_key
from agent_mc_autonomy.host_context import HostContextPort
from test_controller import action, setup
from test_death_memory import SCOPE, event, facts
from test_death_reflection_contract import reflection
from test_review_speech import setup as review_setup


def completed_latest(tmp_path):
    port, clock, publish = review_setup(tmp_path)
    store = DeathMemory(tmp_path)
    older = store.record(event(), facts(), [], [], [])
    newer = store.record(event(2), facts(episode_id="death-2"), [], [], [])
    fresh = facts(episode_id="death-2")
    fresh["parts"].append({"key": "gear", "text": "empty"})
    publish(game_identity=SCOPE, death_episode=newer, facts=fresh, owner_pid=46012)
    review = port.offer()["review"]
    port.decide(review["id"], "inspect")
    result = port.decide(review["id"], "continue", "Choose local work from current body facts", death_reflection=reflection(newer))
    assert result["acknowledged"]
    return port, clock, publish, store, older, store.entries(SCOPE)[0], fresh


@pytest.mark.parametrize("lifecycle_available", [True, False])
def test_restart_does_not_hydrate_older_pending_death_or_block_fresh_profile_and_presence(
        framework_module, tmp_path, run_async, lifecycle_available):
    port, clock, publish, store, older, newer, fresh = completed_latest(tmp_path)
    originals = deepcopy(store.entries(SCOPE))
    context = HostContextPort(tmp_path, now=lambda: clock[0])
    context.publish({"agent_name": "Actor", "persona": "Public role", "current_intent": "Old session intent",
                     "memories": [{"id": "old", "source": "selected", "text": "Old selected memory"}]},
                    session="46012:", revision=port.mailbox.intent_revision())
    clock[0] += 61
    if not lifecycle_available:
        fresh = {"parts": [p for p in fresh["parts"] if p["key"] != "deathLifecycle"]}
    module, bridge, controller = setup(framework_module, tmp_path, None)
    controller.commands = port.mailbox
    controller.publish = lambda **values: publish(owner_pid=43804, **values)
    controller.observe_game_facts(fresh)
    status = json.loads((tmp_path / "status.json").read_text(encoding="utf-8"))
    assert status["death_episode"] is None
    assert [row["id"] for row in store.entries(SCOPE, pending=True)] == [older["id"]]
    assert store.execute(SCOPE, {"action": "get", "id": older["id"]})["source_event"] == older["source_event"]
    profile = {"agent_name": "Actor", "persona": "Public role", "persona_source": "character_profile"}
    for delay in (0, 45, 180, 300, 600):
        clock[0] += delay
        controller.publish(facts=fresh, game_identity=SCOPE, death_episode=None)
        offered = port.offer()["review"]
        assert offered["trigger"] != "death_review" and not offered["evidence"].get("death_episode")
        inspected = port.decide(offered["id"], "inspect")
        assert inspected["evidence_ref"] and not inspected.get("death_episode")
        assert port.bind_character(offered["id"], inspected["evidence_ref"], profile)["available"]
        current = context.read(port.mailbox.intent_revision())
        assert current["stable"]["persona"] == "Public role"
        assert current["dynamic"]["current_intent"] == "" and current["dynamic"]["memories"] == []
        if offered["trigger"] == "periodic_review":
            assert port.defer(offered["id"], True)["acknowledged"] is False
        else:
            assert port.decide(offered["id"], "continue", "Ordinary fresh presence")["acknowledged"]
        controller.receipt({"execution": {**action(True), "id": "unrelated-known-body-work"}})
    assert store.entries(SCOPE) == originals
    assert not store.entries(SCOPE, pending=True)[0].get("host_review", {}).get("acknowledged")


def test_legacy_uninspectable_current_review_is_superseded_without_acknowledging_backlog(tmp_path):
    port, clock, publish, store, older, newer, fresh = completed_latest(tmp_path)
    older["host_review"] = {"review_id": "earlier-attempt", "inspected_at": clock[0] - 10,
                            "acknowledged": False, "transport_accepted": True}
    with store.connection() as db:
        db.execute("UPDATE death_episodes SET body=? WHERE scope=? AND id=?", (json.dumps(older), scope_key(SCOPE), older["id"]))
    clock[0] += 61
    # A pre-upgrade persisted .68 envelope, with no lifecycle part in its snapshot.
    missing_lifecycle = {"parts": [p for p in fresh["parts"] if p["key"] != "deathLifecycle"]}
    publish(game_identity=SCOPE, death_episode=older, facts=missing_lifecycle, owner_pid=43804)
    with port.transaction() as state:
        review = state["review"]
        review.update(id="legacy-death-slot", created_at=clock[0], attempts=1,
                      notification_accepted=True, trigger="death_review", urgent="death:" + older["id"])
        review.pop("inspected_at", None)
        review["evidence"]["death_episode"] = older
        review.pop("result", None)
        review.pop("choice", None)
        state["retry_after"] = clock[0] + 300
    originals = deepcopy(store.entries(SCOPE))
    assert originals[1]["host_review"]["inspected_at"] == 9990
    assert port.offer()["reason"] == "death_episode_superseded"
    assert port.decide("legacy-death-slot", "inspect")["error"] == "death_episode_superseded"
    clock[0] += 1
    publish(game_identity=SCOPE, death_episode=older, facts=missing_lifecycle, owner_pid=43804)
    offered = port.offer()["review"]
    assert offered["id"] != "legacy-death-slot" and offered["trigger"] != "death_review"
    inspected = port.decide(offered["id"], "inspect")
    assert inspected["evidence_ref"] and not inspected.get("death_episode")
    assert "retry_after" not in port.state()
    assert port.state()["last_superseded_review"]["acknowledged"] is False
    assert port.state()["last_superseded_review"]["inspected_at"] is None
    assert store.entries(SCOPE) == originals


def test_latest_real_death_remains_fresh_inspection_required_and_supersession_safe(tmp_path):
    port, clock, publish, store, older, newer, fresh = completed_latest(tmp_path)
    clock[0] += 61
    latest = store.record(event(3), facts(episode_id="death-3"), [], [], [])
    current = facts(episode_id="death-3")
    current["parts"].append({"key": "gear", "text": "empty"})
    publish(game_identity=SCOPE, death_episode=latest, facts=current, owner_pid=43804)
    offered = port.offer()["review"]
    assert offered["trigger"] == "death_review" and offered["evidence"]["death_episode"]["id"] == latest["id"]
    assert port.decide(offered["id"], "continue", "Reassess", death_reflection=reflection(latest))["error"] == "fresh_recovery_inspection_required"
    assert port.decide(offered["id"], "inspect")["death_episode"]["id"] == latest["id"]
    assert not store.entries(SCOPE)[0].get("host_review", {}).get("acknowledged")
    assert store.entries(SCOPE)[0]["lesson"] is None
    store.record(event(4), facts(episode_id="death-4"), [], [], [])
    assert port.decide(offered["id"], "continue", "Old evidence", death_reflection=reflection(latest))["error"] == "death_episode_superseded"
    assert store.execute(SCOPE, {"action": "get", "id": older["id"]})["lesson"] is None
