"""Exercise the model, unified planner, maid adapter and native walk receipt together."""
import asyncio
import json
from contextlib import asynccontextmanager
from uuid import UUID

import httpx
import pytest
from test_native_maid import MAID, OTHER, OWNER, NativeServer, make

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyAction
from agent_mc_harness.npc import IDLE_GOAL, ModelClient, NpcHost, NpcPlanner, NpcRole, reviewed_steps
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
        self.actions.extend(("rendezvous", "release_rendezvous"))

    def __call__(self, request):
        response = super().__call__(request)
        if json.loads(request.content).get("arguments", {}).get("action") != "context":
            return response
        envelope = response.json()
        content = envelope["result"]["content"][0]
        row = json.loads(content["text"])
        row["data"].update(health=20, maxHealth=20, nearbyPlayers=self.players, socialWalkAvailable=self.available,
                           taskId="touhou_little_maid:idle", nativeGuardDelegated=True, sitting=False,
                           canMove=True, homeMode=False, passenger=False)
        if self.directory is not None:
            row["data"]["characterDirectory"] = self.directory
        if self.navigation_target is not None:
            row["data"]["socialNavigationTargetUuid"] = self.navigation_target
        content["text"] = json.dumps(row)
        return httpx.Response(response.status_code, json=envelope)


@asynccontextmanager
async def setup(tmp_path, answer):
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
