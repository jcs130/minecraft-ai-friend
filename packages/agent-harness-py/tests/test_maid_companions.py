import asyncio
import hashlib
import json
from datetime import timedelta

import httpx
import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.maid_companions import MaidCompanions, parse_choice, walk_available
from agent_mc_harness.models import BodySnapshot, NativeAction, utcnow
from agent_mc_harness.npc import IDLE_GOAL, NpcHost, NpcPlanner
from agent_mc_harness.resident_turns import ResidentTurnsClient
from simbody import SimBody
from test_server_npc import role

OVERWORLD = "minecraft:overworld"
NETHER = "minecraft:the_nether"
ALICE = "cd861923-2f54-4dd2-8b8f-6cf10fbf9ece"
BOB = "8d6aa54b-98f7-4147-99d4-fe91ee8cd1fb"


def pos(x):
    return {"x": x, "y": 64, "z": 0}


def follow_step(**args):
    return {"tool": "body:follow", "args": args}


SPEECH = {"tool": "body:chat", "args": {"text": "过来啦！"}}


@pytest.mark.parametrize("mode,field", [("approach", "uuid"), ("follow", "targetUuid")])
def test_real_mixed_choice_echoes_only_produce_one_social_intention(mode, field):
    selection = {"mode": mode, "targetUuid": ALICE}
    plan = {"companion": selection, "steps": [SPEECH, follow_step(**{field: ALICE})]}
    assert parse_choice(plan, [{"uuid": ALICE}]) == selection
    assert parse_choice({"steps": plan["steps"]}, [{"uuid": ALICE}]) == {"mode": "follow", "targetUuid": ALICE}


def test_only_explicit_choice_can_reinterpret_empty_native_owner_follow():
    assert parse_choice({"steps": [follow_step()]}, [{"uuid": ALICE}]) is None
    assert parse_choice({"steps": [SPEECH]}, []) is None
    stop = {"mode": "stop"}
    assert parse_choice({"companion": stop, "steps": []}, []) == stop


def test_real_meeting_with_guard_and_chat_echoes_only_retains_chosen_companion():
    choice = {"mode":"approach", "targetUuid":ALICE, "travel":"teleport"}
    guard = {"tool":"body:native:guard", "args":{}}
    plan = {"steps":[guard, SPEECH], "companion":choice}
    assert parse_choice(plan, [{"uuid":ALICE}]) == choice
    for invalid in ([{**guard,"args":{"targetUuid":BOB}}], [guard,guard], [guard,{"tool":"body:attack"}]):
        with pytest.raises(ValueError):
            parse_choice({"steps":invalid,"companion":choice}, [{"uuid":ALICE}])
    with pytest.raises(ValueError):
        parse_choice({"steps":[guard],"companion":{"mode":"stop"}}, [])


@pytest.mark.parametrize("tool", ["body:observe", "body:inventory", "body:native:context"])
def test_published_argument_free_read_echo_does_not_prevent_meeting(tool):
    choice = {"mode":"approach", "targetUuid":ALICE, "travel":"teleport"}
    read = {"tool":tool, "args":{}}
    plan = {"steps":[SPEECH,read], "companion":choice}
    assert parse_choice(plan, [{"uuid":ALICE}], read_echoes={tool}) == choice
    for steps, available in [([read], set()), ([dict(read,args={"targetUuid":BOB})], {tool}),
                             ([read,read], {tool}), ([SPEECH,SPEECH], {tool})]:
        with pytest.raises(ValueError):
            parse_choice({"steps":steps,"companion":choice}, [{"uuid":ALICE}], read_echoes=available)


def test_real_follow_can_echo_both_matching_identity_fields():
    people = [{"uuid":ALICE,"name":"Alice","aliases":["伙伴"]}, {"uuid":BOB,"name":"Bob","aliases":["伙伴"]}]
    selection = {"mode":"follow", "targetUuid":ALICE, "travel":"auto"}
    for label in ("Alice", "伙伴"):
        plan = {"companion":{**selection, "targetName":label}, "steps":[SPEECH, {"tool":"body:native:guard","args":{}}]}
        assert parse_choice(plan, people) == selection
    for label in ("Bob", "unlisted"):
        with pytest.raises(ValueError):
            parse_choice({"companion":{**selection, "targetName":label}, "steps":[]}, people)


