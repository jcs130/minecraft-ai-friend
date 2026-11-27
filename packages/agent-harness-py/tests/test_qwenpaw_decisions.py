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
            requests.append((request.headers["X-Agent-Id"], json.loads(request.content)))
            return httpx.Response(200, text=completed_plan(fenced=len(requests) == 2))

        http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        paw = PawDecisions(config(tmp_path, [maid, villager]), "synthetic", http=http)
        for actor in (maid, villager, maid):
            result, source = await NpcPlanner(actor, None, paw_decisions=paw).decision("plan", MESSAGES, 3)
            assert source == "qwenpaw" and json.loads(result["choices"][0]["message"]["content"]) == {"steps": []}
        assert requests[0] == requests[2] and requests[0][0] != requests[1][0]
        assert all(agent == payload["session_id"] for agent, payload in requests)
        assert not paw.supports(role(body_kind="numen", character_id=maid.character_id))
        await paw.close()
    asyncio.run(run())


@pytest.mark.parametrize("failure", [completed_plan().split('data: {"object": "response"')[0],
                                     stream({"error": "fixture"}), stream({"object": "response", "status": "failed"})])
def test_incomplete_paw_turn_cannot_propose_action_or_fall_back(tmp_path, failure):
    async def run():
        actor = role(body_kind="maid")
        http = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=failure)))
        paw = PawDecisions(config(tmp_path, [actor]), "synthetic", http=http)
        with pytest.raises(RuntimeError, match="qwenpaw_decision_unavailable"):
            await NpcPlanner(actor, None, paw_decisions=paw).decision("plan", MESSAGES, 3)
        await paw.close()
    asyncio.run(run())
