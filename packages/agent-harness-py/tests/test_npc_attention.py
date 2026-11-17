import asyncio
import json

import httpx
import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyEvent, BodyIdentity, NativeAction, WorldRef
from agent_mc_harness.npc import FastSelector, ModelClient, NpcHost, NpcPlanner
from simbody import SimBody
from test_server_npc import role
from agent_mc_harness.runtime import Intent, PlanContext


def body_for(actor):
    body = SimBody(body_id=str(actor.body_id))
    body.identity = lambda: BodyIdentity(kind=actor.body_kind, body_id=str(actor.body_id),
        world=WorldRef(server_id="qa", world_key="world"), scope=actor.scope("qa"))
    if actor.body_kind == "maid":
        original = body.capabilities
        def caps():
            value = original()
            value.native_actions.append(NativeAction(name="ack"))
            return value
        body.capabilities = caps
    return body


async def wait_until(predicate):
    for _ in range(100):
        if predicate():
            return
        await asyncio.sleep(.03)
    assert predicate()


@pytest.mark.parametrize("kind", ["numen", "maid"])
def test_deliberate_silence_is_consumed_across_restart_without_claiming_reply(tmp_path, kind):
    async def run():
        actor = role(body_kind=kind)
        calls = []
        async def listen(intent, context):
            if intent.source_events:
                calls.append(intent.source_events)
            return []
        event = BodyEvent(kind="chat", body_kind=kind, body_id=str(actor.body_id),
            text="可米，我们去整理箱子。", data={"eventId": "overheard-1", "speakerId": str(actor.owner_id), "maidId": str(actor.body_id)})
        path = tmp_path / "attention.sqlite"
        for restarted in (False, True):
            body = body_for(actor)
            journal = ActionJournal(path)
            host = NpcHost(actor, body, listen, None, journal)
            host._event(event)
            running = asyncio.create_task(host.run())
            try:
                await wait_until(lambda: not host.pending_dialogue)
                assert not any(a.verb == "chat" for a in body.acts)
                assert not journal.replied(str(actor.body_id), "overheard-1")
                assert len(calls) == 1, "the same overheard line must not be reconsidered after restart"
                assert sum(a.name == "ack" for a in body.acts) == (1 if kind == "maid" and not restarted else 0)
            finally:
                running.cancel()
                await asyncio.gather(running, return_exceptions=True)
                await host.close()
    asyncio.run(run())


def test_ordinary_chat_and_speaker_reach_planner_even_at_severity_one(tmp_path):
    async def run():
        actor = role()
        received = []
        def answer(request):
            received.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"steps":[]}'}}]})
        client = ModelClient("http://127.0.0.1:4000/v1", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(answer)))
        body = body_for(actor)
        host = NpcHost(actor, body, NpcPlanner(actor, client), None, ActionJournal(tmp_path / "attention.sqlite"))
        host._event(BodyEvent(kind="chat", severity=1, body_kind="numen", body_id=str(actor.body_id),
            text="桐人，你在吗？", data={"eventId": "addressed-1", "speaker": "小鱼", "speakerId": str(actor.owner_id)}))
        running = asyncio.create_task(host.run())
        try:
            await wait_until(lambda: bool(received))
            facts = json.loads(received[0]["messages"][1]["content"])
            assert facts["currentDialogue"][0]["text"] == "桐人，你在吗？"
            assert facts["currentDialogue"][0]["data"]["speaker"] == "小鱼"
            assert facts["self"]["name"] == "桐人"
            assert "whether" in received[0]["messages"][0]["content"]
        finally:
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)
            await host.close()
            await client.close()
    asyncio.run(run())


def test_failed_decision_does_not_consume_message(tmp_path):
    async def run():
        actor = role()
        body = body_for(actor)
        async def broken(intent, context):
            raise TimeoutError("model unavailable")
        host = NpcHost(actor, body, broken, None, ActionJournal(tmp_path / "attention.sqlite"))
        host._event(BodyEvent(kind="dialogue", body_kind="numen", body_id=str(actor.body_id),
            text="桐人，帮帮我。", data={"eventId": "help-1", "speakerId": str(actor.owner_id)}))
        running = asyncio.create_task(host.run())
        try:
            await wait_until(lambda: any(i.state == "failed" for i in host.runtime.intents.values()))
            assert "help-1" in host.pending_dialogue and not body.acts
        finally:
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)
            await host.close()
    asyncio.run(run())


@pytest.mark.parametrize("answer,silent", [('{}', True), ('[]', True), ('{"steps":[{}]}', False), ('{"command":"op anyone"}', False), ('null', False)])
def test_empty_json_abstains_but_malformed_actions_still_fail_closed(answer, silent):
    async def run():
        client = ModelClient("http://127.0.0.1:4000/v1", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"choices": [{"message": {"content": answer}}]}))))
        planner = NpcPlanner(role(), client)
        intent = Intent(id="qa-empty", agent="qa", goal="Decide whether to reply")
        try:
            if silent:
                assert await planner(intent, PlanContext(capabilities=SimBody().capabilities())) == []
            else:
                with pytest.raises(ValueError):
                    await planner(intent, PlanContext(capabilities=SimBody().capabilities()))
        finally:
            await client.close()
    asyncio.run(run())


@pytest.mark.parametrize("choice,confidence,expected", [("listen", .98, False), ("speak", .96, True), ("speak", .4, True)])
def test_attention_checks_proposed_speech_without_executing_actions(choice, confidence, expected):
    async def run():
        paths = []
        def answer(request):
            paths.append(request.url.path)
            if request.url.path.endswith("systemone"):
                return httpx.Response(200, json={"answers": {"reply": {"choice": choice, "confidence": confidence}}})
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"steps":[{"tool":"body:chat","args":{"text":"矿坑见。"}}]}'}}]})
        client = ModelClient("http://127.0.0.1:4000/v1", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(answer)))
        planner = NpcPlanner(role(), client, fast=FastSelector(client))
        try:
            steps = await planner(Intent(id="qa-attention", agent="qa", goal="Decide whether to reply"),
                PlanContext(capabilities=SimBody().capabilities(), dialogue=[BodyEvent(kind="chat", body_kind="numen", text="小鱼，你先去矿坑。")]))
            assert any(step.tool == "body:chat" for step in steps) == expected
            assert paths == ["/v1/chat/completions", "/v1/systemone"]
        finally:
            await client.close()
    asyncio.run(run())
