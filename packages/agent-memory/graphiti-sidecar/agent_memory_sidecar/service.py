"""Thin service around graphiti-core. All Graphiti specifics live here so app.py stays testable with a fake."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sqlite3
import uuid
from types import SimpleNamespace
from datetime import datetime, timezone
from typing import Any, Protocol

from pydantic import BaseModel, Field

from .config import Settings

os.environ.setdefault("GRAPHITI_TELEMETRY_ENABLED", "false")

RELATION_GUIDE = (
    "This is long-term memory for a Minecraft agent. Entities are players, the agent itself, places (named homes, "
    "bases, coordinates qualified by world key such as minecraft:overworld), buildings, items, skills and tasks. "
    "Name relations in UPPER_SNAKE_CASE and prefer: KNOWS, FRIENDS_WITH, LIKES, DISLIKES, HOME_AT, LOCATED_AT, "
    "BUILT_AT, OWNS, LEARNED, HAS_LEVEL, PARTICIPATED_IN, DIED_AT. A player's home moving to new coordinates "
    "contradicts the old home. Keep coordinates verbatim. Ignore greetings and small talk."
)


# Entity types give Graphiti labels that the TS client maps back (Player, Location, ...).
class Player(BaseModel):
    """A Minecraft player account (not the agent itself)."""


class Agent(BaseModel):
    """The AI agent's own Minecraft body."""


class Location(BaseModel):
    """A place in a specific Minecraft world: a named home/base or coordinates."""


class Building(BaseModel):
    """A structure built in the world."""


class Item(BaseModel):
    """A Minecraft item or block type."""


class Skill(BaseModel):
    """A skill, RPG level track or learned method."""


class Task(BaseModel):
    """A task, quest or commission the agent works on."""


ENTITY_TYPES: dict[str, type[BaseModel]] = {
    "Player": Player, "Agent": Agent, "Location": Location, "Building": Building,
    "Item": Item, "Skill": Skill, "Task": Task,
}


class EpisodeIn(BaseModel):
    id: str
    kind: str
    name: str
    body: str = Field(max_length=20_000)
    source_description: str = "minecraft"
    reference_time: datetime
    actors: list[str] = []


