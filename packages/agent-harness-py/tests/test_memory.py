from __future__ import annotations

from typing import Any

from agent_mc_harness.memory import LocalMemory, MemoryEpisode, MemoryRouter
from agent_mc_harness.memory.base import episode_from_event, episode_from_receipt
from agent_mc_harness.models import ActionReceipt, BodyEvent, BodyIdentity, Scope, WorldRef


def ident(body: str, agent: str = "a", server: str = "s1") -> BodyIdentity:
    return BodyIdentity(kind="maid", body_id=body, world=WorldRef(server_id=server, world_key="w"), scope=Scope(realm="r", account="acc", agent=agent))


class DownGraph:
    extraction_ready = True

    def __init__(self) -> None:
        self.calls = 0

    async def add(self, *a: Any, **k: Any) -> dict[str, Any]:
        self.calls += 1
        raise ConnectionError("graphiti down")

    async def search(self, *a: Any, **k: Any) -> list[Any]:
        raise ConnectionError("graphiti down")

    async def close(self) -> None:
        return None


def test_group_ids_isolate_body_world_and_identity() -> None:
    a, b, c, d = ident("m1"), ident("m2"), ident("m1", agent="other"), ident("m1", server="s2")
    assert len({a.group_id(), b.group_id(), c.group_id(), d.group_id()}) == 4
    assert a.group_id() == ident("m1").group_id()
    dim = a.model_copy(update={"world": a.world.model_copy(update={"dimension": "nether"})})
    assert dim.group_id() == a.group_id(), "dimension is not a memory boundary"


def test_local_recall_is_partitioned_and_keeps_provenance(run: Any, tmp_path: Any) -> None:
    async def go() -> None:
        mem = MemoryRouter(LocalMemory(tmp_path / "m.sqlite"))
        g1, g2 = ident("m1").group_id(), ident("m2").group_id()
        await mem.add(g1, MemoryEpisode(id="e1", kind="chat", name="chat", body="主人说要去挖铁矿", provenance={"intentId": "in_1"}))
        await mem.add(g2, MemoryEpisode(id="e2", kind="chat", name="chat", body="另一个女仆的铁矿记忆"))
        hits = await mem.search(g1, "铁矿", 5)
        assert [h.data["id"] for h in hits] == ["e1"] and hits[0].provenance == {"intentId": "in_1"}
        assert [e.id for e in mem.hot(g1)] == ["e1"] and [e.id for e in mem.hot(g2)] == ["e2"]
        assert mem.status["tiers"]["warm"] == "local-fallback"
        await mem.close()
    run(go())


def test_graphiti_down_falls_back_to_local(run: Any) -> None:
    async def go() -> None:
        graph = DownGraph()
        mem = MemoryRouter(LocalMemory(), graph)
        g = ident("m1").group_id()
        out = await mem.add(g, MemoryEpisode(id="e1", kind="death", name="death", body="died in lava near the nether portal"))
        assert out["graphiti"] == {"error": "ConnectionError"} and out["local"]["stored"] == "local"
        hits = await mem.search(g, "lava", 3)
        assert hits and hits[0].source == "local" and mem.graph_errors == 2
    run(go())


def test_graphiti_source_description_carries_provenance() -> None:
    ep = MemoryEpisode(id="x", kind="reflection", name="r", body="b", provenance={"intentId": "in_9", "requestIds": ["hs_a", "hs_b"]})
    assert "intentId=in_9" in ep.graph_source() and "requestIds=hs_a,hs_b" in ep.graph_source()


def test_only_meaningful_events_become_episodes() -> None:
    i = ident("m1")
    for kind in ("position", "chat", "whisper", "dialogue", "combat", "player_join", "dimension", "action_result"):
        assert episode_from_event(BodyEvent(kind=kind, body_kind="maid", text="raw text", data={"eventId": "original"}), i) is None
    data = {"death": {"eventId": "death-verified", "maidId": "m1", "diedAt": "2026-11-21T03:00:00Z"}}
    event = BodyEvent(kind="death", body_kind="maid", body_id="m1", text="conversation accidentally attached", data=data)
    ep = episode_from_event(event, i)
    assert ep is not None and ep.body == "已确认原身体死亡。" and ep.provenance == {"sourceId": "death-verified"}
    assert ep.reference_time.isoformat() == "2026-11-21T03:00:00+00:00"
    assert episode_from_event(event.model_copy(update={"body_id": "other"}), i) is None
    assert episode_from_event(event.model_copy(update={"data": {}}), i) is None


def test_unverified_claimed_or_queued_actions_cannot_become_milestones() -> None:
    receipt = ActionReceipt(request_id="hs_original123", verb="native", status="completed", terminal=True, text="raw server message",
                            data={"adventure": {"effect": "confirmed", "kind": "turn_in_quest", "id": "vq_isaac"}})
    ep = episode_from_receipt(receipt)
    assert ep and ep.kind == "quest_completed" and "vq_isaac" in ep.body and receipt.text not in ep.body
    assert episode_from_receipt(receipt.model_copy(update={"terminal": False})) is None
    assert episode_from_receipt(receipt.model_copy(update={"status": "unknown"})) is None
    for effect in ("dispatched", "refused", "sent", "read"):
        altered = {"adventure": {**receipt.data["adventure"], "effect": effect}}
        assert episode_from_receipt(receipt.model_copy(update={"data": altered})) is None


def test_workshop_memory_requires_original_operation_and_verified_inventory_delta() -> None:
    detail = {"verified": True, "effectsApplied": True, "inventory": "backpack", "itemId": "minecraft:torch", "count": 4}
    row = {"goalCompleted": True, "status": "completed", "action": "make", "operationId": "hs_makeoriginal", "observation": detail}
    receipt = ActionReceipt(request_id="hs_makeoriginal", verb="craft", status="completed", terminal=True,
                            data={"maidAction": "make", "reply": {"data": row}})
    ep = episode_from_receipt(receipt)
    assert ep and ep.body == "工坊已确认制作 minecraft:torch × 4。"
    for altered in ({**row, "operationId": "hs_extra"}, {**row, "observation": {**detail, "verified": False}}):
        assert episode_from_receipt(receipt.model_copy(update={"data": {"maidAction": "make", "reply": {"data": altered}}})) is None
