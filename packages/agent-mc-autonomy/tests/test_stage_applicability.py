"""Real controller/mailbox/review seam; all bodies and clocks stay offline."""

import dataclasses
import json
import uuid
from datetime import datetime, timezone

import pytest

from agent_mc_autonomy.mailbox import Mailbox
from agent_mc_autonomy.review import ReviewPolicy, ReviewPort
from test_controller import action, choose, packed, setup
from test_death_memory import SCOPE, event, facts


@pytest.fixture
def seam(framework_module, tmp_path):
    seen, published, clock = [], {}, [10000]

    async def decide(messages, _):
        seen.append(messages)
        reply = choose()
        reply["tool_calls"][0]["function"]["arguments"] = json.dumps({"steps": [{"skill": "goto", "at": [301, 64, 2]}]})
        return reply

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    box = controller.commands = Mailbox(tmp_path)
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    port.configure(ReviewPolicy(enabled=True, idle_presence_seconds=900))
    body = [facts(episode_id=None)]
    body[0]["parts"].append({"key": "gear", "text": "logs=3"})
    original = bridge.call

    async def call(name, args, **kw):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed(body[0])
        return await original(name, args, **kw)

    bridge.call = call

    def publish(**values):
        published.update(values)
        snapshot = {"phase": "running", "game_connected": True, "owner_pid": 1,
                    "standing_goal": "Explore and build a home", **published,
                    "updated_at": datetime.fromtimestamp(clock[0], timezone.utc).isoformat()}
        (tmp_path / "status.json").write_text(json.dumps(snapshot), encoding="utf-8")

    controller.publish = publish
    controller.observe_game_facts(body[0])
    user = str(uuid.uuid4())
    box.submit_user_intent("feedback", {"goal": "Find flowers for the home", "mode": "insert"}, user)
    publish()
    return module, bridge, controller, box, port, body, clock, seen, published, user


def offer(port, directory):
    port.observe(json.loads((directory / "status.json").read_text(encoding="utf-8")))
    return port.offer()["review"]["id"]


def propose(port, directory, goal="Return to the old shore (1,64,2)"):
    review_id = offer(port, directory)
    assert port.decide(review_id, "inspect")["current_goal"]
    result = port.decide(review_id, "insert", "Old shore has observed materials", goal)
    assert result["acknowledged"] and result["dispatched"]
    return result["request_id"]


@pytest.mark.parametrize("reassessment", ["revise", "continue"])
def test_death_retires_stage_preserves_user_and_allows_fresh_local_action_and_reassessment(seam, tmp_path, run_async, reassessment):
    module, bridge, controller, box, port, body, clock, seen, published, user = seam
    run_async(controller.external_command())
    stage = propose(port, tmp_path)
    run_async(controller.external_command())
    before = box.goal_lineage(stage)[0]
    original_receipt = box.get(stage)["planner_report"]
    assert before["stage_baseline"]["scope"]
    assert published["current_goal"]["id"] == stage
    controller.pending[("task", "body-1")] = action()
    controller.receipt({"events": [event()]})
    assert box.get(stage)["delivery"] == "needs_reassessment"
    assert published["current_goal"]["id"] == user
    assert published["historical_goal"]["id"] == stage
    assert published["historical_goal"]["applicability"] == "requires_fresh_review"
    assert box.goal_lineage(stage)[0]["goal"] == before["goal"]
    assert box.get(stage)["planner_report"] == original_receipt
    body[0] = facts()
    body[0]["parts"].append({"key": "gear", "text": "inventory empty"})
    run_async(controller.events())
    assert controller.death_recovery and not controller.continuation_ready
    controller.receipt({"execution": {**action(True), "phase": "cancelled"}})
    run_async(controller.events())
    assert controller.continuation_ready and controller.death_recovery is None
    prompt = controller.goal_prompt("Explore and build a home")
    assert "Current user goal" in prompt and "Find flowers for the home" in prompt
    assert "Historical host proposal" in prompt and "requires fresh reassessment" in prompt
    assert "Host review proposed stage: Return" not in prompt
    run_async(controller.turn_once("Explore and build a home", "prefix", module.model_tools(bridge.tools)))
    assert seen and any(name == "mc_do" for name, _, _ in bridge.calls)
    from agent_mc_autonomy.viewer_public import viewer_projection
    assert viewer_projection(published, "offline", "session")["goal"] == "Find flowers for the home"
    sent = next(args for name, args, _ in bridge.calls if name == "mc_do")
    assert sent["steps"] == [{"skill": "goto", "at": [301, 64, 2]}]
    episode = controller.death_memory.entries(SCOPE)[0]
    assert not episode.get("host_review", {}).get("acknowledged") and episode["lesson"] is None
    controller.receipt({"execution": action(True)})
    clock[0] += 180
    controller.publish()
    review_id = offer(port, tmp_path)
    inspected = port.decide(review_id, "inspect")
    assert inspected["historical_goal"]["id"] == stage
    assert inspected["current_user_goal"]["id"] == user
    assert inspected["stage_delivery"]["can_revise"]
    assert not port.state()["review"].get("result")
    result = port.decide(review_id, reassessment, "Fresh body inventory is empty; local flowers remain an alternative",
                         "Seek flowers from the current spawn" if reassessment == "revise" else "",
                         death_reflection={"episode_id": "death-1", "outcome": "deferred", "reason": "No verified lesson yet"})
    assert result["acknowledged"] and result["dispatched"]
    run_async(controller.external_command())
    active = box.active_goal()
    assert active["id"] != stage and active["revision_of"] == stage
    assert active["stage_baseline"] != before["stage_baseline"]
    assert active["stage_baseline"]["lifecycle"]["episodeId"] == "death-1"
    assert box.current_user_goal(active["id"])["id"] == user
    assert box.get(stage)["delivery"] == "revised"
    assert published["current_goal"]["id"] == active["id"]
    assert port.state()["last_decision"]["reason"] == "Fresh body inventory is empty; local flowers remain an alternative"
    if reassessment == "continue":
        # Crash after mailbox commit must preserve the actual continuation choice.
        with port.transaction() as state:
            state["review"].pop("result")
            state["review"].pop("choice")
        assert port.decide(review_id, "continue", "Fresh body inventory is empty; local flowers remain an alternative")["acknowledged"]
        recovered = port.state()
        assert recovered["review"]["choice"]["decision"] == "continue"
        assert recovered["review"]["choice"]["goal"] == ""
        assert recovered["review"]["result"]["recovered"]