@pytest.mark.parametrize("plan", [
    {"steps": [follow_step(uuid=BOB)]},
    {"steps": [follow_step(uuid=ALICE), follow_step(uuid=ALICE)]},
    {"steps": [follow_step(uuid=ALICE, cooldown=0)]},
    {"steps": [follow_step(uuid=ALICE), {"tool": "body:attack"}]},
    {"steps": [follow_step(uuid=ALICE), SPEECH, SPEECH, SPEECH]},
    {"steps": [follow_step(uuid=ALICE)], "unknown": True},
    {"companion": {"mode": "summon", "targetUuid": ALICE}, "steps": []},
    {"companion": {"mode": "approach", "targetUuid": ALICE}, "steps": [follow_step(uuid=BOB)]},
    {"companion": {"mode": "approach", "targetUuid": ALICE}, "steps": [follow_step(uuid=None)]},
    {"companion": {"mode": "approach", "targetUuid": ALICE}, "steps": [{"tool": "body:move"}]},
    {"companion": {"mode": "stop"}, "steps": [follow_step()]},
    {"companion": {"mode": "approach", "targetUuid": BOB}, "steps": []},
])
def test_invalid_social_choices_never_create_body_actions(plan):
    with pytest.raises(ValueError):
        parse_choice(plan, [{"uuid": ALICE}])


def player(uid=ALICE, x=10, name="Alice", dimension=OVERWORLD):
    return {"uuid": uid, "name": name, "position": pos(x), "dimension": dimension}


def scene(*players, x=0, dimension=OVERWORLD, life="alive", age=0):
    return BodySnapshot(life_state=life, position=pos(x), dimension=dimension,
                        sampled_at=utcnow() - timedelta(seconds=age),
                        raw={"nearbyPlayers": list(players), "socialWalkAvailable": True})


@pytest.fixture
def loop():
    now = [0]
    return MaidCompanions(clock=lambda: now[0]), now


@pytest.mark.parametrize("make_snapshot", [
    lambda: scene(player(dimension=NETHER)),
    lambda: scene(player(x=25)),
    lambda: scene(player(), life="unloaded"),
    lambda: scene(player(), life="dead"),
    lambda: scene(player(), age=60),
    lambda: scene(player(), age=-15),
    lambda: scene(player(x=float("inf"))),
    lambda: scene(player(x=float("nan"))),
    lambda: scene(player(x=True)),
    lambda: scene(player(uid="Alice")),
    lambda: scene(player(name="")),
    lambda: scene({"uuid": ALICE}),
    lambda: BodySnapshot(life_state="alive", position=pos(0), dimension=OVERWORLD, raw={"chat": player()}),
    lambda: None,
])
def test_never_select_from_unusable_or_invented_evidence(loop, make_snapshot):
    snapshot = make_snapshot()
    tracking, _ = loop
    assert tracking.context(snapshot)["characters"] == []
    assert not tracking.choose("follow", ALICE, snapshot)
    assert tracking.next_step(snapshot) is None


def test_model_may_choose_any_observed_player_independent_of_name_and_owner(loop):
    tracking, now = loop
    obs = scene(player(name="Same"), player(BOB, x=12, name="Same"))
    ids = [p["uuid"] for p in tracking.context(obs)["characters"]]
    assert ids == [ALICE, BOB]
    assert not tracking.choose("follow", "Same", obs)
    assert tracking.choose("follow", BOB, obs)
    assert tracking.next_step(obs).args == {**pos(12), "dimension": OVERWORLD}
    assert tracking.choose("approach", ALICE, obs)
    assert tracking.next_step(obs) is None
    now[0] += 3
    assert tracking.next_step(obs).args == {**pos(10), "dimension": OVERWORLD}
    assert not tracking.choose("follow", "someone else", obs)
    assert tracking.context(obs)["selection"]["uuid"] == ALICE
    assert tracking.choose("stop", None, obs)
    assert not tracking.active and tracking.next_step(obs) is None


def test_approach_requires_observed_proximity(loop):
    tracking, now = loop
    obs = scene(player())
    assert tracking.choose("approach", ALICE, obs)
    assert tracking.next_step(obs).tool == "body:move"
    assert tracking.context(obs)["status"] == "tracking"
    now[0] += 5
    assert tracking.next_step(scene(player(x=15), x=7)).args == {**pos(15), "dimension": OVERWORLD}
    arrived = tracking.context(scene(player(x=15), x=13))
    assert arrived["selection"] is None and arrived["status"] == "arrived"


