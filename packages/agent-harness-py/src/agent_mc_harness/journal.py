"""Durable dispatch boundary. Restart reconciles the original ID; it never resubmits a write."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from .body.adventure import PARTY_OPENING
from .models import ActionReceipt, BodyAction
from .resident_trace import correlation_hash, trace_resident_turn


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
        self.closed = False
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS dispatch (id TEXT PRIMARY KEY, body TEXT NOT NULL, action TEXT NOT NULL, receipt TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS replies (body TEXT, event TEXT, request TEXT, PRIMARY KEY(body,event,request))")
        self.db.execute("CREATE TABLE IF NOT EXISTS acknowledgements (body TEXT, event TEXT, request TEXT, PRIMARY KEY(body,event,request))")
        self.db.execute("CREATE TABLE IF NOT EXISTS listened (body TEXT, event TEXT, intent TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(body,event))")
        self.db.execute("CREATE TABLE IF NOT EXISTS work_sources (body TEXT, event TEXT, request TEXT, PRIMARY KEY(body,event,request))")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_contacts (body TEXT, kind TEXT, request TEXT, at REAL, PRIMARY KEY(body,kind))")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_resident_speech (request TEXT PRIMARY KEY, turn_hash TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_resident_actions (request TEXT PRIMARY KEY, turn_hash TEXT NOT NULL)")
        self.db.execute("CREATE INDEX IF NOT EXISTS npc_resident_actions_turn ON npc_resident_actions(turn_hash)")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_activity (body TEXT PRIMARY KEY, mode TEXT NOT NULL, "
                        "since REAL NOT NULL, cue TEXT, reviewed REAL, purpose TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_wait_notes (request TEXT PRIMARY KEY, note TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_agendas (character TEXT PRIMARY KEY, until REAL NOT NULL, slots TEXT NOT NULL)")
        self.db.execute("CREATE INDEX IF NOT EXISTS npc_adventure_kind ON dispatch(body,json_extract(action,'$.args.kind')) "
                        "WHERE json_extract(action,'$.name') IN ('adventure_query','adventure_action')")
        self.db.commit()

    def agenda(self, character: str, now: float) -> dict:
        row = self.db.execute("SELECT slots FROM npc_agendas WHERE character=? AND until>?", (character, now)).fetchone()
        slots = [s for s in json.loads(row[0]) if s["endsAt"] > now] if row else []
        return {"now": now, "current": next((s for s in slots if s["startsAt"] <= now), None),
                "upcoming": [s for s in slots if s["startsAt"] > now]}

    def save_agenda(self, character: str, slots: list[dict], now: float, previous_end: float | None = None) -> None:
        with self.db:
            if previous_end is not None:
                # A late reply to an older schedule cannot modify its replacement.
                if slots:
                    self.db.execute("UPDATE npc_agendas SET until=?, slots=? WHERE character=? AND until=? AND until>?",
                                    (slots[-1]["endsAt"], json.dumps(slots, ensure_ascii=False), character, previous_end, now))
                else:
                    self.db.execute("DELETE FROM npc_agendas WHERE character=? AND until=? AND until>?", (character, previous_end, now))
                return
            self.db.execute("INSERT INTO npc_agendas VALUES (?,?,?) ON CONFLICT(character) DO UPDATE SET "
                            "until=excluded.until,slots=excluded.slots WHERE npc_agendas.until<=?",
                            (character, slots[-1]["endsAt"], json.dumps(slots, ensure_ascii=False), now))

    def begin(self, body: str, action: BodyAction, sources: list[str] | None = None, *, note: str | None = None,
              resident_turn_hash: str | None = None) -> None:
        if not action.request_id:
            raise ValueError("durable_request_id_required")
        with self.db:
            self.db.execute("INSERT INTO dispatch VALUES (?,?,?,NULL)",
                            (action.request_id, body, action.model_dump_json()))
            if resident_turn_hash:
                self.db.execute("INSERT INTO npc_resident_actions VALUES (?,?)", (action.request_id, resident_turn_hash))
            if note and (action.verb in {"stay", "stop"} or action.verb == "native" and action.name == "sit"):
                self.db.execute("INSERT INTO npc_wait_notes VALUES (?,?)", (action.request_id, note[:200]))
            contact = "speech" if action.verb == "chat" else (
                "invite" if action.verb == "native" and action.name == "adventure_action" and action.args.get("kind") == "invite_partner" else None)
            if contact:
                self.db.execute("INSERT OR REPLACE INTO npc_contacts VALUES (?,?,?,?)", (body, contact, action.request_id, time.time()))
            if action.name == "adventure_action" and action.args.get("kind") == "party_chat" and isinstance(action.args.get("partyId"), str):
                key = "party-opening:" + action.args["partyId"] if action.args.get("text") == PARTY_OPENING else "party-speech"
                self.db.execute("INSERT OR REPLACE INTO npc_contacts VALUES (?,?,?,?)", (body, key, action.request_id, time.time()))
            if action.verb == "chat":
                if resident_turn_hash:
                    self.db.execute("INSERT INTO npc_resident_speech VALUES (?,?)", (action.request_id, resident_turn_hash))
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

    def reply_settled(self, body: str, event: str) -> bool:
        """A terminal private reply attempt must not trigger a second write, even when it failed."""
        rows = self.db.execute("SELECT d.receipt FROM replies r JOIN dispatch d ON d.id=r.request AND d.body=r.body "
                               "WHERE r.body=? AND r.event=?", (body, event))
        for (value,) in rows:
            receipt = json.loads(value) if value else {}
            if receipt.get("terminal") is True and receipt.get("status") not in {None, "accepted", "unknown"}:
                return True
        return False

    def acknowledged(self, body: str, event: str) -> bool:
        rows = self.db.execute("SELECT d.receipt FROM acknowledgements a JOIN dispatch d ON d.id=a.request AND d.body=a.body WHERE a.body=? AND a.event=?", (body, event))
        return any(receipt and json.loads(receipt).get("status") == "completed" for (receipt,) in rows)

    def settle(self, body: str, receipt: ActionReceipt) -> None:
        with self.db:
            row = self.db.execute("SELECT body,receipt FROM dispatch WHERE id=?", (receipt.request_id,)).fetchone()
            if not row or row[0] != body:
                raise ValueError("receipt_body_mismatch")
            self.db.execute("UPDATE dispatch SET receipt=? WHERE id=?", (receipt.model_dump_json(), receipt.request_id))
            if receipt.terminal:
                wait = self.db.execute("SELECT note FROM npc_wait_notes WHERE request=?", (receipt.request_id,)).fetchone()
                if wait and receipt.status == "completed":
                    now = time.time()
                    # Preserve the start of a continuous wait, including across controller restarts.
                    self.db.execute("INSERT INTO npc_activity VALUES (?, 'waiting', ?, NULL, ?, ?) "
                                    "ON CONFLICT(body) DO UPDATE SET mode='waiting', "
                                    "since=CASE WHEN mode='waiting' THEN since ELSE excluded.since END, "
                                    "cue=NULL, reviewed=excluded.reviewed, purpose=excluded.purpose",
                                    (body, now, now, wait[0]))
                if wait:
                    self.db.execute("DELETE FROM npc_wait_notes WHERE request=?", (receipt.request_id,))
            if receipt.terminal and isinstance(receipt.data, dict) and receipt.data.get("partyWriteSent") is False:
                self.db.execute("DELETE FROM npc_contacts WHERE body=? AND request=?", (body, receipt.request_id))
        if turn_hash := self.resident_turn_hash(receipt.request_id):
            prior = json.loads(row[1]) if row[1] else {}
            if (prior.get("status"), prior.get("terminal")) != (receipt.status, receipt.terminal):
                trace_resident_turn(turn_hash, "action_terminal" if receipt.terminal else "action_result",
                                    requestHash=correlation_hash(receipt.request_id), status=receipt.status, terminal=receipt.terminal)

    def observe_activity(self, body: str, mode: str, cue: str, now: float) -> tuple[float, float | None, str | None, bool]:
        """Return this observed episode's start, last review, known wait purpose and any change of scene."""
        row = self.db.execute("SELECT mode,since,cue,reviewed,purpose FROM npc_activity WHERE body=?", (body,)).fetchone()
        if not row or row[0] != mode:
            with self.db:
                self.db.execute("INSERT OR REPLACE INTO npc_activity VALUES (?,?,?,?,NULL,NULL)", (body, mode, now, cue))
            return now, None, None, True
        changed = row[2] is not None and row[2] != cue
        if row[2] != cue:
            with self.db:
                self.db.execute("UPDATE npc_activity SET cue=?, reviewed=CASE WHEN ? THEN NULL ELSE reviewed END WHERE body=?",
                                (cue, changed, body))
        return row[1], None if changed else row[3], row[4], changed

    def reviewed_activity(self, body: str, mode: str, cue: str, now: float, renewed_purpose: str | None = None,
                          *, renew_wait: bool = False) -> None:
        with self.db:
            self.db.execute("UPDATE npc_activity SET reviewed=?, purpose=COALESCE(?,purpose), "
                            "since=CASE WHEN ? THEN ? ELSE since END WHERE body=? AND mode=? AND cue=?",
                            (now, renewed_purpose, renew_wait and mode == "waiting" and renewed_purpose is not None,
                             now, body, mode, cue))

    def unresolved(self, body: str) -> list[BodyAction]:
        rows = self.db.execute("SELECT action,receipt FROM dispatch WHERE body=?", (body,)).fetchall()
        return [BodyAction.model_validate_json(action) for action, receipt in rows
                if receipt is None or json.loads(receipt)["status"] in ("accepted", "unknown")]

    def receipt(self, body: str, request_id: str) -> ActionReceipt | None:
        row = self.db.execute("SELECT receipt FROM dispatch WHERE body=? AND id=?", (body, request_id)).fetchone()
        return ActionReceipt.model_validate_json(row[0]) if row and row[0] else None

    def action(self, body: str, request_id: str) -> BodyAction | None:
        row = self.db.execute("SELECT action FROM dispatch WHERE body=? AND id=?", (body, request_id)).fetchone()
        return BodyAction.model_validate_json(row[0]) if row else None

    def speech_turn_hash(self, request_id: str) -> str | None:
        row = self.db.execute("SELECT turn_hash FROM npc_resident_speech WHERE request=?", (request_id,)).fetchone()
        return row[0] if row else None

    def resident_turn_hash(self, request_id: str) -> str | None:
        row = self.db.execute("SELECT turn_hash FROM npc_resident_actions WHERE request=?", (request_id,)).fetchone()
        return row[0] if row else self.speech_turn_hash(request_id)

    def recent(self, body: str, limit: int = 12) -> list[tuple[BodyAction, ActionReceipt]]:
        rows = self.db.execute(
            "SELECT action,receipt FROM dispatch WHERE body=? AND receipt IS NOT NULL ORDER BY rowid DESC LIMIT ?",
            (body, limit),
        )
        return [(BodyAction.model_validate_json(action), ActionReceipt.model_validate_json(receipt)) for action, receipt in rows]

    def recent_companion_speech(self, body: str) -> list[str]:
        # Private replies do not use this public, native body speech receipt.
        rows = self.db.execute("""
            SELECT json_extract(action,'$.args.text') FROM dispatch
            WHERE body=? AND json_extract(action,'$.verb')='chat'
              AND json_extract(receipt,'$.status')='completed'
              AND json_extract(receipt,'$.data.reply.data.observation.deliveredPlayers')>0
              AND julianday(json_extract(receipt,'$.data.reply.data.observedAt'))>=julianday('now','-20 minutes')
            ORDER BY rowid DESC LIMIT 8
        """, (body,))
        return [text[:100] for (text,) in rows if isinstance(text, str) and text.strip()]

    def last_adventure(self, body: str, kind: str, *other_kinds: str) -> dict:
        kinds = (kind, *other_kinds)
        placeholders = ",".join("?" for _ in kinds)
        row = self.db.execute("SELECT receipt FROM dispatch WHERE body=? AND receipt IS NOT NULL "
                              "AND json_extract(action,'$.name') IN ('adventure_query','adventure_action') "
                              f"AND json_extract(action,'$.args.kind') IN ({placeholders}) ORDER BY rowid DESC LIMIT 1",
                              (body, *kinds)).fetchone()
        data = json.loads(row[0]).get("data") if row else None
        evidence = data.get("adventure") if isinstance(data, dict) else None
        return evidence if isinstance(evidence, dict) else {}

    def inventory_after(self, body: str, request_id: str) -> list[dict]:
        row = self.db.execute("""
            SELECT receipt FROM dispatch WHERE body=? AND json_extract(action,'$.verb')='inventory'
            AND json_extract(receipt,'$.status')='completed'
            AND rowid>(SELECT rowid FROM dispatch WHERE id=? AND body=?) ORDER BY rowid DESC LIMIT 1
        """, (body, request_id, body)).fetchone()
        return ((json.loads(row[0]).get("data") or {}).get("inventory") or []) if row else []

    def close(self) -> None:
        if not self.closed:
            self.db.close()
            self.closed = True