@pytest.mark.parametrize("record_death_first", [False, True])
def test_predeath_accepted_stage_cannot_cross_delayed_admission(seam, tmp_path, run_async, record_death_first):
    _, _, controller, box, port, body, _, _, published, user = seam
    run_async(controller.external_command())
    delayed = propose(port, tmp_path)
    body[0] = facts()
    if record_death_first:
        controller.receipt({"events": [event()]})
    run_async(controller.external_command())
    assert box.get(delayed)["delivery"] == "needs_reassessment"
    assert box.active_goal()["id"] == user and published["current_goal"]["id"] == user
    assert box.goal_lineage(delayed)[0]["goal"].startswith("Return to the old shore")


@pytest.mark.parametrize("legacy", [False, True])
def test_restart_hydrates_death_and_unscoped_host_stage_without_deleting_history(seam, tmp_path, run_async, framework_module, legacy):
    _, _, controller, box, port, body, _, _, _, user = seam
    run_async(controller.external_command())
    stage = propose(port, tmp_path)
    run_async(controller.external_command())
    if legacy:
        with box.connection() as db:
            payload = json.loads(db.execute("SELECT payload FROM commands WHERE id=?", (stage,)).fetchone()[0])
            payload.pop("stage_baseline")
            db.execute("UPDATE commands SET payload=? WHERE id=?", (json.dumps(payload), stage))
    controller.death_memory.record(event(), facts(), [], [], [])
    _, _, restarted = setup(framework_module, tmp_path, None)
    restarted.commands = box
    restarted.active_goal = box.active_goal()
    unsynced = facts()
    for part in unsynced["parts"]:
        if part["key"] == "recoveryState":
            value = json.loads(part["text"])
            part["text"] = json.dumps({**value, "inventorySynced": False})
    restarted.observe_game_facts(unsynced)
    assert restarted.death_waiting and restarted.death_recovery["id"] == "death-1"
    assert box.get(stage)["delivery"] == "needs_reassessment"
    assert restarted.active_goal["id"] == user
    assert box.goal_lineage(stage)[0]["goal"].startswith("Return to the old shore")


def test_legacy_stage_is_historical_even_without_any_death(seam, run_async):
    _, _, controller, box, _, _, _, _, published, user = seam
    run_async(controller.external_command())
    stage = str(uuid.uuid4())
    box.submit("feedback", {"goal": "Old unscoped coordinate", "mode": "insert", "origin": "host_review", "parent_id": user}, stage)
    box.activate_feedback(box.claim())
    controller.active_goal = box.active_goal()
    controller.observe_game_facts(controller.game_facts)
    assert box.get(stage)["delivery"] == "needs_reassessment"
    assert published["current_goal"]["id"] == user
    assert published["historical_goal"]["reason"] == "missing_body_baseline"


