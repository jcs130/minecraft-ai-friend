"""Selective character memory. Durable facts require a stable scope and original evidence."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field

from ..models import ActionReceipt, BodyEvent, BodyIdentity, utcnow

GROUP_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")  # same rule as the graphiti sidecar
_SOURCE_ID = re.compile(r"[A-Za-z0-9_.:~/-]{1,200}\Z")
_SUBJECT = re.compile(r"[a-z0-9][a-z0-9_./:-]{0,159}\Z")
_LIFE = {
    "death": ("death", "diedAt", "已确认原身体死亡。"),
    "respawn": ("recovery", "observedAt", "再次观察到原身体存活。"),
}
_ADVENTURE = {
    "accept_quest": ("quest_accepted", "已确认接取公会委托"),
    "turn_in_quest": ("quest_completed", "已确认交付公会委托"),
    "claim_ruin": ("ruin_claimed", "已确认领取遗迹奖励"),
}


class MemoryEpisode(BaseModel):
    id: str
    kind: str
    name: str
    body: str = Field(max_length=20_000)
    source_description: str = "minecraft"
    reference_time: datetime = Field(default_factory=utcnow)
    actors: list[str] = Field(default_factory=list)
    # Where this came from: {"intentId", "requestIds", "episodes", "trigger", ...}. Graphiti gets it inside
    # source_description (its EpisodeIn has no extra fields); the local store keeps it as JSON.
    provenance: dict[str, Any] = Field(default_factory=dict)

    def graph_source(self) -> str:
        if not self.provenance:
            return self.source_description
        refs = ";".join(f"{k}={v if isinstance(v, str) else ','.join(map(str, v)) if isinstance(v, list) else v}"
                        for k, v in sorted(self.provenance.items()))
        return f"{self.source_description} | provenance: {refs}"[:500]


class Fact(BaseModel):
    fact: str
    source: str  # "graphiti" | "local"
    valid_at: str | None = None
    invalid_at: str | None = None
    score: float = 0.0
    data: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, Any] = Field(default_factory=dict)


class MemoryStore(Protocol):
    name: str

    async def add(self, group_id: str, episode: MemoryEpisode, hints: list[str] | None = None) -> dict[str, Any]: ...
    async def search(self, group_id: str, query: str, limit: int = 8, at: datetime | None = None) -> list[Fact]: ...
    async def close(self) -> None: ...


def check_group(group_id: str) -> str:
    if not GROUP_ID.match(group_id):
        raise ValueError("group_id must be 1-64 chars of [A-Za-z0-9_-]")
    return group_id


def reference(value: Any, pattern: re.Pattern[str] = _SOURCE_ID) -> str | None:
    return value if isinstance(value, str) and pattern.fullmatch(value) else None


def significant_episode(kind: str, text: str, source: str, original_id: str, observed: datetime) -> MemoryEpisode:
    """Use the original idempotence key, independent of transport and polling time."""
    digest = hashlib.sha256(json.dumps([source, kind, original_id], separators=(",", ":")).encode()).hexdigest()
    return MemoryEpisode(id=f"fact-{digest}", kind=kind, name=kind, body=text, source_description=source,
                         reference_time=observed, provenance={"sourceId": original_id})


def episode_from_event(event: BodyEvent, identity: BodyIdentity, seq: int | None = None) -> MemoryEpisode | None:
    """Capture life transitions only; chat and telemetry belong to the live turn and receipt journal."""
    if (event.kind not in _LIFE or event.body_kind != identity.kind or event.body_id not in (None, identity.body_id)
            or event.data.get("channel") in ("private", "party", "team")):
        return None
    key, at_key, summary = _LIFE[event.kind]
    raw = event.data.get(key)
    evidence = raw if isinstance(raw, dict) else {}
    # A death snapshot and a following notification can carry the same server event.
    if evidence.get("maidId", identity.body_id) != identity.body_id or (
            identity.owner_id and evidence.get("ownerId", identity.owner_id) != identity.owner_id):
        return None
    source_id = reference(evidence.get("eventId") or event.data.get("eventId") or event.data.get("event_id"))
    if not source_id:
        return None
    observed = event.at
    if isinstance(at := evidence.get(at_key), str):
        try:
            value = datetime.fromisoformat(at)
            if value.tzinfo is not None:
                observed = value.astimezone(UTC)
        except ValueError:
            pass
    return significant_episode(event.kind, summary, f"{identity.kind}:{identity.body_id}:life", source_id, observed)


def episode_from_receipt(receipt: ActionReceipt, observed: datetime | None = None) -> MemoryEpisode | None:
    """Retain a small set of server-confirmed effects, never prose or queued/rejected actions."""
    if receipt.status != "completed" or not receipt.terminal or not isinstance(receipt.data, dict):
        return None
    observed = observed or utcnow()
    data = receipt.data
    if isinstance(effect := data.get("adventure"), dict) and effect.get("effect") == "confirmed":
        if (milestone := _ADVENTURE.get(reference(effect.get("kind")) or "")) and (subject := reference(effect.get("id"), _SUBJECT)):
            return significant_episode(milestone[0], f"{milestone[1]} {subject}。", "adventure_receipt",
                                       receipt.request_id, observed)
    if data.get("maidAction") != "make" or not isinstance(reply := data.get("reply"), dict):
        return None
    row = reply.get("data")
    if (not isinstance(row, dict) or row.get("operationId") != receipt.request_id or row.get("status") != "completed"
            or row.get("action") != "make" or row.get("goalCompleted") is not True):
        return None
    detail = row.get("observation")
    if not isinstance(detail, dict) or detail.get("verified") is not True or detail.get("effectsApplied") is not True:
        return None
    item, count = reference(detail.get("itemId"), _SUBJECT), detail.get("count")
    if not item or type(count) is not int or count < 1 or detail.get("inventory") not in ("chest", "backpack"):
        return None
    return significant_episode("craft_completed", f"工坊已确认制作 {item} × {count}。", "workshop_receipt", receipt.request_id, observed)


def village_commission_memory(commission_id: str, observed: datetime) -> MemoryEpisode:
    if not reference(commission_id, _SUBJECT):
        raise ValueError("invalid_commission_memory_id")
    return significant_episode("quest_completed", f"这名玩家已完成你发布的公会委托 {commission_id}。", "village_board", commission_id, observed)