def test_follow_resumes_as_target_moves_with_hysteresis(loop):
    tracking, now = loop
    assert tracking.choose("follow", ALICE, scene(player(x=2)))
    assert tracking.status == "alongside" and tracking.active
    assert tracking.next_step(scene(player(x=4))) is None
    assert tracking.next_step(scene(player(x=7))).args == {**pos(7), "dimension": OVERWORLD}
    now[0] += 3
    assert tracking.next_step(scene(player(x=12), x=2)).args == {**pos(12), "dimension": OVERWORLD}
    assert tracking.next_step(scene(player(x=13), x=11)) is None
    assert tracking.status == "alongside" and tracking.active
    # A change from following to a one-time approach should close the remaining gap.
    assert tracking.choose("approach", ALICE, scene(player(x=15), x=11))
    now[0] += 3
    assert tracking.next_step(scene(player(x=15), x=11)).args == {**pos(15), "dimension": OVERWORLD}


def test_target_lost_avoids_stale_destination_and_switches_world(loop):
    tracking, now = loop
    obs = scene(player())
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(obs)
    now[0] = 5
    assert tracking.next_step(scene()) is None and tracking.status == "out_of_sight"
    now[0] = 12
    assert tracking.next_step(scene(player(x=15))).args == {**pos(15), "dimension": OVERWORLD}
    now[0] = 13
    assert tracking.next_step(scene()) is None
    now[0] = 29
    assert tracking.next_step(scene()) is None
    assert not tracking.active and tracking.status == "target_lost"
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(scene(dimension=NETHER)) is None and not tracking.active


def test_no_blind_retry_during_work_danger_or_unknown_receipt(loop):
    tracking, now = loop
    obs = scene(player())
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(obs, busy=True) is None
    assert tracking.next_step(obs)
    now[0] += 500
    assert tracking.next_step(obs, busy=True) is None
    assert tracking.active and tracking.attempts == 1


@pytest.mark.parametrize("activity", [
    {"socialWalkAvailable": False}, {"resident": {"sleeping": True}}, {"resident": {"downed": True}},
    {"resident": {"activeRequest": "original-request"}}, {"resident": {"leased": True}},
    {"resident": {"thinking": True}}, {"resident": {"recovery": "unknown_no_replay_query_original_request"}},
    {"resident": {"expedition": {"pendingTravelRequestId": "pending"}}},
    {"resident": {"combat": {"targetId": "mob"}}}, {"resident": {"expedition": {"state": "inspect_original_travel"}}},
])
def test_existing_native_activities_take_priority(loop, activity):
    tracking, _ = loop
    obs = scene(player())
    obs.raw.update(activity)
    if "resident" in obs.raw:
        obs.raw["resident"]["loaded"] = True
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(obs) is None
    assert tracking.next_step(scene(player())).tool == "body:move"


def test_native_auto_defence_task_remains_walkable_for_available_resident():
    obs = scene(player())
    obs.raw.update(taskId="touhou_little_maid:attack", resident={"loaded": True, "leased": False,
                   "thinking": False, "activeRequest": "none", "combat": {}, "expedition": {}})
    assert walk_available(obs)
    del obs.raw["socialWalkAvailable"]
    assert not walk_available(obs)


def test_unreachable_destination_yields_and_suppresses_rapid_reselection(loop):
    tracking, now = loop
    obs = scene(player())
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(obs)
    now[0] = 20
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(obs) is None
    now[0] = 30
    assert tracking.next_step(obs)
    now[0] = 60
    assert tracking.next_step(obs) is None
    assert tracking.status == "path_unavailable" and not tracking.active
    retained = tracking.context(obs)["characters"]
    assert len(retained) == 1 and retained[0]["uuid"] == ALICE and retained[0]["retryAfterSeconds"] == 90
    assert not tracking.choose("follow", ALICE, obs)
    now[0] = 160
    assert tracking.choose("follow", ALICE, obs)


def compass(*characters, dimension=OVERWORLD, x=0):
    result = scene(dimension=dimension, x=x)
    result.raw["characterDirectory"] = list(characters)
    return result