def test_operator_stop_and_unknown_dispatch_are_not_released_by_applicability(seam, tmp_path, run_async, framework_module):
    _, _, controller, box, port, _, _, _, _, _ = seam
    run_async(controller.external_command())
    stage = propose(port, tmp_path)
    run_async(controller.external_command())
    box.submit("stop", {}, str(uuid.uuid4()))
    run_async(controller.external_command())
    controller.receipt({"events": [event()]})
    assert controller.stop_requested() and box.get(stage)["delivery"] == "cancelled"
    controller.persist(uncertain=True)
    _, bridge, restarted = setup(framework_module, tmp_path, None)
    restarted.commands = box
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(restarted.run("standing intent"))
    assert not bridge.opened


def test_real_run_hands_off_to_local_action_after_native_drain_without_host_ack(seam, tmp_path, run_async, monkeypatch):
    import asyncio
    from types import SimpleNamespace

    module, bridge, controller, box, port, body, clock, seen, published, user = seam
    run_async(controller.external_command())
    stage = propose(port, tmp_path)
    run_async(controller.external_command())
    controller.pending[("task", "body-1")] = action()
    body[0] = facts()
    body[0]["parts"].append({"key": "gear", "text": "empty"})
    bridge.event_pages = [[{**event(), "trigger": "flush"}], [{"cursor": 2, "execution": {**action(True), "phase": "cancelled"}}]]
    controller.settings = dataclasses.replace(controller.settings, max_decisions=1, min_decision_seconds=999)
    controller.last_decision = clock[0]
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)
    run_async(controller.run("Explore and build a home"))
    assert len(seen) == 1 and clock[0] < 10010
    text = json.dumps(seen[0])
    assert "Historical host proposal" in text and "Find flowers for the home" in text
    assert "Host review proposed stage: Return" not in text
    assert published["current_goal"]["id"] == user
    assert box.get(stage)["delivery"] == "needs_reassessment"
    episode = controller.death_memory.entries(SCOPE)[0]
    assert not episode.get("host_review", {}).get("acknowledged") and episode["lesson"] is None


def test_transport_inspection_and_accepted_speech_never_imply_ack_or_learning(seam, tmp_path, run_async):
    _, _, controller, _, port, body, clock, _, _, _ = seam
    run_async(controller.external_command())
    controller.receipt({"events": [event()]})
    body[0] = facts()
    body[0]["parts"].append({"key": "gear", "text": "empty"})
    run_async(controller.events())
    review_id = offer(port, tmp_path)
    port.delivered(review_id, True)
    record = controller.death_memory.entries(SCOPE)[0]
    assert record["host_review"]["transport_accepted"] and not record["host_review"]["acknowledged"]
    inspected = port.decide(review_id, "inspect")
    assert inspected["death_episode"]["id"] == "death-1"
    assert not port.state()["review"].get("result")
    enqueued = []

    def speech(correlation):
        record = controller.death_memory.entries(SCOPE)[0]
        assert not record["host_review"]["acknowledged"]
        assert record["lesson"] is None and not record["behavioral_improvement_verified"]
        enqueued.append(correlation)
        return {"status": "enqueued", "transport_accepted": True, "playback_verified": False}

    result = port.decide(review_id, "continue", "Work locally while the cause remains unverified", before_dispatch=speech,
                         death_reflection={"episode_id": "death-1", "outcome": "deferred", "reason": "Insufficient causal evidence"})
    assert result["acknowledged"] and len(enqueued) == 1
    record = controller.death_memory.entries(SCOPE)[0]
    assert record["host_review"]["acknowledged"] and record["lesson"] is None
    assert not record["behavioral_improvement_verified"] and not record["host_review"]["playback_verified"]


def test_fresh_facts_reproject_goal_before_model_prompt_even_without_replayed_death_event(seam, tmp_path, run_async):
    module, _, controller, box, port, body, _, seen, published, user = seam
    run_async(controller.external_command())
    stage = propose(port, tmp_path)
    run_async(controller.external_command())
    body[0] = facts()
    run_async(controller.turn_once("Explore and build a home", "prefix", module.model_tools(controller.bridge.tools)))
    assert box.get(stage)["delivery"] == "needs_reassessment"
    assert published["current_goal"]["id"] == user
    text = json.dumps(seen[0])
    assert "Historical host proposal" in text and "Host review proposed stage: Return" not in text


def test_stage_report_cannot_complete_resumed_user_goal_when_fresh_facts_retire_its_target(seam, tmp_path, run_async):
    _, _, controller, box, port, body, _, _, _, user = seam
    run_async(controller.external_command())
    stage = propose(port, tmp_path)
    run_async(controller.external_command())
    body[0] = facts()
    result, _ = run_async(controller.dispatch("goal_report", {"outcome": "reported_done", "evidence": "Old shore looked complete"}, str(uuid.uuid4())))
    assert result["failed"] and result["dispatched"] is False
    assert box.get(stage)["delivery"] == "needs_reassessment"
    assert box.get(user)["delivery"] == "planning" and box.get(user)["planner_report"] is None
    assert controller.inflight_request is None