class GraphService(Protocol):
    async def health(self) -> dict[str, Any]: ...
    async def add_episode(self, group_id: str, episode: EpisodeIn, hints: list[str]) -> dict[str, Any]: ...
    async def search(self, group_id: str, query: str, limit: int, at: datetime | None, known_at: datetime | None,
                     history: bool) -> list[dict[str, Any]]: ...
    async def close(self) -> None: ...


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class GraphitiService:
    """Real Graphiti. Requires an LLM for extraction; embedder may be the local hash embedder."""

    def __init__(self, settings: Settings):
        from graphiti_core import Graphiti
        from graphiti_core.cross_encoder.client import CrossEncoderClient
        from graphiti_core.llm_client.config import LLMConfig
        from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

        from .embedder import HashEmbedder

        class PassthroughReranker(CrossEncoderClient):
            """Keeps Graphiti's RRF order; avoids requiring an OpenAI reranker key."""

            async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
                n = len(passages)
                return [(p, 1.0 - i / max(n, 1)) for i, p in enumerate(passages)]

        self.settings = settings
        if settings.driver == "kuzu":
            import warnings

            from graphiti_core.driver.kuzu_driver import KuzuDriver
            os.makedirs(os.path.dirname(os.path.abspath(settings.kuzu_path)), exist_ok=True)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                driver = KuzuDriver(db=settings.kuzu_path)
            # Compatibility shim for graphiti-core 0.31.x's (deprecated) Kuzu driver: it never sets `_database`,
            # which Graphiti._resolve_request_scope reads. Kuzu has one database; group isolation is by group_id.
            if not hasattr(driver, "_database"):
                driver._database = ""  # type: ignore[attr-defined]
        else:
            from graphiti_core.driver.falkordb_driver import FalkorDriver
            class ScopedFalkorDriver(FalkorDriver):
                """Reuse graph-scoped drivers; drain their index tasks before closing the shared client."""
                def __init__(self, **kwargs):
                    super().__init__(**kwargs)
                    self.scopes = {}

                def clone(self, database):
                    if database == self._database:
                        return self
                    if database not in self.scopes:
                        self.scopes[database] = super().clone(database)
                    return self.scopes[database]

                async def close(self):
                    tasks = [d._init_task for d in self.scopes.values() if d._init_task is not None]
                    if tasks:
                        await asyncio.gather(*tasks, return_exceptions=True)
                    await super().close()
            driver = ScopedFalkorDriver(host=settings.falkordb_host, port=settings.falkordb_port)

        llm = settings.llm
        api_key = os.environ.get(llm.api_key_env)
        from openai import AsyncOpenAI
        class BoundedCompletionClient:
            def __init__(self):
                self.transport = AsyncOpenAI(api_key=api_key, base_url=llm.base_url, timeout=25, max_retries=0)
                self.chat = SimpleNamespace(completions=self)

            async def create(self, **kwargs):
                kwargs["max_tokens"] = min(kwargs.get("max_tokens", 4096), 4096)
                if str(kwargs.get("model", "")).lower().startswith("qwen"):
                    kwargs["extra_body"] = {"enable_thinking": False}
                return await self.transport.chat.completions.create(**kwargs)

        self._completion = BoundedCompletionClient()
        llm_client = OpenAIGenericClient(
            config=LLMConfig(api_key=api_key, model=llm.model, small_model=llm.small_model or llm.model,
                             base_url=llm.base_url),
            structured_output_mode=llm.structured_output,  # type: ignore[arg-type]
            client=self._completion, max_tokens=4096,
        )
        emb = settings.embedder
        if emb.kind == "hash":
            embedder = HashEmbedder(emb.dim)
        else:
            from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
            embedder = OpenAIEmbedder(OpenAIEmbedderConfig(api_key=os.environ.get(emb.api_key_env),
                                                           embedding_model=emb.model or "text-embedding-3-small",
                                                           embedding_dim=emb.dim, base_url=emb.base_url))
        self.graphiti = Graphiti(graph_driver=driver, llm_client=llm_client, embedder=embedder,
                                 cross_encoder=PassthroughReranker(), max_coroutines=4)
        self._ready = False
        path = settings.extra.get("receipts", os.path.join(".data", "graphiti-receipts.sqlite3"))
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._receipts = sqlite3.connect(path)
        self._receipts.execute("PRAGMA journal_mode=WAL")
        self._receipts.execute("PRAGMA synchronous=FULL")
        self._receipts.execute("CREATE TABLE IF NOT EXISTS episodes (scope TEXT, id TEXT, digest TEXT NOT NULL, result TEXT, PRIMARY KEY(scope,id))")
        self._receipts.commit()
        self._extract_lock = asyncio.Lock()

    async def _ensure(self) -> None:
        if not self._ready:
            await self.graphiti.build_indices_and_constraints()
            if self.settings.driver == "kuzu":
                await self._kuzu_fulltext()
            self._ready = True

    async def _kuzu_fulltext(self) -> None:
        """graphiti-core 0.31.x's Kuzu build_indices_and_constraints is a no-op and its schema omits the FTS
        indexes that its own search queries use. Create them (idempotently) with the bundled fts extension."""
        import logging

        from graphiti_core.driver.driver import GraphProvider
        from graphiti_core.graph_queries import get_fulltext_indices
        for query in ["LOAD EXTENSION fts;", *get_fulltext_indices(GraphProvider.KUZU)]:
            try:
                await self.graphiti.driver.execute_query(query)
            except Exception as error:  # noqa: BLE001
                if "already exists" not in str(error).lower():
                    logging.getLogger("agent_memory_sidecar").warning("kuzu fts setup: %s", str(error)[:200])

    async def health(self) -> dict[str, Any]:
        await self._ensure()
        s = self.settings
        return {"ok": True, "driver": s.driver, "llm": s.llm.describe(), "embedder": s.embedder.describe(),
                "llm_configured": s.llm.configured}

    async def add_episode(self, group_id: str, episode: EpisodeIn, hints: list[str]) -> dict[str, Any]:
        # One extraction writer also bounds model/CPU pressure. An identical delivery
        # after a lost HTTP response returns the durable receipt without another LLM call.
        digest = hashlib.sha256(json.dumps({"episode": episode.model_dump(mode="json"), "hints": hints},
                                          ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        async with self._extract_lock:
            old = self._receipts.execute("SELECT digest,result FROM episodes WHERE scope=? AND id=?", (group_id, episode.id)).fetchone()
            if old:
                if old[0] != digest:
                    raise ValueError("episode_id_conflict")
                if old[1] is not None:
                    return json.loads(old[1])
            else:
                with self._receipts:
                    self._receipts.execute("INSERT INTO episodes(scope,id,digest) VALUES (?,?,?)", (group_id, episode.id, digest))
            # Extraction is offline enrichment. A stalled provider must release
            # the single writer so other roles and retries can make progress.
            result = await asyncio.wait_for(self._extract_episode(group_id, episode, hints), 100)
            with self._receipts:
                self._receipts.execute("UPDATE episodes SET result=? WHERE scope=? AND id=?", (json.dumps(result), group_id, episode.id))
            return result

    async def _extract_episode(self, group_id: str, episode: EpisodeIn, hints: list[str]) -> dict[str, Any]:
        from graphiti_core.nodes import EpisodeType, EpisodicNode
        from graphiti_core.errors import NodeNotFoundError
        await self._ensure()
        if not self.settings.llm.configured:
            raise RuntimeError("LLM not configured: set AGENT_MEMORY_LLM_MODEL and the key env named by AGENT_MEMORY_LLM_API_KEY_ENV")
        instructions = RELATION_GUIDE + ("\nRule-extracted hints (may be incomplete):\n- " + "\n- ".join(hints[:20]) if hints else "")
        episode_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"agent-mc-memory/{group_id}/{episode.id}"))
        source = EpisodeType.message if episode.kind in ("chat", "whisper") else EpisodeType.text
        # In Graphiti 0.31, uuid selects an EXISTING episode. Create its raw node
        # first, in the same request-scoped graph, so interrupted retries keep identity.
        _, driver, _ = self.graphiti._resolve_request_scope(group_id)
        try:
            await EpisodicNode.get_by_uuid(driver, episode_uuid)
        except NodeNotFoundError:
            await EpisodicNode(uuid=episode_uuid, name=episode.name, group_id=group_id,
                               source=source, content=episode.body, source_description=episode.source_description,
                               created_at=datetime.now(timezone.utc), valid_at=episode.reference_time).save(driver)
        result = await self.graphiti.add_episode(
            name=episode.name, episode_body=episode.body, source_description=episode.source_description,
            uuid=episode_uuid,
            reference_time=episode.reference_time, source=source,
            group_id=group_id, entity_types=ENTITY_TYPES, custom_extraction_instructions=instructions,
        )
        nodes = {n.uuid: n for n in result.nodes}
        edges = await self._render(result.edges, nodes, driver)
        return {
            "episode_uuid": result.episode.uuid,
            "edges": [e for e in edges if e["invalid_at"] is None and e["expired_at"] is None],
            "invalidated": [e for e in edges if e["invalid_at"] is not None or e["expired_at"] is not None],
        }

    async def search(self, group_id: str, query: str, limit: int, at: datetime | None, known_at: datetime | None,
                     history: bool) -> list[dict[str, Any]]:
        from graphiti_core.search.search_filters import ComparisonOperator as Op
        from graphiti_core.search.search_filters import DateFilter, SearchFilters
        await self._ensure()
        f = SearchFilters()
        if not history:
            if at is None:
                f.invalid_at = [[DateFilter(comparison_operator=Op.is_null)]]
                f.expired_at = [[DateFilter(comparison_operator=Op.is_null)]]
            else:
                f.valid_at = [[DateFilter(date=at, comparison_operator=Op.less_than_equal)]]
                f.invalid_at = [[DateFilter(comparison_operator=Op.is_null)],
                                [DateFilter(date=at, comparison_operator=Op.greater_than)]]
                if known_at is not None:
                    f.created_at = [[DateFilter(date=known_at, comparison_operator=Op.less_than_equal)]]
        edges = await self.graphiti.search(query, group_ids=[group_id], num_results=limit * 3, search_filter=f)
        # NOTE: Graphiti updates invalid_at/expired_at in place, so known_at only hides edges created after K;
        # it cannot restore an invalidation that happened after K. The local TS backend versions rows instead.
        _, driver, _ = self.graphiti._resolve_request_scope(group_id)
        rendered = await self._render(edges, {}, driver)
        if at is not None:
            rendered = [e for e in rendered if (e["valid_at"] or e["created_at"]) <= _iso(at)
                        and (e["invalid_at"] is None or e["invalid_at"] > _iso(at))]
        return rendered[:limit]

    async def _render(self, edges: list[Any], nodes: dict[str, Any], driver=None) -> list[dict[str, Any]]:
        from graphiti_core.nodes import EntityNode
        missing = list({u for e in edges for u in (e.source_node_uuid, e.target_node_uuid) if u not in nodes})
        if missing:
            for n in await EntityNode.get_by_uuids(driver or self.graphiti.driver, missing):
                nodes[n.uuid] = n

        def node(uuid: str) -> dict[str, Any]:
            n = nodes.get(uuid)
            return {"uuid": uuid, "name": getattr(n, "name", uuid), "labels": list(getattr(n, "labels", []) or [])}

        return [{
            "uuid": e.uuid, "name": e.name, "fact": e.fact, "group_id": e.group_id,
            "source": node(e.source_node_uuid), "target": node(e.target_node_uuid),
            "valid_at": _iso(e.valid_at), "invalid_at": _iso(e.invalid_at),
            "created_at": _iso(e.created_at), "expired_at": _iso(e.expired_at), "episodes": list(e.episodes or []),
        } for e in edges]

    async def close(self) -> None:
        try:
            await self.graphiti.close()
        finally:
            await self._completion.transport.close()
            self._receipts.close()