def test_targeted_navigation_selects_and_releases_only_the_current_character(loop):
    tracking, now = loop
    def sample(held, *players):
        result = compass(*players)
        result.raw["socialNavigationTargetUuid"] = held
        return result
    near = sample("", player(x=2), player(BOB, x=4))
    assert tracking.choose("follow", ALICE, near)
    first = tracking.next_step(near)
    assert first.tool == "body:move" and first.args["targetUuid"] == ALICE
    held = sample(ALICE, player(x=2), player(BOB, x=4))
    assert tracking.next_step(held) is None
    assert tracking.choose("follow", BOB, held)
    release = tracking.next_step(held)
    assert release.tool == "body:native:release_rendezvous" and release.args == {"targetUuid": ALICE}
    now[0] = 5
    assert tracking.next_step(sample("", player(BOB, x=9))).args["targetUuid"] == BOB
    active = sample(BOB, player(BOB, x=2))
    assert tracking.next_step(active) is None
    assert tracking.choose("stop", None, active)
    assert tracking.next_step(active).args == {"targetUuid": BOB}
    assert tracking.next_step(active) is None
    assert tracking.next_step(sample("", player(BOB))) is None


def test_approach_and_disappeared_targets_restore_prior_native_navigation(loop):
    tracking, now = loop
    here = compass(player(x=2))
    here.raw["socialNavigationTargetUuid"] = ALICE
    assert tracking.choose("approach", ALICE, here)
    assert not tracking.active and tracking.next_step(here).tool == "body:native:release_rendezvous"
    assert tracking.choose("follow", ALICE, here)
    assert tracking.next_step(here) is None
    missing = compass()
    missing.raw["socialNavigationTargetUuid"] = ALICE
    assert tracking.next_step(missing) is None
    now[0] += 16
    assert tracking.next_step(missing).args == {"targetUuid": ALICE}


def test_selecting_the_original_owner_keeps_native_follow_without_repeated_registration(loop):
    tracking, now = loop
    near = compass(player(x=2))
    near.raw.update(socialNavigationTargetUuid="", ownerId=ALICE)
    assert tracking.choose("follow", ALICE, near)
    for elapsed in (0, 4, 32, 64):
        now[0] = elapsed
        assert tracking.next_step(near) is None
    assert tracking.active and tracking.status == "alongside"


def test_target_moving_while_walking_does_not_look_like_repeated_path_failure(loop):
    tracking, now = loop
    initial = compass(player(x=10))
    assert tracking.choose("follow", ALICE, initial)
    assert tracking.next_step(initial, can_teleport=True).tool == "body:move"
    now[0] = 31
    assert tracking.next_step(initial, can_teleport=True).tool == "body:move"
    now[0] = 35
    replacement = tracking.next_step(compass(player(x=16)), can_teleport=True)
    assert replacement.tool == "body:move" and replacement.args["x"] == 16


def test_compass_selects_by_name_beyond_sight_and_paths_to_current_position(loop):
    tracking, now = loop
    observed = compass(player(x=55))
    offered = tracking.context(observed)
    assert offered["source"] == "skill_compass"
    assert offered["characters"][0]["position"] == pos(55)
    selection = parse_choice({"steps": [], "companion": {"mode": "follow", "targetName": "Alice"}}, offered["characters"])
    assert selection == {"mode": "follow", "targetUuid": ALICE}
    assert tracking.choose("follow", ALICE, compass(player(x=68)))
    assert tracking.next_step(compass(player(x=64))).args == {**pos(64), "dimension": OVERWORLD}
    with pytest.raises(ValueError, match="choose_one_character_uuid"):
        parse_choice({"steps": [], "companion": {"mode": "follow", "targetName": "ALICE"}},
                     tracking.context(compass(player(), player(BOB, name="Alice")))["characters"])


@pytest.mark.parametrize("dimension,x", [(NETHER, 8), (OVERWORLD, 1800)])
def test_remote_cast_is_target_bound_and_never_reissued_while_unsettled(loop, dimension, x):
    tracking, now = loop
    obs = compass(player(x=x, dimension=dimension))
    assert tracking.choose("follow", ALICE, obs)
    step = tracking.next_step(obs, can_teleport=True)
    assert step.tool == "body:native:rendezvous" and step.args == {"targetUuid": ALICE}
    now[0] += 100
    assert tracking.next_step(obs, can_teleport=True) is None
    assert tracking.context(obs)["status"] == "check_original_rendezvous_receipt"
    assert tracking.context(compass(player(x=x, dimension=dimension), x=x, dimension=dimension))["status"] == "alongside"


