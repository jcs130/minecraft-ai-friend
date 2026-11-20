import asyncio
import json
from uuid import uuid4

import pytest

from agent_mc_harness import npc_service
from test_hosted_mcp import BODY, OWNER
from test_hosted_stop import LeaseSession
from test_server_npc import role


@pytest.mark.parametrize("failure", ["transport", "external-fence", "initial-denied", "maintenance"])
def test_configured_numen_role_through_service_supervisor(tmp_path, monkeypatch, run, failure):
    """Use serve()'s real build/rebuild, state files, startup gates and role selection."""
    kirito = role(body_id=BODY, owner_id=OWNER)

    def config(name, data):
        path = tmp_path / name
        path.write_text(json.dumps(data), encoding="utf8")
        return str(path)

    pause_file = tmp_path / "maintenance"
    service_file = config("service.json", {
        "schema": 1, "serverId": "isolation", "stateDirectory": str(tmp_path / "state"),
        "pauseFile": str(pause_file),
        "rolesFile": config("roles.json", {"schema": 1, "roles": [kirito.model_dump(mode="json")]}),
        "providers": {"tokenplan": config("fixture.json", {"apiKey": "offline", "baseUrl": "http://127.0.0.1:1/v1"})},
        "bodies": {"kirito": {"controllerId": str(uuid4()), "name": "Kirito", "endpoint": "http://127.0.0.1:1/mcp"}},
    })

    async def scenario():
        started, supervisor_ticks = [], 0
        first, second, observed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        real_sleep = asyncio.sleep

        async def accelerate_timer(seconds):
            nonlocal supervisor_ticks
            # The service polls every 2 seconds and backs off for 15 before reopening.
            if seconds == 2 and first.is_set():
                supervisor_ticks += 1
                if supervisor_ticks >= 6:
                    observed.set()
            await real_sleep(.002)

        async def simulated_actor(host):
            p = host.body.port
            started.append((p.body, p.boot, host.journal.db.execute("PRAGMA database_list").fetchone()[2]))
            if len(started) == 1:
                first.set()
                if failure == "initial-denied":
                    session = LeaseSession()
                    session.boot, session.mode, session.epoch, session.fenced = "other-driver", "manual", 1, True
                    p.session = session
                    await p.open()
                p.lost = True
                if failure == "external-fence":
                    # Even if the actor subsequently exits, this loss has no reconnect signal.
                    raise RuntimeError("CONTROL_CHANGED")
                if failure == "maintenance":
                    pause_file.touch()
                p.disconnected.set()
            else:
                second.set()
            await asyncio.Future()

        monkeypatch.setattr(asyncio, "sleep", accelerate_timer)
        monkeypatch.setattr(npc_service.NpcHost, "run", simulated_actor)
        service = asyncio.create_task(npc_service.serve(service_file))
        try:
            await asyncio.wait_for(first.wait(), 3)
            if failure == "transport":
                await asyncio.wait_for(second.wait(), 1)
                assert len(started) == 2
                assert started[0][0] == started[1][0] == str(kirito.body_id)
                assert started[0][1] != started[1][1] and started[0][2] == started[1][2]
            elif failure in {"external-fence", "initial-denied"}:
                await asyncio.wait_for(observed.wait(), 1)
                assert len(started) == 1
            else:
                await asyncio.wait_for(asyncio.shield(service), 1)
                assert len(started) == 1
        finally:
            if not service.done():
                service.cancel()
            await asyncio.gather(service, return_exceptions=True)

    run(scenario())
