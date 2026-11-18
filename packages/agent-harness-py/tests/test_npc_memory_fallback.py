import asyncio
import json
from datetime import UTC, datetime

import pytest

from agent_mc_harness.memory.base import MemoryEpisode
from agent_mc_harness.npc_service import graph_connection, open_role_memory, serve


def test_local_role_can_reopen_its_existing_archive_without_a_graph_token(tmp_path):
    async def exercise():
        state = tmp_path / "role"
        episode = MemoryEpisode(id="visit-1", kind="chat", name="visit", body="在北岸见过码头",
                                reference_time=datetime(2026, 11, 18, tzinfo=UTC))
        local = open_role_memory(state, None)
        await local.add("resident", episode)
        await local.close()
        token = tmp_path / "role.token"
        token.write_text("fixture")
        remote = open_role_memory(state, graph_connection({"endpoint": "http://127.0.0.1:8765", "tokenFile": str(token)}))
        assert remote.status["tiers"]["warm"] == "graphiti"
        assert await remote.local.search("resident", "码头")
        await remote.close()
        token.unlink()
        local = open_role_memory(state, graph_connection({"mode": "local", "tokenFile": str(token)}))
        try:
            assert local.status["tiers"]["warm"] == "local-fallback"
            assert len(await local.search("resident", "码头")) == 1
            assert not await local.search("other-role", "码头")
        finally:
            await local.close()
        with pytest.raises(FileNotFoundError):
            graph_connection({"endpoint": "http://127.0.0.1:8765", "tokenFile": str(token)})
        with pytest.raises(ValueError, match="npc_memory_mode"):
            graph_connection({"mode": "typo"})
    asyncio.run(exercise())


def test_server_uses_local_social_journal_without_graph_configuration(tmp_path):
    state = tmp_path / "state"
    world = tmp_path / "world"
    world.mkdir()
    (tmp_path / "roles.json").write_text('{"schema":1,"roles":[]}')
    (tmp_path / "provider.json").write_text('{"baseUrl":"http://127.0.0.1:9","apiKey":"fixture"}')
    pause = tmp_path / "pause"
    pause.touch()
    config = tmp_path / "service.json"
    config.write_text(json.dumps({"schema": 1, "serverId": "fixture", "rolesFile": str(tmp_path / "roles.json"),
                                 "stateDirectory": str(state), "relationshipDataPath": str(world), "pauseFile": str(pause),
                                 "providers": {"tokenplan": str(tmp_path / "provider.json")}}))
    asyncio.run(serve(config))
    assert json.loads((state / "health.json").read_text())["pausing"]
    assert not (state / "social-graph-outbox.sqlite3").exists()
