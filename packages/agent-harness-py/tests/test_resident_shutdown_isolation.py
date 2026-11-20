import asyncio
import json
from uuid import uuid4

import pytest

from agent_mc_harness import npc_service
from test_server_npc import role


@pytest.mark.parametrize("close_mode", ["slow", "raises"])
def test_failed_resident_retirement_keeps_other_residents_and_health_running(tmp_path, monkeypatch, run, close_mode):
    identities = []
    for name in ("first", "second", "third"):
        identity = uuid4()
        identities.append(role(id=name, name=name, body_kind="maid", character_id=identity,
                               body_id=identity, allowed_tools=["body:observe"]))

    def write(name, data):
        target = tmp_path / name
        target.write_text(json.dumps(data), encoding="utf-8")
        return str(target)

    token = tmp_path / "token"
    token.write_text("offline", encoding="utf-8")
    path = write("service.json", {
        "schema": 1, "serverId": "isolated-shutdown",
        "stateDirectory": str(tmp_path / "state"),
        "rolesFile": write("roles.json", {"schema": 1, "roles": [r.model_dump(mode="json") for r in identities]}),
        "providers": {"tokenplan": write("provider.json", {"baseUrl": "http://127.0.0.1:1/v1", "apiKey": "offline"})},
        "bodies": {r.id: {"controllerId": str(uuid4()), "endpoint": "http://127.0.0.1:1/maid-body",
                          "tokenFile": str(token)} for r in identities},
    })

    async def scenario():
        close_started, allow_close = asyncio.Event(), asyncio.Event()
        completed_initial_step = asyncio.Event()
        started = []
        healthy_steps = {"second": 0, "third": 0}
        original_close = npc_service.NpcHost.close
        original_sleep = asyncio.sleep

        async def faster_sleep(seconds):
            await original_sleep(.003 if seconds == 2 else seconds)

        async def actor(host):
            started.append(host.role.id)
            if host.role.id == "first":
                await completed_initial_step.wait()
                raise ConnectionError("fixture_actor_disconnect")
            while True:
                healthy_steps[host.role.id] += 1
                await original_sleep(.001)

        async def close(host):
            if host.role.id == "first":
                close_started.set()
                if close_mode == "raises":
                    raise OSError("fixture_cleanup_error")
                await allow_close.wait()
            await original_close(host)

        def publish_health(self, status):
            states.append({r["id"]: r for r in status["roles"]})

        states = []
        monkeypatch.setattr(asyncio, "sleep", faster_sleep)
        monkeypatch.setattr(npc_service.NpcHost, "run", actor)
        monkeypatch.setattr(npc_service.NpcHost, "close", close)
        monkeypatch.setattr(npc_service.StatusFile, "publish", publish_health)
        service = asyncio.create_task(npc_service.serve(path))
        try:
            async with asyncio.timeout(4):
                while len(started) != 3 or not states:
                    if service.done():
                        service.result()
                    await original_sleep(.005)
                completed_initial_step.set()
                await close_started.wait()
                before = len(states)
                steps_before = dict(healthy_steps)
                while len(states) <= before + 2:
                    assert not service.done(), "cleanup of one resident stopped the other two"
                    await original_sleep(.005)
            status = states[-1]
            assert status["second"]["running"] and status["third"]["running"]
            assert not status["first"]["running"]
            assert status["first"]["unknownRequests"] == 0
            assert all(healthy_steps[actor_id] > count for actor_id, count in steps_before.items())
            if close_mode == "raises":
                assert status["first"]["error"] == "close_OSError"
                assert status["first"]["controlMode"] == "close_failed"
            else:
                assert status["first"]["controlMode"] == "closing"
            assert started.count("first") == 1
        finally:
            allow_close.set()
            service.cancel()
            await asyncio.gather(service, return_exceptions=True)

    run(scenario())
