"""Local fallback store (stdlib sqlite3): always available, no network, no LLM.

Lexical recall only (word tokens + CJK bigrams, the same features the sidecar's HashEmbedder uses). It is the source
of truth whenever Graphiti is off, unconfigured or failing, so memory never silently disappears.
"""
from __future__ import annotations

import asyncio
import json
import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .base import Fact, MemoryEpisode, check_group

_WORD = re.compile(r"[a-z0-9_:.\-]+")
_CJK = re.compile(r"[\u3400-\u9fff]+")


def features(text: str) -> set[str]:
    lower = text.lower()
    out = set(_WORD.findall(lower))
    for run in _CJK.findall(lower):
        out.update(run if len(run) == 1 else (run[i:i + 2] for i in range(len(run) - 1)))
    return out


class LocalMemory:
    name = "local"

    def __init__(self, path: str | Path = ":memory:") -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS episodes (group_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT, name TEXT, body TEXT,
                           reference_time TEXT, actors TEXT, PRIMARY KEY (group_id, id))""")
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(episodes)")}
        if "provenance" not in columns:
            self.db.execute("ALTER TABLE episodes ADD COLUMN provenance TEXT")
        self.lock = asyncio.Lock()

    async def add(self, group_id: str, episode: MemoryEpisode, hints: list[str] | None = None) -> dict[str, Any]:
        check_group(group_id)
        async with self.lock:
            previous = self.db.execute("SELECT kind,name,body FROM episodes WHERE group_id=? AND id=?", (group_id, episode.id)).fetchone()
            if previous and previous != (episode.kind, episode.name, episode.body):
                raise ValueError("memory_episode_id_conflict")
            self.db.execute("INSERT OR IGNORE INTO episodes (group_id, id, kind, name, body, reference_time, actors, provenance)"
                            " VALUES (?,?,?,?,?,?,?,?)",
                            (group_id, episode.id, episode.kind, episode.name, episode.body,
                             episode.reference_time.astimezone(UTC).isoformat(), json.dumps(episode.actors, ensure_ascii=False),
                             json.dumps(episode.provenance, ensure_ascii=False)))
            self.db.commit()
        return {"stored": "local", "episode": episode.id}

    async def search(self, group_id: str, query: str, limit: int = 8, at: datetime | None = None) -> list[Fact]:
        check_group(group_id)
        wanted = features(query)
        sql, params = "SELECT id, kind, name, body, reference_time, provenance FROM episodes WHERE group_id = ?", [group_id]
        if at is not None:
            sql += " AND reference_time <= ?"
            params.append(at.astimezone(UTC).isoformat())
        async with self.lock:
            rows = self.db.execute(sql + " ORDER BY reference_time DESC LIMIT 2000", params).fetchall()
        scored = []
        for rid, kind, name, body, when, prov in rows:
            have = features(body + " " + name)
            score = len(wanted & have) / (len(wanted) or 1)
            if score > 0 or not wanted:
                scored.append(Fact(fact=body, source="local", valid_at=when, score=score, data={"id": rid, "kind": kind},
                                   provenance=json.loads(prov) if prov else {}))
        scored.sort(key=lambda f: (f.score, f.valid_at or ""), reverse=True)
        return scored[:limit]

    async def close(self) -> None:
        self.db.close()