def test_explicit_remote_cast_uses_the_ready_turn_even_after_a_local_walk(loop):
    tracking, _ = loop
    local = compass(player())
    assert tracking.choose("follow", ALICE, local)
    assert tracking.next_step(local).tool == "body:move"
    remote = compass(player(), player(BOB, dimension=NETHER))
    remote.raw["socialNavigationTargetUuid"] = ALICE
    assert tracking.choose("approach", BOB, remote, travel="teleport", turn_hash="a1b2c3d4e5f6")
    action = tracking.next_step(remote, can_teleport=True)
    assert action.tool == "body:native:rendezvous" and action.args == {"targetUuid": BOB}
    assert tracking.turn_hash == "a1b2c3d4e5f6"


def test_explicit_remote_cast_reports_why_the_selected_trip_could_not_dispatch(loop):
    tracking, _ = loop
    remote = compass(player(dimension=NETHER))
    assert tracking.choose("approach", ALICE, remote, travel="teleport", turn_hash="a1b2c3d4e5f6")
    remote.raw["socialWalkAvailable"] = False
    assert tracking.next_step(remote, can_teleport=True) is None
    assert tracking.context(remote)["lastTransfer"] == {
        "targetUuid": ALICE, "turnHash": "a1b2c3d4e5f6", "stage": "before_dispatch",
        "status": "rejected", "message": "rendezvous_body_unavailable",
    }
    assert not tracking.active


@pytest.mark.parametrize("refusal", [None, "rendezvous_body_unavailable", "rendezvous_skill_unavailable"])
def test_portal_meeting_decision_dispatches_or_reports_a_preflight_refusal(tmp_path, refusal):
    async def run():
        actor = role(id="yui", body_kind="maid", activity_review_seconds=90,
                     allowed_tools=["body:move", "body:native:rendezvous"])
        body = SimBody(body_id=str(actor.body_id))
        await body.spawn()
        caps = body.capabilities()
        caps.native_actions.append(NativeAction(name="rendezvous"))
        body.capabilities = lambda: caps
        observed = compass(player(dimension=NETHER))
        observed.raw["resident"] = {"loaded": True}
        answer = {"steps": [], "companion": {"mode": "approach", "travel": "teleport", "targetUuid": ALICE}}
        turn_id = "5e68536f-0334-4442-8f73-130c9a963add"
        turn_hash = hashlib.sha256(turn_id.encode()).hexdigest()[:12]
        tokens = tmp_path / "turn.token"
        tokens.write_text("test-token", encoding="ascii")

        def offer(req):
            assert json.loads(req.content)["scene"]["maidCompanions"]["teleportAvailable"] is True
            if refusal == "rendezvous_body_unavailable":
                observed.raw.update(sitting=True, socialWalkAvailable=False)
            return httpx.Response(200, json={"state": "answered", "id": turn_id, "answer": answer})

        async def snapshot():
            return observed.model_copy(deep=True)

        body.snapshot = snapshot
        turns = ResidentTurnsClient(actor, {"endpoint": "http://127.0.0.1/api/v1/resident-turns/yui",
                                            "tokenFile": str(tokens)},
                                    http=httpx.AsyncClient(transport=httpx.MockTransport(offer)))
        journal = ActionJournal(tmp_path / "actions.sqlite3")
        host = NpcHost(actor, body, NpcPlanner(actor, None, resident_turns=turns), None, journal)

        if refusal == "rendezvous_skill_unavailable":
            async def plan_then_remove_capability(intent, context):
                steps = await host._plan(intent, context)
                context.capabilities.native_actions.clear()
                return steps

            host.runtime.planner = plan_then_remove_capability
        try:
            intent = host.runtime.submit_intent(IDLE_GOAL, agent=actor.id)
            await host.runtime.run_intent(intent)
            assert intent.resident_turn_hash == turn_hash
            host._settle_rendezvous(str(actor.body_id))
            last_transfer = host.companions.context(observed)["lastTransfer"]
            assert last_transfer["turnHash"] == turn_hash
            if refusal:
                assert not body.acts
                assert not journal.recent(str(actor.body_id))
                assert not host.companions.active
                assert not host.rendezvous_intent
                assert last_transfer["message"] == refusal
                assert "requestId" not in last_transfer
                if refusal == "rendezvous_skill_unavailable":
                    assert intent.state == "failed"
            else:
                action, = body.acts
                assert action.name == "rendezvous" and action.args == {"targetUuid": ALICE}
                assert journal.resident_turn_hash(action.request_id) == turn_hash
                receipt, = intent.receipts
                assert receipt.request_id == action.request_id and receipt.terminal
                assert last_transfer["requestId"] == receipt.request_id and last_transfer["status"] == "completed"
        finally:
            await turns.close()
            await host.close()

    asyncio.run(run())


