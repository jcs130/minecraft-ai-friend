import asyncio
import json
import time

import httpx
import pytest

from agent_mc_harness.agenda import schedule
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyEvent, NativeAction
from agent_mc_harness.npc import DANGER_GOAL, DIALOGUE_GOAL, IDLE_GOAL, ModelClient, NpcHost, NpcPlanner, reviewed_steps
from agent_mc_harness.resident_turns import ResidentTurnsClient
from agent_mc_harness.runtime import Intent, PlanContext
from simbody import SimBody
from test_npc_native_continuity import maid_context
from test_server_npc import role

WINDOW = {"afterMinutes": 0, "forMinutes": 10, "goal": "巡视营地", "evidence": "观察到营地入口"}


@pytest.mark.parametrize("kind", ["maid", "numen"])
def test_shared_planner_and_original_body_keep_agenda_across_restart(kind, tmp_path):
    async def run():
        actor = role(body_kind=kind)
        body = SimBody()
        await body.spawn()
        scenes, local_calls = [], []
        answers = [{"steps": [], "agenda": [WINDOW]}, {"steps": []}, None, {"steps": [{"tool": "body:command"}]}]
        key_file = tmp_path / "worker.txt"
        key_file.write_text("test-key")

        def offer(req):
            payload = json.loads(req.content)
            assert (payload["kind"], payload["bodyId"], payload["bodyKind"]) == ("plan", str(actor.body_id), kind)
            assert req.headers["Authorization"] == "Bearer test-key"
            scenes.append(payload["scene"])
            answer = answers.pop(0)
            return httpx.Response(200, json={"state": "answered", "id": "turn-test", "answer": answer} if answer else {"state": "local"})

        def complete(req):
            local_calls.append(req)
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"steps":[]}'}}]})

        turns = ResidentTurnsClient(actor, {"endpoint": "https://portal.example/api/v1/resident-turns/kirito", "tokenFile": key_file},
                                    http=httpx.AsyncClient(transport=httpx.MockTransport(offer)))
        model = ModelClient("https://model.example", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(complete)))
        planner = NpcPlanner(actor, model, resident_turns=turns)
        path = tmp_path / "journal.sqlite"
        async def tick(host, goal=IDLE_GOAL):
            return await host._plan(Intent(id="test-turn", agent=actor.id, goal=goal),
                                    PlanContext(snapshot=await body.snapshot(), capabilities=body.capabilities()))
        for first in [True, False]:
            journal = ActionJournal(path)
            host = NpcHost(actor, body, planner, None, journal)
            try:
                assert await tick(host) == []
                if first:
                    assert scenes[-1]["agenda"]["current"] is None
                else:
                    assert scenes[-1]["agenda"]["current"]["goal"] == WINDOW["goal"]
                    assert await tick(host, DANGER_GOAL) == [] and len(local_calls) == 1
                    assert scenes[-1]["goal"] == DANGER_GOAL
                    with pytest.raises(ValueError, match="action_not_in_current_body_catalogue"):
                        await tick(host)
            finally:
                host.unsubscribe()
                journal.close()
        assert not body.acts
        await turns.close()
        await model.close()
    asyncio.run(run())


def test_agenda_windows_overlap_expiry_concurrent_create_and_scope(tmp_path):
    journal = ActionJournal(tmp_path / "agenda.sqlite")
    now = time.time()
    windows = schedule([WINDOW, {**WINDOW, "afterMinutes": 15, "goal": "回营"}], now)
    journal.save_agenda("a", windows, now)
    journal.save_agenda("a", schedule([{**WINDOW, "goal": "覆写"}], now), now)
    assert journal.agenda("a", now)["current"]["goal"] == WINDOW["goal"]
    assert journal.agenda("b", now)["current"] is None
    assert journal.agenda("a", now + 700)["upcoming"][0]["goal"] == "回营"
    assert journal.agenda("a", now + 900)["current"]["goal"] == "回营"
    assert not journal.agenda("a", now + 1500)["current"]
    end = windows[-1]["endsAt"]
    replacement = schedule([{**WINDOW, "goal": "另约时间"}], now + 1)
    journal.save_agenda("a", replacement, now + 1, end)
    journal.save_agenda("a", [], now + 2, end)
    assert journal.agenda("a", now + 2)["current"]["goal"] == "另约时间"
    journal.save_agenda("a", [], now + 3, replacement[-1]["endsAt"])
    assert journal.agenda("a", now + 3)["current"] is None
    for invalid in [[WINDOW, WINDOW], [{**WINDOW, "afterMinutes": 1439}], [{**WINDOW, "goal": " "}], [{**WINDOW, "forMinutes": True}]]:
        with pytest.raises(ValueError):
            schedule(invalid, now)
    journal.close()


def test_only_addressed_owner_dialogue_can_cancel_an_active_agenda():
    async def run():
        actor = role(body_kind="maid")
        ctx = maid_context()
        ctx.agenda = {"current": schedule([WINDOW], time.time())[0], "upcoming": []}
        body = str(actor.body_id)
        event = BodyEvent(kind="dialogue",body_kind="maid",body_id=body,text="取消原日程",
                          data={"maidId":body,"eventId":"qa-order","serverAttributed":True,"deliveryScope":"addressed",
                                "recipientId":body,"speakerId":str(actor.owner_id)})
        reply = {"choices":[{"message":{"content":'{"steps":[],"agenda":[]}'}}]}
        model = ModelClient("https://model.example", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200,json=reply))))
        planner = NpcPlanner(actor, model)
        turn = Intent(id="order",agent=actor.id,goal=DIALOGUE_GOAL)
        ctx.dialogue = [event]
        assert await planner(turn, ctx) == [] and ctx.proposed_agenda == []
        ctx.dialogue[0].data["speakerId"] = "another-person"
        with pytest.raises(ValueError, match="npc_plan_schema"):
            await planner(turn, ctx)
        await model.close()
    asyncio.run(run())


def test_matching_work_or_shift_continues_without_waking_a_seated_maid():
    task_id = "touhou_little_maid:farm"
    actor = role(body_kind="maid", allowed_tools=["body:native:task", "body:native:schedule"], native_tasks=[task_id])
    ctx = maid_context(taskId=task_id, sitting=False, taskEnabled=True, schedule="DAY")
    ctx.capabilities.native_actions.extend(NativeAction(name=n) for n in ("task", "schedule"))
    task = {"tool": "body:native:task", "args": {"taskId": task_id}}
    shift = {"tool": "body:native:schedule", "args": {"schedule": "DAY"}}
    assert reviewed_steps(actor, ctx, [task, shift]) == []
    ctx.snapshot.raw["sitting"] = True
    assert len(reviewed_steps(actor, ctx, [task])) == 1


def test_survey_is_reused_only_at_its_original_position_and_while_fresh():
    actor = role(allowed_tools=["body:native:survey"])
    ctx = maid_context()
    ctx.snapshot.health = 20
    ctx.snapshot.dimension = "minecraft:overworld"
    ctx.capabilities.native_actions.append(NativeAction(name="survey"))
    sample = {"dimension": ctx.snapshot.dimension, "at": time.time(), "origin": [3, 64, 8]}
    ctx.body_results = [{"action": "survey", "status": "completed", "survey": sample}]
    survey = [{"tool": "body:native:survey"}]
    assert reviewed_steps(actor, ctx, survey) == []
    ctx.snapshot.position["x"] = 4
    assert len(reviewed_steps(actor, ctx, survey)) == 1
    ctx.snapshot.position["x"] = 3
    sample["at"] -= 100
    assert len(reviewed_steps(actor, ctx, survey)) == 1
