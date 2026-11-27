"""Exercise the model, unified planner, maid adapter and native walk receipt together."""
import asyncio
import json
import time
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import httpx
import pytest
from test_native_maid import MAID, OTHER, OWNER, NativeServer, make

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyAction
from agent_mc_harness.npc import DESKTOP_GOAL, IDLE_GOAL, ModelClient, NpcHost, NpcPlanner, NpcRole, reviewed_steps
from agent_mc_harness.resident_turns import ResidentTurnsClient
from agent_mc_harness.runtime import Intent, PlanContext


def peer(uid, name, x):
    return {"uuid": uid, "name": name, "dimension": "minecraft:overworld", "position": {"x": x, "y": 65, "z": 4}}


class VisiblePlayers(NativeServer):
    def __init__(self):
        super().__init__()
        self.players = [peer(OWNER, "Owner", 6), peer(OTHER, "Visitor", 16)]
        self.available = True
        self.directory = None
        self.navigation_target = None
        self.dimension = "minecraft:overworld"
        self.seated = False
        self.actions.extend(("rendezvous", "release_rendezvous"))

    def __call__(self, request):
        response = super().__call__(request)
        if json.loads(request.content).get("arguments", {}).get("action") != "context":
            return response
        envelope = response.json()
        content = envelope["result"]["content"][0]
        row = json.loads(content["text"])
        row["data"].update(health=20, maxHealth=20, dimension=self.dimension, resident={"loaded": True},
                           nearbyPlayers=self.players, socialWalkAvailable=self.available,
                           taskId="touhou_little_maid:idle", nativeGuardDelegated=True, sitting=self.seated,
                           canMove=True, homeMode=False, passenger=False)
        if self.directory is not None:
            row["data"]["characterDirectory"] = self.directory
        if self.navigation_target is not None:
            row["data"]["socialNavigationTargetUuid"] = self.navigation_target
        content["text"] = json.dumps(row)
        return httpx.Response(response.status_code, json=envelope)


def test_seated_resident_reads_compass_then_stands_and_chooses_a_partner(tmp_path):
    async def run():
        world = VisiblePlayers()
        world.actions.append("task")
        world.directory = [peer(OTHER, "Partner", 16)]
        world.seated, world.available = True, False
        task_id = "touhou_little_maid:idle"
        who = NpcRole(id="healer", name="Healer", owner_id=UUID(OWNER), character_id=UUID(MAID),
                      body_id=UUID(MAID), body_kind="maid", provider="tokenplan", model="qa",
                      persona="Decide how to help.", native_tasks=[task_id], activity_review_seconds=60,
                      allowed_tools=["body:move", "body:native:task", "body:observe"])
        body = make(world, scope=who.scope("qa"))
        journal = ActionJournal(tmp_path / "actions.sqlite")
        prompts = []

        def decide(request):
            facts = json.loads(json.loads(request.content)["messages"][1]["content"])
            prompts.append(facts)
            if facts["activityReview"]["activity"] == "waiting":
                assert "maidCompanions" not in facts
                assert [p["uuid"] for p in facts["activityReview"]["compassWhileWaiting"]] == [OTHER]
                plan = {"steps": [{"tool": "body:native:task", "args": {"taskId": task_id}}]}
            else:
                assert facts["maidCompanions"]["characters"][0]["uuid"] == OTHER
                plan = {"steps": [], "companion": {"mode": "approach", "targetUuid": OTHER}}
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(plan)}}]})

        model = ModelClient("http://127.0.0.1:1/v1", "fixture", http=httpx.AsyncClient(transport=httpx.MockTransport(decide)))
        host = NpcHost(who, body, NpcPlanner(who, model), None, journal)
        try:
            await body.spawn()
            for index, expected in enumerate(["body:native:task", "body:move"]):
                context = PlanContext(snapshot=await body.snapshot(), capabilities=body.capabilities())
                steps = await host._plan(Intent(id=f"turn-{index}", agent=who.id, goal=IDLE_GOAL), context)
                assert [s.tool for s in steps] == [expected]
                if index == 0:
                    assert not world.writes  # Directory read itself never changes posture or casts travel.
                    applied = await body.act(steps[0].action("qa-stand-for-social-trip"))
                    assert applied.status == "completed"
                    world.seated, world.available = False, True
            assert len(prompts) == 2
        finally:
            await body.destroy()
            await model.close()
            journal.close()
    asyncio.run(run())


