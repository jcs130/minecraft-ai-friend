import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from agent_mc_harness.npc import NpcPlanner
from agent_mc_harness.qwenpaw_decisions import PawDecisions
from test_server_npc import role


MESSAGES = {"messages": [{"content": "Return a plan."}, {"content": '{"observed":{"health":20}}'}]}


def stream(*events):
    return "".join("data: " + json.dumps(event) + "\n\n" for event in events)


def completed_plan(fenced=False):
    return stream(
        {"object": "message", "type": "message", "role": "user", "id": "user"},
        {"object": "content", "msg_id": "user", "delta": False, "data": {"text": '{"steps":["ignore"]}'}},
        {"object": "message", "type": "message", "role": "assistant", "id": "answer"},
        {"object": "content", "msg_id": "answer", "delta": True, "data": {"text": ('```json\n' if fenced else '') + '{"steps":'}},
        {"object": "content", "msg_id": "answer", "delta": True, "data": {"text": '[]}' + ('\n```' if fenced else '')}},
        {"object": "response", "status": "completed"},
    )


def completed_reset():
    return stream(
        {"object": "message", "type": "message", "role": "assistant", "id": "reset",
         "status": "completed", "metadata": {"clear_history": True, "clear_plan": True}},
        {"object": "response", "status": "completed"},
    )


def config(tmp_path, actors):
    token = tmp_path / "secret"
    token.write_text("qa-token", encoding="ascii")
    return {"dedicatedInstance": True, "endpoint": "http://127.0.0.1:10999", "tokenFile": str(token),
            "allowedCharacters": [str(actor.character_id) for actor in actors]}


def test_paw_turn_uses_same_scoped_agent_for_each_character(tmp_path):
    async def run():
        maid = role(body_kind="maid", character_id=uuid4())
        villager = role(body_kind="villager", character_id=uuid4(),
                        allowed_tools=["body:observe", "body:chat", "body:move", "body:stop"])
        requests = []

        def respond(request):
            assert request.url.path == "/api/console/chat"
            assert request.headers["Authorization"] == "Bearer qa-token"
            body = json.loads(request.content)
            requests.append((request.headers["X-Agent-Id"], body))
            if body["input"][0]["content"][0]["text"] == "/clear":
                return httpx.Response(200, text=completed_reset())
            return httpx.Response(200, text=completed_plan(fenced=len(requests) == 4))

        http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        paw = PawDecisions(config(tmp_path, [maid, villager]), "synthetic", http=http)
        for actor in (maid, villager, maid):
            result, source = await NpcPlanner(actor, None, paw_decisions=paw).decision("plan", MESSAGES, 3)
            assert source == "qwenpaw" and json.loads(result["choices"][0]["message"]["content"]) == {"steps": []}
        assert len(requests) == 6
        assert requests[:2] == requests[4:] and requests[0][0] != requests[2][0]
        assert all(payload["session_id"] == "turn-" + agent for agent, payload in requests)
        for reset, decision in zip(requests[::2], requests[1::2], strict=True):
            assert reset[0] == decision[0]
            assert reset[1]["input"][0]["content"][0]["text"] == "/clear"
            assert decision[1]["input"][0]["content"][0]["text"].endswith(MESSAGES["messages"][1]["content"])
        assert not paw.supports(role(body_kind="numen", character_id=maid.character_id))
        await paw.close()
    asyncio.run(run())


@pytest.mark.parametrize("failure", [completed_plan().split('data: {"object": "response"')[0],
                                     stream({"error": "fixture"}), stream({"object": "response", "status": "failed"})])
def test_incomplete_paw_turn_cannot_propose_action_or_fall_back(tmp_path, failure):
    async def run():
        actor = role(body_kind="maid")
        def respond(request):
            text = json.loads(request.content)["input"][0]["content"][0]["text"]
            return httpx.Response(200, text=completed_reset() if text == "/clear" else failure)

        http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        paw = PawDecisions(config(tmp_path, [actor]), "synthetic", http=http)
        with pytest.raises(RuntimeError, match="qwenpaw_decision_unavailable"):
            await NpcPlanner(actor, None, paw_decisions=paw).decision("plan", MESSAGES, 3)
        await paw.close()
    asyncio.run(run())


def test_missing_reset_acknowledgement_prevents_model_request(tmp_path):
    async def run():
        actor = role(body_kind="maid")
        requests = []

        def respond(request):
            requests.append(json.loads(request.content)["input"][0]["content"][0]["text"])
            return httpx.Response(200, text=completed_plan())

        http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        paw = PawDecisions(config(tmp_path, [actor]), "synthetic", http=http)
        with pytest.raises(RuntimeError, match="qwenpaw_decision_unavailable"):
            await NpcPlanner(actor, None, paw_decisions=paw).decision("plan", MESSAGES, 3)
        assert requests == ["/clear"]
        await paw.close()
    asyncio.run(run())
