import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyAction, BodySnapshot
from agent_mc_harness.npc import FastSelector, ModelClient, NpcPlanner, NpcRole, reviewed_steps
from agent_mc_harness.runtime import HarnessRuntime, PlanContext, Step
from simbody import SimBody


def role(**changes):
    values = dict(id="kirito", name="桐人", character_id="8ae995f9-5944-48c9-b720-0ab91bdfff09",
                  body_id="8ae995f9-5944-48c9-b720-0ab91bdfff09", owner_id="00000000-0000-4000-8000-000000000001",
                  body_kind="numen", provider="tokenplan", model="qwen3.8-flash", persona="A thoughtful swordsman.",
                  allowed_tools=["body:chat", "body:move", "body:attack", "body:observe", "body:stop"])
    return NpcRole(**(values | changes))


def test_unknown_configured_verb_is_rejected_before_host_start():
    with pytest.raises(ValueError):
        role(allowed_tools=["body:observe", "body:use"])
    assert role(allowed_tools=["body:observe", "body:use_item"]).allowed_tools[-1] == "body:use_item"


@pytest.mark.parametrize("step", [
    {"tool": "body:command", "args": {"line": "/op anyone"}},
    {"tool": "body:attack", "args": {"target": "player"}},
    {"tool": "body:chat", "args": {"text": "x" * 41}},
    {"tool": "body:move", "args": {"companion": "other-role", "x": 1, "y": 2, "z": 3}},
])
def test_model_cannot_expand_body_authority(step):
    with pytest.raises(ValueError):
        reviewed_steps(role(), PlanContext(capabilities=SimBody().capabilities()), [step])


def test_slow_model_gets_current_scene_and_empty_plan_rests():
    async def run():
        received = []
        def answer(request):
            received.append(json.loads(request.content))
            return httpx.Response(200, json={"id": "synthetic-plan", "choices": [{"message": {"content": '{"steps":[]}'}}]})
        http = httpx.AsyncClient(transport=httpx.MockTransport(answer))
        model = ModelClient("http://127.0.0.1:4000/v1", "test", http=http)
        body = SimBody()
        await body.spawn()
        runtime = HarnessRuntime(body=body, planner=NpcPlanner(role(), model), execute=True)
        intent = runtime.submit_intent("Observe and rest if safe")
        await runtime.run_intent(intent)
        assert intent.state == "completed" and not body.acts
        assert json.loads(received[0]["messages"][1]["content"])["observed"]["health"] == 20
        assert received[0]["model"] == "qwen3.8-flash"
        await runtime.close()
        await model.close()
    asyncio.run(run())


def test_unknown_write_blocks_other_writes_after_restart(tmp_path):
    async def run():
        path = tmp_path / "actions.sqlite"
        body = SimBody(unknown={"move"})
        await body.spawn()
        journal = ActionJournal(path)
        runtime = HarnessRuntime(body=body, execute=True, journal=journal)
        intent = runtime.submit_intent("move", steps=[{"tool": "body:move", "args": {"x": 1, "y": 64, "z": 0}}])
        await runtime.run_intent(intent)
        assert intent.state == "paused"
        original = journal.unresolved(body.body_id)[0]
        await runtime.close()
        journal.close()
        journal = ActionJournal(path)
        second = SimBody()
        await second.spawn()
        runtime = HarnessRuntime(body=second, execute=True, journal=journal)
        retry = runtime.submit_intent("try another action", steps=[{"tool": "body:chat", "args": {"text": "hello"}}])
        await runtime.run_intent(retry)
        assert retry.state == "paused" and not second.acts
        assert journal.unresolved(body.body_id)[0].request_id == original.request_id
        second.restore_request(original)
        assert (await second.result(original.request_id)).status == "unknown" and not second.acts
        await runtime.close()
        journal.close()
    asyncio.run(run())


def test_journal_commit_failure_prevents_dispatch(tmp_path):
    async def run():
        body = SimBody()
        await body.spawn()
        journal = ActionJournal(tmp_path / "actions.sqlite")
        def fail(*args): raise OSError("disk full")
        journal.begin = fail
        runtime = HarnessRuntime(body=body, execute=True, journal=journal)
        intent = runtime.submit_intent("chat", steps=[{"tool": "body:chat", "args": {"text": "hello"}}])
        await runtime.run_intent(intent)
        assert not body.acts and intent.state == "failed"
        await runtime.close()
        journal.close()
    asyncio.run(run())


@pytest.mark.parametrize("choice,confidence,age,expected", [("guard", .9, 0, True), ("invented", .99, 0, False), ("guard", .3, 0, False), ("guard", .9, 10, False)])
def test_fast_model_is_a_fresh_bounded_selector(choice, confidence, age, expected):
    async def run():
        http = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={
            "answers": {"action": {"choice": choice, "confidence": confidence}}})))
        client = ModelClient("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "test", http=http)
        selector = FastSelector(client)
        context = PlanContext(capabilities=SimBody().capabilities(), snapshot=BodySnapshot(life_state="alive", sampled_at=datetime.now(UTC)-timedelta(seconds=age)))
        result = await selector.choose(role(), context, {"guard": Step(tool="body:attack", args={"target": "hostile"}), "wait": Step(tool="body:observe")})
        assert (result is not None) == expected
        await client.close()
    asyncio.run(run())


def test_cross_role_receipt_does_not_clear_pending(tmp_path):
    from agent_mc_harness.models import ActionReceipt
    journal = ActionJournal(tmp_path / "actions.sqlite")
    journal.begin("kirito", BodyAction(verb="move", request_id="original_123"))
    with pytest.raises(ValueError):
        journal.settle("yui", ActionReceipt(request_id="original_123", verb="move", status="completed", terminal=True))
    assert len(journal.unresolved("kirito")) == 1
    journal.close()


def test_numen_consumes_delivered_dialogue_without_reply_loop(tmp_path):
    from agent_mc_harness.models import BodyEvent, BodyIdentity, WorldRef
    from agent_mc_harness.npc import NpcHost
    async def run():
        actor = role()
        body = SimBody(body_id=str(actor.body_id))
        body.identity = lambda: BodyIdentity(kind="numen", body_id=str(actor.body_id), world=WorldRef(server_id="qa", world_key="world"), scope=actor.scope("qa"))
        async def plan(intent, context):
            return [Step(tool="body:chat", args={"text":"收到。"})] if intent.source_events else []
        host = NpcHost(actor, body, plan, None, ActionJournal(tmp_path / "dialogue.sqlite"))
        host._event(BodyEvent(kind="chat", body_kind="numen", text="桐人，在吗？", body_id=str(actor.body_id), data={"eventId":"original_event_1", "speakerId":str(actor.owner_id)}))
        running = asyncio.create_task(host.run())
        try:
            for _ in range(40):
                if body.acts: break
                await asyncio.sleep(.05)
            assert len(body.acts) == 1
            host.next_plan = 0
            host.wake.set()
            await asyncio.sleep(2.3)
            assert len(body.acts) == 1
            assert not host.pending_dialogue
        finally:
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)
            await host.close()
    asyncio.run(run())