def test_recent_rejected_maid_waypoint_changes_the_plan(tmp_path):
    async def run():
        destination = {"x": 9, "y": 65, "z": 4, "dimension": "minecraft:overworld"}
        async with setup(tmp_path, lambda *_: {}) as (_, body, _):
            here = PlanContext(snapshot=await body.snapshot(), capabilities=body.capabilities(),
                               body_results=[{"action": "move", "destination": destination, "pathBlockedUntil": time.time() + 29}])
            who = NpcRole(id="helper", name="Helper", owner_id=UUID(OWNER), character_id=UUID(MAID),
                          body_id=UUID(MAID), body_kind="maid", provider="tokenplan", model="qa",
                          persona="Explore.", allowed_tools=["body:move", "body:chat"])
            goto = {"tool": "body:move", "args": destination}
            assert reviewed_steps(who, here, [goto, {"tool": "body:chat", "args":{"text":"到了"}}]) == []
            assert reviewed_steps(who, here, [{"tool": "body:move", "args": {**destination, "x": 8}}])
            assert reviewed_steps(who, here, [{"tool": "body:move", "args": {**destination, "dimension": "minecraft:the_nether"}}])
            here.body_results[0]["pathBlockedUntil"] = time.time() - 1
            assert reviewed_steps(who, here, [goto])
    asyncio.run(run())


def test_native_blocked_walk_reaches_next_model_turn(tmp_path):
    from agent_mc_harness.models import ActionReceipt, utcnow

    destination = {"x": 3, "y": 64, "z": 9, "dimension": "minecraft:overworld"}
    def seed(journal):
        rid = "original-blocked-walk"
        journal.begin(MAID, BodyAction(verb="move", args=destination, request_id=rid))
        journal.settle(MAID, ActionReceipt(verb="move", request_id=rid, status="failed", terminal=True,
                       text="path_blocked", data={"reply": {"data":{"observedAt":utcnow().isoformat(),
                       "observation":{"reason":"path_blocked", "effectsApplied":False}}}}))

    def decide(world, facts):
        previous = facts["recentBodyResults"][0]
        assert previous["destination"] == destination and previous["pathBlockedUntil"] > time.time()
        return {"steps":[{"tool":"body:move","args":destination}]}

    async def run():
        async with setup(tmp_path, decide, seed_journal=seed) as (world, _, plan):
            assert await plan() == []
            assert not world.writes
    asyncio.run(run())


