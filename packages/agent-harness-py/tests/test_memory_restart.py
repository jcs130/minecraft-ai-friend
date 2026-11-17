import asyncio
from datetime import UTC, datetime, timedelta

from agent_mc_harness.memory.local import LocalMemory
from agent_mc_harness.memory.router import MemoryRouter
from agent_mc_harness.models import BodyEvent, BodyIdentity, Scope
from agent_mc_harness.memory.base import MemoryEpisode
import pytest


def test_restart_never_replaces_an_earlier_observation(tmp_path):
    async def run():
        identity = BodyIdentity(kind="maid", body_id="original-body", scope=Scope(realm="server", account="owner", agent="kirito"))
        path = tmp_path / "memory.sqlite"
        at = datetime.now(UTC)
        for index, text in enumerate(("桐人救援伙伴甲", "桐人发现矿坑乙")):
            memory = MemoryRouter(LocalMemory(path))
            await memory.observe(BodyEvent(kind="dialogue", body_kind="maid", body_id="original-body", text=text,
                                          at=at + timedelta(seconds=index)), identity)
            await memory.close()
        memory = LocalMemory(path)
        rows = await memory.search(identity.group_id(), "桐人", limit=10)
        await memory.close()
        assert {r.fact for r in rows} == {"桐人救援伙伴甲", "桐人发现矿坑乙"}
    asyncio.run(run())


def test_only_explicit_character_mapping_survives_body_migration():
    scope = Scope(realm="server", account="operator", agent="kirito", character="original-kirito-uuid")
    maid = BodyIdentity(kind="maid", body_id="old-body", scope=scope)
    numen = BodyIdentity(kind="numen", body_id="new-body", scope=scope)
    assert maid.group_id() == numen.group_id()
    other = numen.model_copy(update={"scope": scope.model_copy(update={"account": "other-owner"})})
    assert other.group_id() != numen.group_id()
    old_scope = scope.model_copy(update={"character": None})
    assert maid.model_copy(update={"scope": old_scope}).group_id() != numen.model_copy(update={"scope": old_scope}).group_id()
def test_duplicate_delivery_keeps_event_time_and_rejects_changed_content(tmp_path):
    async def run():
        path = tmp_path / 'memory.sqlite3'
        memory = LocalMemory(path)
        at = datetime(2026, 11, 17, tzinfo=UTC)
        episode = MemoryEpisode(id='original-event', kind='chat', name='conversation', body='结衣在治疗桐人', reference_time=at)
        await memory.add('kirito', episode)
        await memory.close()
        memory = LocalMemory(path)
        await memory.add('kirito', episode.model_copy(update={'reference_time': at + timedelta(days=1)}))
        rows = await memory.search('kirito', '结衣')
        assert len(rows) == 1 and rows[0].valid_at == at.isoformat()
        assert not await memory.search('feiyu', '结衣')
        with pytest.raises(ValueError, match='memory_episode_id_conflict'):
            await memory.add('kirito', episode.model_copy(update={'body': 'different event'}))
        await memory.close()
    asyncio.run(run())
