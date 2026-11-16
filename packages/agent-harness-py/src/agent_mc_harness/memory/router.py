"""Layered memory router. Episode (``MemoryEpisode``) is the only input unit.

* Hot  - per-group in-process ring of the latest episodes (no I/O; what the planner sees first, bounded).
* Warm - Graphiti (bi-temporal facts: valid_at/invalid_at + created/expired) via the existing sidecar service,
         searched first when enabled and healthy.
* Cold - the local SQLite store: every episode is archived there (always written) and it is the lexical fallback
         when Graphiti is off or failing.
"""
from __future__ import annotations

import logging
from collections import deque
from datetime import datetime
from typing import Any

from ..models import BodyEvent, BodyIdentity
from .base import Fact, MemoryEpisode, MemoryStore, episode_from_event
from .local import LocalMemory

log = logging.getLogger("agent_mc_harness.memory")


class MemoryRouter:
    def __init__(self, local: MemoryStore, graph: Any = None, hot_size: int = 32) -> None:
        self.local, self.graph = local, graph
        self.hot_size = hot_size
        self._hot: dict[str, deque[MemoryEpisode]] = {}
        self.graph_errors = 0
        self._seq = 0

    @property
    def status(self) -> dict[str, Any]:
        return {"tiers": {"hot": sum(len(d) for d in self._hot.values()), "warm": "graphiti" if self.graph is not None else "local-fallback",
                          "cold": self.local.name}, "local": self.local.name, "graphiti": None if self.graph is None else
                {"extractionReady": getattr(self.graph, "extraction_ready", True), "errors": self.graph_errors}}

    async def add(self, group_id: str, episode: MemoryEpisode, hints: list[str] | None = None) -> dict[str, Any]:
        self._hot.setdefault(group_id, deque(maxlen=self.hot_size)).append(episode)
        out = {"local": await self.local.add(group_id, episode, hints)}
        if self.graph is not None and getattr(self.graph, "extraction_ready", True):
            try:
                out["graphiti"] = await self.graph.add(group_id, episode, hints)
            except Exception as error:  # Graphiti is optional; local remains the record
                self.graph_errors += 1
                log.warning("graphiti add failed: %s", type(error).__name__)
                out["graphiti"] = {"error": type(error).__name__}
        return out

    async def search(self, group_id: str, query: str, limit: int = 8, at: datetime | None = None) -> list[Fact]:
        facts: list[Fact] = []
        if self.graph is not None:
            try:
                facts = await self.graph.search(group_id, query, limit, at)
            except Exception as error:
                self.graph_errors += 1
                log.warning("graphiti search failed: %s", type(error).__name__)
        if len(facts) < limit:
            seen = {f.fact for f in facts}
            facts += [f for f in await self.local.search(group_id, query, limit, at) if f.fact not in seen]
        return facts[:limit]

    def hot(self, group_id: str, limit: int = 8) -> list[MemoryEpisode]:
        """Hot tier: newest first, never crosses group_id."""
        return list(self._hot.get(group_id, ()))[-limit:][::-1]

    async def observe(self, event: BodyEvent, identity: BodyIdentity) -> dict[str, Any] | None:
        self._seq += 1
        episode = episode_from_event(event, identity, self._seq)
        return None if episode is None else await self.add(identity.group_id(), episode)

    async def close(self) -> None:
        await self.local.close()
        if self.graph is not None:
            await self.graph.close()


def open_memory(backend: str | None, *, local_path: str = ":memory:", env: dict[str, str] | None = None) -> MemoryRouter | None:
    """backend: off (default) | local | graphiti (graphiti + local fallback)."""
    if backend in (None, "", "off"):
        return None
    local = LocalMemory(local_path)
    if backend == "local":
        return MemoryRouter(local)
    if backend == "graphiti":
        from .graphiti import GraphitiMemory
        return MemoryRouter(local, GraphitiMemory(env=env))
    raise ValueError("memory backend must be off|local|graphiti")