@asynccontextmanager
async def setup(tmp_path, answer, *, seed_journal=None):
    world = VisiblePlayers()
    who = NpcRole(id="qa_resident", name="测试伙伴", owner_id=UUID(OWNER), character_id=UUID(MAID),
                  body_id=UUID(MAID), body_kind="maid", provider="tokenplan", model="qa-model",
                  persona="Decide who to accompany.", allowed_tools=["body:move", "body:observe", "body:native:rendezvous"])
    def respond(request):
        facts = json.loads(json.loads(request.content)["messages"][1]["content"])
        plan = answer(world, facts)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(plan)}}]})
    client = ModelClient("http://127.0.0.1:1/v1", "synthetic", http=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    body = make(world, scope=who.scope("qa-server"))
    journal = ActionJournal(tmp_path / "actions.sqlite")
    if seed_journal:
        seed_journal(journal)
    host = NpcHost(who, body, NpcPlanner(who, client), None, journal)
    try:
        await body.spawn()
        async def plan():
            ctx = PlanContext(snapshot=await body.snapshot(), capabilities=body.capabilities())
            return await host._plan(Intent(id="qa-turn", agent=who.id, goal=IDLE_GOAL), ctx)
        yield world, body, plan
    finally:
        await body.destroy()
        await client.close()
        journal.close()


def test_model_selects_a_nonowner_and_native_body_settles_walk(tmp_path):
    def answer(world, facts):
        assert {p["uuid"] for p in facts["maidCompanions"]["characters"]} == {OWNER, OTHER}
        return {"steps": [{"tool": "body:chat", "args": {"text": "我跟上了"}},
                          {"tool": "body:follow", "args": {"targetUuid": OTHER}}],
                "companion": {"mode": "follow", "targetUuid": OTHER}}
    async def run():
        async with setup(tmp_path, answer) as (world, body, plan):
            steps = await plan()
            assert len(steps) == 1 and steps[0].tool == "body:move"
            sent = await body.act(steps[0].action("social-walk-fixture"))
            assert sent.status == "accepted" and not sent.terminal
            result = await body.result(sent.request_id)
            assert result.status == "completed" and result.terminal
            assert (await body.snapshot()).position["x"] > 12
            assert [w["action"] for w in world.writes] == ["walk"]
            assert world.controller and world.position["x"] > 12
    asyncio.run(run())


def test_player_leaving_while_model_thinks_prevents_stale_walk(tmp_path):
    def depart(world, facts):
        assert any(p["uuid"] == OTHER for p in facts["maidCompanions"]["characters"])
        world.players = [p for p in world.players if p["uuid"] != OTHER]
        return {"steps": [], "companion": {"mode": "approach", "targetUuid": OTHER}}
    async def run():
        async with setup(tmp_path, depart) as (world, body, plan):
            assert await plan() == []
            assert not world.writes and (await body.snapshot()).position["x"] == 3
    asyncio.run(run())


def test_previous_choice_cannot_move_body_after_native_work_starts(tmp_path):
    decisions = []
    def answer(world, facts):
        if decisions:
            assert facts["maidCompanions"]["selection"]["uuid"] == OTHER
            world.available = False
        decisions.append(True)
        return {"steps": [], "companion": {"mode": "follow", "targetUuid": OTHER}}
    async def run():
        async with setup(tmp_path, answer) as (world, body, plan):
            world.players = [peer(OTHER, "Visitor", 4)]
            assert await plan() == []  # Already beside the visitor.
            world.players = [peer(OTHER, "Visitor", 13)]
            assert await plan() == []  # A workshop started during this turn.
            assert len(decisions) == 2 and not world.writes
            assert (await body.snapshot()).position["x"] == 3
    asyncio.run(run())

def test_model_can_choose_a_remote_name_and_recovers_the_original_travel_receipt(tmp_path):
    def answer(world, facts):
        compass = facts["maidCompanions"]
        assert compass["source"] == "skill_compass" and compass["teleportAvailable"]
        assert [row["uuid"] for row in compass["characters"]] == [OTHER]
        assert compass["characters"][0]["dimension"] == "minecraft:the_nether"
        return {"steps": [], "companion": {"mode": "follow", "targetName": "可米"}}

    async def run():
        async with setup(tmp_path, answer) as (world, body, plan):
            world.directory = [{**peer(OTHER, "ag_CorMy", 1000), "dimension": "minecraft:the_nether", "aliases": ["可米"]}]
            steps = await plan()
            assert [s.tool for s in steps] == ["body:native:rendezvous"]
            assert steps[0].args == {"targetUuid": OTHER}
            rid = "cross-dimension-social-trip"
            world.drop_reply = True
            assert (await body.act(steps[0].action(rid))).status == "unknown"
            at = {"dimension": "minecraft:the_nether", "x": 1001, "y": 64, "z": 2}
            world.receipts[rid].update(status="completed", goalCompleted=True,
                                       observation={"arrived": True, "targetUuid": OWNER, "actualPosition": at, "targetPosition": at})
            assert (await body.result(rid)).status == "unknown"
            world.receipts[rid]["observation"]["targetUuid"] = OTHER
            world.receipts[rid]["observation"]["targetPosition"] = at | {"x": -500}
            assert (await body.result(rid)).status == "unknown"
            world.receipts[rid]["observation"]["targetPosition"] = at
            assert (await body.result(rid)).status == "completed"
            assert [w["action"] for w in world.writes] == ["rendezvous"]
    asyncio.run(run())


def test_host_targeted_walk_reaches_native_bridge_but_direct_model_arguments_cannot(tmp_path):
    def answer(world, facts):
        return {"steps": [], "companion": {"mode": "follow", "targetUuid": OTHER}}
    async def run():
        async with setup(tmp_path, answer) as (world, body, plan):
            world.directory = [peer(OTHER, "Visitor", 9)]
            world.navigation_target = ""
            steps = await plan()
            assert steps[0].args["targetUuid"] == OTHER
            who = NpcRole(id="qa_role", name="QA", owner_id=UUID(OWNER), character_id=UUID(MAID), body_id=UUID(MAID),
                          body_kind="maid", provider="tokenplan", model="test", persona="test", allowed_tools=["body:move"])
            with pytest.raises(ValueError, match="choose_companion"):
                reviewed_steps(who, PlanContext(capabilities=body.capabilities()), [steps[0].model_dump()])
            await body.act(steps[0].action("selected-peer-navigation"))
            assert len(world.writes) == 1 and world.writes[0]["targetUuid"] == OTHER
            missing = await body.act(BodyAction(verb="native", name="release_rendezvous", request_id="no-target-release"))
            assert missing.status == "rejected" and len(world.writes) == 1
    asyncio.run(run())


@pytest.mark.parametrize("scenario", ["arrive", "unknown", "busy", "scene_changed", "unlisted", "no_skill", "raw", "walk", "blocked_walk", "release"])
def test_desktop_activity_review_dispatches_only_current_compass_decisions(tmp_path, scenario):
    async def run():
        world = VisiblePlayers()
        target = peer(OTHER, "ag_CorMy", 16)
        world.directory = [target]
        world.navigation_target = OWNER if scenario == "release" else ""
        world.dimension = "minecraft:overworld" if scenario in {"walk", "blocked_walk"} else "minecraft:aincrad"
        allowed = ["body:move", "body:observe", "body:native:release_rendezvous"]
        if scenario != "no_skill":
            allowed.append("body:native:rendezvous")
        who = NpcRole(id="yui", name="结衣", body_id=UUID(MAID), character_id=UUID(MAID), owner_id=UUID(OWNER),
                      body_kind="maid", provider="tokenplan", model="qa", persona="Choose a companion.",
                      activity_review_seconds=60, allowed_tools=allowed)
        request_id = str(uuid4())
        offers = []

        def desktop(request):
            scene = json.loads(request.content)["scene"]
            offers.append(scene)
            assert scene["desktopRequestId"] == request_id and scene["goal"] == DESKTOP_GOAL
            assert scene["maidCompanions"]["characters"][0]["uuid"] == OTHER
            if scenario == "busy":
                world.available = False
            if scenario == "scene_changed":
                world.dimension = "minecraft:the_nether"
            if scenario == "unlisted":
                world.directory = []
            if scenario == "raw":
                answer = {"steps": [{"tool": "body:native:rendezvous", "args": {"targetUuid": OTHER}}]}
            elif scenario == "release":
                answer = {"steps": [], "companion": {"mode": "stop"}}
            else:
                travel = {"walk": "walk", "blocked_walk": "auto"}.get(scenario, "teleport")
                answer = {"steps": [], "companion": {"mode": "approach", "targetName": "ag_CorMy", "travel": travel}}
            return httpx.Response(200, json={"state": "answered", "id": "desktop-turn", "answer": answer})

        def game(request):
            before = world.position
            response = world(request)
            args = json.loads(request.content).get("arguments", {})
            action = args.get("action")
            if action == "walk" and scenario == "blocked_walk":
                rid = args["requestId"]
                world.position = before
                world.receipts[rid].pop("actualPosition", None)
                world.receipts[rid].update(status="rejected", goalCompleted=False,
                                           observation={"reason": "path_blocked", "effectsApplied": False})
                envelope = response.json()
                envelope["result"]["content"][0]["text"] = json.dumps({"ok": False, "reason": "path_blocked", "data": world.receipts[rid]})
                return httpx.Response(200, json=envelope)
            if action != "rendezvous" or scenario not in {"arrive", "blocked_walk"}:
                return response
            rid = args["requestId"]
            at = {"dimension": target["dimension"], **target["position"]}
            world.position, world.dimension = target["position"], target["dimension"]
            world.receipts[rid].update(status="completed", goalCompleted=True, observation={
                "arrived": True, "targetUuid": OTHER, "targetPosition": at, "actualPosition": at})
            envelope = response.json()
            envelope["result"]["content"][0]["text"] = json.dumps({"ok": True, "data": world.receipts[rid]})
            return httpx.Response(200, json=envelope)

        key = tmp_path / "worker"
        key.write_text("fixture")
        turns = ResidentTurnsClient(who, {"endpoint": "https://worker.example/api/v1/resident-turns/yui", "tokenFile": key},
                                    http=httpx.AsyncClient(transport=httpx.MockTransport(desktop)))
        body = make(game, scope=who.scope("qa-server"))
        journal = ActionJournal(tmp_path / "actions.sqlite")
        host = NpcHost(who, body, NpcPlanner(who, None, resident_turns=turns), None, journal)
        try:
            await body.spawn()
            intent = host.runtime.submit_intent(DESKTOP_GOAL, agent=who.id)
            intent.desktop_request_id = request_id
            host.runtime.step_timeout = .01
            await host.runtime.run_intent(intent)
            assert len(offers) == 1
            expected = {"arrive": "rendezvous", "unknown": "rendezvous", "walk": "walk", "blocked_walk": "walk", "release": "release_rendezvous"}
            if scenario not in expected:
                assert not world.writes and not intent.receipts and not host.companions.remote_sent
                assert intent.state == ("failed" if scenario == "raw" else "completed")
                return
            assert [(w["action"], w["targetUuid"]) for w in world.writes] == [
                (expected[scenario], OWNER if scenario == "release" else OTHER)]
            original, = intent.receipts
            assert original.request_id == world.writes[0]["requestId"]
            if scenario == "unknown":
                assert intent.state == "paused" and not original.terminal
                assert [a.request_id for a in journal.unresolved(MAID)] == [original.request_id]
                assert host.companions.next_step(await body.snapshot(), can_teleport=True) is None
            elif scenario == "blocked_walk":
                assert intent.state == "failed" and original.terminal and original.text == "path_blocked"
                assert journal.receipt(MAID, original.request_id) == original
                host.next_plan = time.monotonic() + 600  # Recovery does not wait for another model answer.
                host.companions.clock = lambda: host.companions.last_walk + 4
                host.runtime.start()
                settler = asyncio.create_task(host._actor_loop(body.identity()))
                try:
                    async with asyncio.timeout(4):
                        while host.companions.last_transfer is None:
                            await asyncio.sleep(.01)
                    assert [w["action"] for w in world.writes] == ["walk", "rendezvous"]
                    transfer = host.companions.last_transfer
                    assert transfer["status"] == "completed" and transfer["requestId"] != original.request_id
                    observed = await body.snapshot()
                    assert (observed.dimension, observed.position) == (target["dimension"], target["position"])
                finally:
                    host.closed = True
                    host.wake.set()
                    await settler
            else:
                assert intent.state == "completed" and original.terminal and original.status == "completed"
                assert journal.receipt(MAID, original.request_id) == original
                if scenario == "arrive":
                    observed = await body.snapshot()
                    assert (observed.dimension, observed.position) == (target["dimension"], target["position"])
                    host.next_plan = time.monotonic() + 600
                    settler = asyncio.create_task(host._actor_loop(body.identity()))
                    try:
                        async with asyncio.timeout(2):
                            while host.companion_trip is not None:
                                await asyncio.sleep(.01)
                        result = host.companions.context(observed)
                        assert result["status"] == "arrived"
                        assert result["lastTransfer"]["requestId"] == original.request_id
                        assert result["lastTransfer"]["targetUuid"] == OTHER
                        assert len(world.writes) == 1
                    finally:
                        host.closed = True
                        host.wake.set()
                        await settler
        finally:
            await host.close()
            await turns.close()
    asyncio.run(run())
