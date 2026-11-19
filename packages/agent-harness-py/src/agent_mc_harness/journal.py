"""Durable dispatch boundary. Restart reconciles the original ID; it never resubmits a write."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from .models import ActionReceipt, BodyAction


def work_key(action: BodyAction) -> tuple | None:
    if action.verb == "craft" or action.verb == "native" and action.name == "make":
        recipe = action.args.get("recipeId")
        if isinstance(recipe, str) and ":" not in recipe:
            recipe = "minecraft:" + recipe
        # Varying quantity on another planning turn must not issue the same
        # recipe again for the same conversation. A fresh input can ask again.
        return "workshop", action.args.get("workshopId"), recipe, action.args.get("inventory")
    if action.verb == "native" and action.name == "fish":
        return ("fish",)
    if action.verb == "use_item":
        return "use_item", action.args.get("item")
    return None


class ActionJournal:
    def __init__(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS dispatch (id TEXT PRIMARY KEY, body TEXT NOT NULL, action TEXT NOT NULL, receipt TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS replies (body TEXT, event TEXT, request TEXT, PRIMARY KEY(body,event,request))")
        self.db.execute("CREATE TABLE IF NOT EXISTS acknowledgements (body TEXT, event TEXT, request TEXT, PRIMARY KEY(body,event,request))")
        self.db.execute("CREATE TABLE IF NOT EXISTS listened (body TEXT, event TEXT, intent TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(body,event))")
        self.db.execute("CREATE TABLE IF NOT EXISTS work_sources (body TEXT, event TEXT, request TEXT, PRIMARY KEY(body,event,request))")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_contacts (body TEXT, kind TEXT, request TEXT, at REAL, PRIMARY KEY(body,kind))")
        self.db.commit()

    def begin(self, body: str, action: BodyAction, sources: list[str] | None = None) -> None:
        if not action.request_id:
            raise ValueError("durable_request_id_required")
        with self.db:
            self.db.execute("INSERT INTO dispatch VALUES (?,?,?,NULL)",
                            (action.request_id, body, action.model_dump_json()))
            contact = "speech" if action.verb == "chat" else (
                "invite" if action.verb == "native" and action.name == "adventure_action" and action.args.get("kind") == "invite_partner" else None)
            if contact:
                self.db.execute("INSERT OR REPLACE INTO npc_contacts VALUES (?,?,?,?)", (body, contact, action.request_id, time.time()))
            if action.verb == "chat":
                self.db.executemany("INSERT INTO replies VALUES (?,?,?)", [(body, event, action.request_id) for event in dict.fromkeys(sources or [])])
            if action.verb == "native" and action.name == "ack" and action.args.get("eventId"):
                self.db.execute("INSERT INTO acknowledgements VALUES (?,?,?)", (body, action.args["eventId"], action.request_id))
            if work_key(action) is not None:
                self.db.executemany("INSERT INTO work_sources VALUES (?,?,?)",
                                    [(body, event, action.request_id) for event in dict.fromkeys(sources or [])])

    def contacted_recently(self, body: str, kind: str, seconds: float) -> bool:
        return self.db.execute("SELECT 1 FROM npc_contacts WHERE body=? AND kind=? AND at>?",
                               (body, kind, time.time() - seconds)).fetchone() is not None

    def attempted_work(self, body: str, action: BodyAction, events: list[str]) -> bool:
        key = work_key(action)
        if not events or key is None:
            return False
        for event in events:
            rows = self.db.execute("SELECT d.action FROM work_sources w JOIN dispatch d ON d.id=w.request AND d.body=w.body "
                                   "WHERE w.body=? AND w.event=?", (body, event))
            for (value,) in rows:
                old = BodyAction.model_validate_json(value)
                if work_key(old) == key:
                    return True
        return False

    def replied(self, body: str, event: str) -> bool:
        rows = self.db.execute("SELECT d.receipt FROM replies r JOIN dispatch d ON d.id=r.request AND d.body=r.body WHERE r.body=? AND r.event=?", (body, event))
        return any(receipt and json.loads(receipt).get("status") == "completed" for (receipt,) in rows)

    def listen(self, body: str, events: list[str], intent: str) -> None:
        """A valid no-speech/no-write plan handled these inputs; this is not a reply receipt."""
        with self.db:
            self.db.executemany("INSERT OR IGNORE INTO listened (body,event,intent) VALUES (?,?,?)",
                                [(body, event, intent) for event in dict.fromkeys(events)])

    def handled(self, body: str, event: str) -> bool:
        return bool(self.db.execute("SELECT 1 FROM listened WHERE body=? AND event=?", (body, event)).fetchone()) or self.replied(body, event)

    def acknowledged(self, body: str, event: str) -> bool:
        rows = self.db.execute("SELECT d.receipt FROM acknowledgements a JOIN dispatch d ON d.id=a.request AND d.body=a.body WHERE a.body=? AND a.event=?", (body, event))
        return any(receipt and json.loads(receipt).get("status") == "completed" for (receipt,) in rows)

    def settle(self, body: str, receipt: ActionReceipt) -> None:
        with self.db:
            row = self.db.execute("SELECT body FROM dispatch WHERE id=?", (receipt.request_id,)).fetchone()
            if row != (body,):
                raise ValueError("receipt_body_mismatch")
            self.db.execute("UPDATE dispatch SET receipt=? WHERE id=?", (receipt.model_dump_json(), receipt.request_id))
            if receipt.terminal and isinstance(receipt.data, dict) and receipt.data.get("partyWriteSent") is False:
                self.db.execute("DELETE FROM npc_contacts WHERE body=? AND kind='invite' AND request=?", (body, receipt.request_id))

    def unresolved(self, body: str) -> list[BodyAction]:
        rows = self.db.execute("SELECT action,receipt FROM dispatch WHERE body=?", (body,)).fetchall()
        return [BodyAction.model_validate_json(action) for action, receipt in rows
                if receipt is None or json.loads(receipt)["status"] in ("accepted", "unknown")]

    def recent(self, body: str, limit: int = 12) -> list[tuple[BodyAction, ActionReceipt]]:
        rows = self.db.execute(
            "SELECT action,receipt FROM dispatch WHERE body=? AND receipt IS NOT NULL ORDER BY rowid DESC LIMIT ?",
            (body, limit),
        )
        return [(BodyAction.model_validate_json(action), ActionReceipt.model_validate_json(receipt)) for action, receipt in rows]

    def close(self) -> None:
        self.db.close()
