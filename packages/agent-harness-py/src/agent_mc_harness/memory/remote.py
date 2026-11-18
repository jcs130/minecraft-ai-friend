"""Loopback Graphiti client with a durable, bounded-concurrency extraction outbox."""
from __future__ import annotations

import asyncio
import contextlib
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from .base import Fact, MemoryEpisode, check_group


class RemoteGraphMemory:
    name = "graphiti"
    extraction_ready = True

    def __init__(self, endpoint: str, token: str, path: Path, *, http=None) -> None:
        url = urlsplit(endpoint)
        if url.scheme != "http" or url.hostname != "127.0.0.1" or url.path not in ("", "/") or url.query or url.fragment or url.username:
            raise ValueError("graphiti_loopback_required")
        if not token:
            raise ValueError("graphiti_auth_required")
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS outbox (scope TEXT, id TEXT, payload TEXT NOT NULL, done INTEGER DEFAULT 0, PRIMARY KEY(scope,id))")
        self.db.commit()
        self.endpoint = endpoint.rstrip("/")
        self.http = http or httpx.AsyncClient(trust_env=False, follow_redirects=False)
        self.headers = {"Authorization": "Bearer " + token}
        self.task: asyncio.Task | None = None

    def start(self):
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._extract())

    async def add(self, group_id: str, episode: MemoryEpisode, hints=None):
        check_group(group_id)
        # Every event is already in the local archive. Do not spend extraction
        # tokens on high-frequency attack/mode receipts; keep meaningful social,
        # life, location and explicitly composed reflection episodes in Graphiti.
        if episode.kind in {"action_result", "combat", "player_join", "player_leave"}:
            return {"status": "local_archive_only", "episode": episode.id}
        value = episode.model_dump(mode="json", exclude={"provenance"})
        value["source_description"] = episode.graph_source()
        payload = {"protocol": "agent-mc-memory-graph/v1", "group_id": group_id, "episode": value, "hints": hints or []}
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO outbox(scope,id,payload) VALUES (?,?,?)", (group_id, episode.id, json.dumps(payload, ensure_ascii=False)))
        self.start()
        return {"status": "queued", "episode": episode.id}

    def episode_ids(self, group_id: str, *, completed: bool = False) -> set[str]:
        return {row[0] for row in self.db.execute(
            "SELECT id FROM outbox WHERE scope=? AND done>=?", (check_group(group_id), int(completed)))}

    def pending_count(self) -> int:
        return self.db.execute("SELECT count(*) FROM outbox WHERE done=0").fetchone()[0]

    async def _extract(self):
        while True:
            row = self.db.execute("SELECT scope,id,payload FROM outbox WHERE done=0 ORDER BY rowid LIMIT 1").fetchone()
            if row is None:
                return
            try:
                response = await self.http.post(self.endpoint + "/episodes", headers=self.headers, json=json.loads(row[2]), timeout=120)
                response.raise_for_status()
                with self.db:
                    self.db.execute("UPDATE outbox SET done=1 WHERE scope=? AND id=?", row[:2])
            except (httpx.HTTPError, ValueError):
                # This is idempotent memory extraction, never a world action. Keep the episode durable.
                await asyncio.sleep(15)

    async def _search(self, group_id: str, query: str, limit: int, at: datetime | None):
        check_group(group_id)
        body = {"protocol": "agent-mc-memory-graph/v1", "group_id": group_id, "query": query[:500], "limit": min(limit, 20)}
        if at:
            body["at"] = at.isoformat()
        response = await self.http.post(self.endpoint + "/search", headers=self.headers, json=body, timeout=2)
        response.raise_for_status()
        result = response.json()
        rows = result.get("facts") if isinstance(result, dict) else None
        if not isinstance(rows, list):
            raise ValueError("graphiti_search_response")
        return rows[:limit]

    async def search(self, group_id: str, query: str, limit=8, at: datetime | None = None):
        return [Fact(fact=row["fact"], source="graphiti", valid_at=row.get("valid_at"), invalid_at=row.get("invalid_at"))
                for row in await self._search(group_id, query, limit, at)]

    async def search_sources(self, group_id: str, query: str, limit: int = 8) -> tuple[str, ...]:
        """Collect source node IDs from active edges in the exact requested graph."""
        ids = []
        for row in await self._search(group_id, query, limit, None):
            if (not isinstance(row, dict) or row.get("group_id") != group_id
                    or row.get("invalid_at") or row.get("expired_at")):
                continue
            episodes = row.get("episodes")
            if not isinstance(episodes, list):
                continue
            for value in episodes[:16]:
                if isinstance(value, str):
                    with contextlib.suppress(ValueError):
                        ids.append(str(UUID(value)))
        return tuple(dict.fromkeys(ids))

    async def close(self):
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        await self.http.aclose()
        self.db.close()
