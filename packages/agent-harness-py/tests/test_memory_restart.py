import asyncio
from datetime import UTC, datetime, timedelta

from agent_mc_harness.memory.local import LocalMemory
from agent_mc_harness.memory.router import MemoryRouter
from agent_mc_harness.models import BodyEvent, BodyIdentity, Scope
from agent_mc_harness.memory.base import MemoryEpisode
import pytest


def test_restart_never_replaces_earlier_facts_and_body_resume_can_recall_them(tmp_path):
    async def run():
        scope = Scope(realm="server", account="owner", agent="kirito", character="verified-character")
        first = BodyIdentity(kind="maid", body_id="original-body", scope=scope)
        successor = BodyIdentity(kind="numen", body_id="new-body", scope=scope)
        path = tmp_path / "memory.sqlite"
        at = datetime.now(UTC)
        death = BodyEvent(kind="death", body_kind="maid", body_id=first.body_id, at=at, data={"eventId": "death-1"})
        memory = MemoryRouter(LocalMemory(path))
        await memory.observe(death, first)
        await memory.observe(death, first)
        assert len(memory.hot(first.group_id())) == 1
        await memory.close()
        memory = MemoryRouter(LocalMemory(path))
        await memory.observe(death.model_copy(update={"at": at + timedelta(hours=1)}), first)
        assert not memory.hot(successor.group_id())
        await memory.observe(BodyEvent(kind="respawn", body_kind="numen", body_id=successor.body_id,
                                      at=at + timedelta(hours=2), data={"eventId": "respawn-1"}), successor)
        rows = await memory.search(successor.group_id(), "", limit=10)
        await memory.close()
        assert [(r.provenance["sourceId"], r.valid_at) for r in rows] == [
            ("respawn-1", (at + timedelta(hours=2)).isoformat()), ("death-1", at.isoformat())]
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
