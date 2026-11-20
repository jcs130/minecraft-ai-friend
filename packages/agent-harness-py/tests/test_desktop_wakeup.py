import asyncio
import json
import time
from uuid import uuid4

import httpx
import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.npc import DESKTOP_GOAL, NpcHost, NpcPlanner
from agent_mc_harness.resident_turns import ResidentTurnsClient
from simbody import SimBody
from test_server_npc import role


@pytest.mark.parametrize("body_kind", ["maid", "numen"])
@pytest.mark.parametrize("answered", [True, False])
def test_active_desktop_request_gets_real_scene_and_no_local_impersonation(run, tmp_path, body_kind, answered):
    async def test():
        actor = role(body_kind=body_kind)
        request = str(uuid4())
        wake = request
        class BoundBody(SimBody):
            def identity(self):
                result = super().identity()
                return result.model_copy(update={"kind": actor.body_kind,
                    "scope": result.scope.model_copy(update={"character": str(actor.character_id)})})
        body = BoundBody(body_id=str(actor.body_id))
        key = tmp_path / "worker"
        key.write_text("fixture")
        deliveries = []

        def api(req):
            nonlocal wake
            assert req.headers["Authorization"] == "Bearer fixture"
            data = json.loads(req.content)
            if req.url.path.endswith("/check"):
                assert data == {}
                return httpx.Response(200, json={"requestId": wake})
            assert req.url.path.endswith("/offer") and data["kind"] == "plan"
            assert data["scene"]["desktopRequestId"] == request
            assert data["scene"]["goal"] == DESKTOP_GOAL and data["scene"]["currentDialogue"] == []
            assert data["scene"]["observed"]["position"]["y"] == 64
            deliveries.append(data)
            wake = None
            answer = {"communication": {"mode": "native", "text": "这里是我的营地。"}}
            return httpx.Response(200, json={"state": "answered", "id": "turn-r", "answer": answer} if answered else {"state": "local"})

        turns = ResidentTurnsClient(actor, {"endpoint": "https://worker.example/api/v1/resident-turns/kirito", "tokenFile": key},
                                    http=httpx.AsyncClient(transport=httpx.MockTransport(api)))
        planner = NpcPlanner(actor, None, resident_turns=turns)
        host = NpcHost(actor, body, planner, None, ActionJournal(tmp_path / "actions.db"))
        host.next_plan = time.monotonic() + 600
        task = asyncio.create_task(host.run())
        try:
            async with asyncio.timeout(6):
                while not any(i.state == "completed" for i in host.runtime.intents.values()):
                    if task.done():
                        await task
                    await asyncio.sleep(.02)
            assert len(deliveries) == 1 and planner.last_route["provider"] == "desktop"
            assert [action.verb for action in body.acts] == (["chat"] if answered else [])
        finally:
            await host.close()
            await task
            await turns.close()
    run(test())