def test_shared_skill_permission_required_and_directory_removal_wins_over_old_sight(loop):
    tracking, _ = loop
    obs = compass(player(x=500))
    obs.raw["nearbyPlayers"] = [player(BOB)]
    assert not tracking.choose("follow", BOB, obs)
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(obs, can_teleport=False).args == {**pos(32), "dimension": OVERWORLD}
    assert not tracking.choose("follow", ALICE, compass())


def test_requested_spell_on_older_bridge_reports_unavailable(loop):
    tracking, _ = loop
    obs = scene(player(x=12))
    assert tracking.choose("approach", ALICE, obs, travel="teleport")
    assert tracking.next_step(obs) is None
    assert tracking.status == "rendezvous_skill_unavailable"


@pytest.mark.parametrize("first_leg", ["cast", "already_alongside"])
def test_explicit_meeting_spell_is_not_recast_when_followed_peer_walks_away(loop, first_leg):
    from agent_mc_harness.models import ActionReceipt
    tracking, now = loop
    if first_leg == "cast":
        start = compass(player(dimension=NETHER))
        assert tracking.choose("follow", ALICE, start, travel="teleport")
        assert tracking.next_step(start, can_teleport=True).tool == "body:native:rendezvous"
        tracking.settle_transfer(ALICE, ActionReceipt(request_id="arrived-for-follow", verb="native",
                                                     status="completed", terminal=True))
    else:
        assert tracking.choose("follow", ALICE, compass(player(x=1)), travel="teleport")
    now[0] += 4
    next_scene = compass(player(x=10))
    next_scene.raw["socialNavigationTargetUuid"] = ALICE
    step = tracking.next_step(next_scene, can_teleport=True)
    assert step.tool == "body:move" and step.args["targetUuid"] == ALICE


def test_failed_remote_result_gives_planner_the_reason_and_no_new_charge(loop):
    from agent_mc_harness.models import ActionReceipt
    tracking, now = loop
    obs = compass(player(dimension=NETHER))
    assert tracking.choose("follow", ALICE, obs)
    assert tracking.next_step(obs, can_teleport=True)
    receipt = ActionReceipt(request_id="test-travel-rejected", verb="native", status="rejected", terminal=True, text="receipt: rejected",
                            data={"data": {"observation": {"reason": "insufficient_mana"}}})
    tracking.settle_transfer(ALICE, receipt)
    assert not tracking.active and not tracking.choose("follow", ALICE, obs)
    assert tracking.context(obs)["lastTransfer"]["message"] == "insufficient_mana"
    now[0] += 100
    assert tracking.choose("follow", ALICE, obs)

def test_explicit_overland_travel_uses_bounded_legs_without_charging_and_forbids_other_dimension(loop):
    tracking, now = loop
    obs = compass(player(x=950))
    obs.raw["socialNavigationTargetUuid"] = ""
    assert tracking.choose("approach", ALICE, obs, travel="walk")
    assert tracking.next_step(obs, can_teleport=True).args == {**pos(32),"dimension": OVERWORLD,"targetUuid": ALICE}
    now[0] += 8
    second = compass(player(x=950), x=32)
    second.raw["socialNavigationTargetUuid"] = ALICE
    assert tracking.next_step(second, can_teleport=True).args == {**pos(64),"dimension": OVERWORLD,"targetUuid": ALICE}
    now[0] += 8
    assert tracking.next_step(compass(player(dimension=NETHER)), can_teleport=True) is None
    assert tracking.status == "different_dimension_requires_rendezvous"
