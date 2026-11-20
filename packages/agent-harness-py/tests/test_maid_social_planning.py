"""Exercise the model, unified planner, maid adapter and native walk receipt together."""
import asyncio
import json
from contextlib import asynccontextmanager
from uuid import UUID

import httpx

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.npc import IDLE_GOAL, ModelClient, NpcHost, NpcPlanner, NpcRole
from agent_mc_harness.runtime import Intent, PlanContext
from test_native_maid import MAID, OTHER, OWNER, NativeServer, make


def peer(uid, name, x):
    return {"uuid": uid, "name": name, "dimension": "minecraft:overworld", "position": {"x": x, "y": 65, "z": 4}}


class VisiblePlayers(NativeServer):
    def __init__(self):
        super().__init__()
        self.players = [peer(OWNER, "Owner", 6), peer(OTHER, "Visitor", 16)]
        self.available = True

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
        content["text"] = json.dumps(row)
        return httpx.Response(response.status_code, json=envelope)


@asynccontextmanager
async def setup(tmp_path, answer):
    world = VisiblePlayers()
    who = NpcRole(id="qa_resident", name="测试伙伴", owner_id=UUID(OWNER), character_id=UUID(MAID),
                  body_id=UUID(MAID), body_kind="maid", provider="tokenplan", model="qa-model",
                  persona="Decide who to accompany.", allowed_tools=["body:move", "body:observe"])
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
        assert {p["uuid"] for p in facts["maidCompanions"]["nearbyPlayers"]} == {OWNER, OTHER}
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
        assert any(p["uuid"] == OTHER for p in facts["maidCompanions"]["nearbyPlayers"])
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
