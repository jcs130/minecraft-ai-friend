"""Durable dispatch boundary. Restart reconciles the original ID; it never resubmits a write."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .models import ActionReceipt, BodyAction


class ActionJournal:
    def __init__(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS dispatch (id TEXT PRIMARY KEY, body TEXT NOT NULL, action TEXT NOT NULL, receipt TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS replies (body TEXT, event TEXT, request TEXT, PRIMARY KEY(body,event,request))")
        self.db.commit()

    def begin(self, body: str, action: BodyAction, sources: list[str] | None = None) -> None:
        if not action.request_id:
            raise ValueError("durable_request_id_required")
        with self.db:
            self.db.execute("INSERT INTO dispatch VALUES (?,?,?,NULL)",
                            (action.request_id, body, action.model_dump_json()))
            if action.verb == "chat":
                self.db.executemany("INSERT INTO replies VALUES (?,?,?)", [(body, event, action.request_id) for event in dict.fromkeys(sources or [])])

    def replied(self, body: str, event: str) -> bool:
        rows = self.db.execute("SELECT d.receipt FROM replies r JOIN dispatch d ON d.id=r.request AND d.body=r.body WHERE r.body=? AND r.event=?", (body, event))
        return any(receipt and json.loads(receipt).get("status") == "completed" for (receipt,) in rows)

    def settle(self, body: str, receipt: ActionReceipt) -> None:
        with self.db:
            row = self.db.execute("SELECT body FROM dispatch WHERE id=?", (receipt.request_id,)).fetchone()
            if row != (body,):
                raise ValueError("receipt_body_mismatch")
            self.db.execute("UPDATE dispatch SET receipt=? WHERE id=?", (receipt.model_dump_json(), receipt.request_id))

    def unresolved(self, body: str) -> list[BodyAction]:
        rows = self.db.execute("SELECT action,receipt FROM dispatch WHERE body=?", (body,)).fetchall()
        return [BodyAction.model_validate_json(action) for action, receipt in rows
                if receipt is None or json.loads(receipt)["status"] in ("accepted", "unknown")]

    def close(self) -> None:
        self.db.close()
