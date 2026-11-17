"""Memory access point. One partition (``group_id``) per body kind + server + world + body + agent scope."""
from __future__ import annotations

import re
import hashlib
import json
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field

from ..models import BodyEvent, BodyIdentity, utcnow

GROUP_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")  # same rule as the graphiti sidecar
REMEMBER = {"chat", "whisper", "dialogue", "death", "respawn", "dimension", "player_join", "player_leave", "action_result", "combat"}


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


def episode_from_event(event: BodyEvent, identity: BodyIdentity, seq: int) -> MemoryEpisode | None:
    """Only meaningful perception becomes memory; text is the body's own wording, attributed, never instructions."""
    if event.kind not in REMEMBER or not event.text.strip():
        return None
    speaker = event.data.get("speaker") or event.data.get("speakerId")
    who = f"{speaker}: " if speaker else ""
    where = f" [{identity.world.dimension}]" if identity.world.dimension else ""
    # A process-local counter repeats after restart and used to overwrite older SQLite rows.
    # Prefer the original event ID; otherwise the observation time and payload identify the event.
    source_id = event.data.get("eventId") or event.data.get("event_id")
    material = [identity.body_id, event.kind, source_id] if source_id else [
        identity.body_id, event.kind, event.at.isoformat(), event.request_id, speaker, event.text]
    event_id = hashlib.sha256(json.dumps(material, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return MemoryEpisode(id=f"event-{event_id}", kind=event.kind, name=f"{event.kind}{where}",
                         body=f"{who}{event.text}"[:20_000], source_description=f"{identity.kind} body {identity.name or identity.body_id}",
                         reference_time=event.at, actors=[a for a in (identity.name, speaker) if a])
