"""Graphiti, in-process, through the EXISTING sidecar service class (packages/agent-memory/graphiti-sidecar).

``agent_memory_sidecar.service.GraphitiService`` already carries the Minecraft entity types, the relation guide, the
Kuzu ``_database``/FTS compatibility shims for graphiti-core 0.31.x, the local HashEmbedder and the point-in-time
search filters. We call it directly instead of over HTTP, and pass our own group_id per body/world/identity.
Configuration is the sidecar's (``load_settings()``: AGENT_MEMORY_GRAPH_DRIVER, AGENT_MEMORY_KUZU_PATH,
AGENT_MEMORY_LLM_MODEL, AGENT_MEMORY_LLM_API_KEY_ENV = *name* of the key variable, ...).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from .._reuse import graphiti_sidecar
from .base import Fact, MemoryEpisode, check_group


class GraphitiMemory:
    name = "graphiti"

    def __init__(self, service: Any = None, env: dict[str, str] | None = None) -> None:
        service_mod, config_mod = graphiti_sidecar()
        self._episode_in = service_mod.EpisodeIn
        self.settings = getattr(service, "settings", None) or config_mod.load_settings(env)
        self.service = service if service is not None else service_mod.GraphitiService(self.settings)

    @property
    def extraction_ready(self) -> bool:
        """Graphiti needs an LLM for entity/edge extraction; without one add() raises and the router keeps local."""
        llm = getattr(self.settings, "llm", None)
        return bool(getattr(llm, "configured", False))

    async def health(self) -> dict[str, Any]:
        return dict(await self.service.health())

    async def add(self, group_id: str, episode: MemoryEpisode, hints: list[str] | None = None) -> dict[str, Any]:
        check_group(group_id)
        payload = self._episode_in(**episode.model_dump(exclude={"provenance"}) | {"source_description": episode.graph_source()})
        return dict(await self.service.add_episode(group_id, payload, hints or []))

    async def search(self, group_id: str, query: str, limit: int = 8, at: datetime | None = None) -> list[Fact]:
        check_group(group_id)
        rows = await self.service.search(group_id, query, limit, at, None, False)
        return [Fact(fact=r["fact"], source="graphiti", valid_at=r.get("valid_at"), invalid_at=r.get("invalid_at"),
                     score=1.0 - i / max(len(rows), 1), data={"name": r.get("name"), "source": r.get("source"), "target": r.get("target")})
                for i, r in enumerate(rows)]

    async def close(self) -> None:
        await self.service.close()
