"""SQLite quest store (stdlib only). Idempotent by commissionId; optimistic version check on every save."""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from .models import TERMINAL, Quest

SCHEMA = """
CREATE TABLE IF NOT EXISTS quests (
    id TEXT PRIMARY KEY,
    commission_id TEXT NOT NULL UNIQUE,
    issuer TEXT NOT NULL,
    status TEXT NOT NULL,
    assignee TEXT,
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL,
    body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quests_status ON quests(status);
CREATE INDEX IF NOT EXISTS quests_issuer ON quests(issuer, created_at);
CREATE TABLE IF NOT EXISTS signals (
    signal_id TEXT PRIMARY KEY,
    quest_id TEXT NOT NULL
);
"""


class StaleQuest(RuntimeError):
    """Another writer saved this quest first; reload and decide again (never overwrite blindly)."""


class QuestStore:
    def __init__(self, path: str | Path = ":memory:") -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL" if path != ":memory:" else "PRAGMA journal_mode=MEMORY")
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()

    def close(self) -> None:
        self._db.close()

    @staticmethod
    def _row(body: str) -> Quest:
        return Quest.model_validate_json(body)

    def add(self, quest: Quest) -> tuple[Quest, bool]:
        """Insert; if the commission is already known, return the stored quest and ``False`` (no duplicate)."""
        with self._lock:
            existing = self.by_commission(quest.commission.commission_id)
            if existing is not None:
                return existing, False
            quest.version = 1
            self._db.execute(
                "INSERT INTO quests (id, commission_id, issuer, status, assignee, created_at, version, body) VALUES (?,?,?,?,?,?,?,?)",
                (quest.id, quest.commission.commission_id, quest.commission.issuer, quest.status, quest.assignee,
                 quest.created_at.isoformat(), quest.version, quest.model_dump_json(by_alias=True)))
            return quest, True

    def save(self, quest: Quest, *, signal_id: str | None = None) -> Quest:
        """Write with a version check. ``signal_id`` is recorded in the same transaction so evidence counts once."""
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                if signal_id is not None:
                    self._db.execute("INSERT INTO signals (signal_id, quest_id) VALUES (?, ?)", (signal_id, quest.id))
                cur = self._db.execute(
                    "UPDATE quests SET status=?, assignee=?, version=?, body=? WHERE id=? AND version=?",
                    (quest.status, quest.assignee, quest.version + 1, quest.model_copy(update={"version": quest.version + 1})
                     .model_dump_json(by_alias=True), quest.id, quest.version))
                if cur.rowcount != 1:
                    raise StaleQuest(quest.id)
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            self._db.execute("COMMIT")
            quest.version += 1
            return quest

    def signal_seen(self, signal_id: str) -> bool:
        return self._db.execute("SELECT 1 FROM signals WHERE signal_id=?", (signal_id,)).fetchone() is not None

    def get(self, quest_id: str) -> Quest | None:
        row = self._db.execute("SELECT body FROM quests WHERE id=?", (quest_id,)).fetchone()
        return self._row(row[0]) if row else None

    def by_commission(self, commission_id: str) -> Quest | None:
        row = self._db.execute("SELECT body FROM quests WHERE commission_id=?", (commission_id,)).fetchone()
        return self._row(row[0]) if row else None

    def find(self, *, statuses: tuple[str, ...] | None = None, issuer: str | None = None, assignee: str | None = None) -> list[Quest]:
        sql, args = "SELECT body FROM quests WHERE 1=1", list[str]()
        if statuses:
            sql += f" AND status IN ({','.join('?' * len(statuses))})"
            args.extend(statuses)
        if issuer is not None:
            sql += " AND issuer=?"
            args.append(issuer)
        if assignee is not None:
            sql += " AND assignee=?"
            args.append(assignee)
        return [self._row(r[0]) for r in self._db.execute(sql + " ORDER BY created_at, rowid", args)]

    def open(self, **filters: str) -> list[Quest]:
        live = ("offered", "accepted", "in_progress")
        return self.find(statuses=live, **filters)

    def issued_since(self, issuer: str, since: datetime) -> int:
        row = self._db.execute("SELECT COUNT(*) FROM quests WHERE issuer=? AND created_at>=?", (issuer, since.isoformat())).fetchone()
        return int(row[0])


__all__ = ["QuestStore", "StaleQuest", "TERMINAL"]
