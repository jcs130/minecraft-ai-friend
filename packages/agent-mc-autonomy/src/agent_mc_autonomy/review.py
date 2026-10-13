"""Framework-owned strategic review lifecycle. Host frontends only transport envelopes."""

import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime

from .configuration import _boolean, _integer
from .mailbox import Mailbox, observation


@dataclass(frozen=True)
class ReviewPolicy:
    enabled: bool = False
    min_interval_seconds: int = 60
    review_interval_seconds: int = 180

    @classmethod
    def parse(cls, raw):
        minimum = _integer(raw, "min_interval_seconds", 60, 30, 900)
        return cls(_boolean(raw, "enabled", False), minimum,
                   _integer(raw, "review_interval_seconds", 180, minimum, 1800))


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def review_observation(status, now):
    snapshot = status.get("observation", status)
    try:
        age = now - datetime.fromisoformat(snapshot["updated_at"]).timestamp()
    except (KeyError, TypeError, ValueError):
        return None
    if not 0 <= age <= 30 or snapshot.get("phase") not in {"running", "failed"}:
        return None
    if snapshot.get("phase") == "running" and snapshot.get("game_connected") is not True:
        return None
    facts = {part["key"]: str(part.get("text", "")) for part in snapshot.get("facts", {}).get("parts", [])}
    if not facts.get("body") or not facts.get("gear"):
        return None
    active = snapshot.get("current_goal") or {}
    pending = [{key: task.get(key) for key in ("kind", "id", "phase", "terminal")} for task in snapshot.get("pending", [])[:16]]
    useful = {key: facts.get(key, "")[:size] for key, size in (
        ("body", 180), ("gear", 420), ("foodReserve", 160), ("life", 250), ("place", 180),
        ("clock", 80), ("queue", 350), ("lastTask", 300))}
    # Raw facts remain in the independent journal/status API; no accumulating prompt history here.
    evidence = {"sampled_at": snapshot["updated_at"], "phase": snapshot["phase"], "connected": snapshot.get("game_connected") is True,
                "standing_goal": str(snapshot.get("standing_goal", ""))[:600],
                "current_goal": {key: active.get(key) for key in ("id", "goal", "mode")}, "pending": pending,
                "facts": useful, "planner_error": snapshot.get("planner_error"),
                "planner_failures": snapshot.get("planner_failures", 0), "runtime_error": snapshot.get("error")}
    # Clocks, sight direction, repeated observation task IDs and positional chatter are not urgent changes.
    material = {key: useful[key] for key in ("body", "gear", "foodReserve")}
    terminal = useful["lastTask"]
    if re.search(r'"skill"\s*:\s*"observe"', terminal) and "完成" in terminal:
        terminal = ""  # Repeated successful look-only tasks are not new survival progress.
    urgent = "runtime_failed" if snapshot["phase"] == "failed" else (
        "death" if re.search(r"生命\s*0(?:\.0)?\s*/", useful["body"]) else None)
    return {"session": str(snapshot.get("owner_pid", "")) + ":" + str((snapshot.get("viewer") or {}).get("session", "")),
            "material": digest(material), "intent": digest([evidence["standing_goal"], active]),
            "signal": digest([material, active, evidence["planner_error"], bool(pending), terminal]),
            "urgent": urgent, "evidence": evidence}


def brief(text, size):
    raw = str(text).encode("utf-8")
    return raw.decode() if len(raw) <= size else raw[:size - 3].decode("utf-8", errors="ignore") + "…"


def summary(evidence):
    facts = evidence["facts"]
    goal = evidence["current_goal"].get("goal") or evidence["standing_goal"]
    readings = "；".join(brief(facts[key], size) for key, size in (
        ("body", 65), ("foodReserve", 60), ("gear", 70), ("queue", 65)))
    return "目标:" + brief(goal, 70) + "；新鲜观测:" + readings


class ReviewPort:
    """One cross-process strategic mailbox; the native controller remains sole body owner."""

    def __init__(self, directory, *, now=time.time):
        self.directory = directory.resolve()
        self.path = self.directory / "reviews.sqlite3"
        self.mailbox = Mailbox(self.directory)
        self.now = now

    def request_id(self, review_id):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, self.directory.as_uri() + ":" + review_id))

    def reconcile(self, state):
        """Recover a mailbox commit if the process died before saving its review receipt."""
        review = state.get("review", {})
        if not review or review.get("result"):
            return
        request_id = self.request_id(review["id"])
        receipt = self.mailbox.get(request_id)
        if not receipt:
            return
        with self.mailbox.connection() as db:
            row = db.execute("SELECT payload FROM commands WHERE id=?", (request_id,)).fetchone()
            payload = json.loads(row[0])
        choice = {"decision": "insert", "goal": payload["goal"], "reason": "recovered_mailbox_receipt"}
        review.update(choice=choice, recovered=True, result={"acknowledged": True, "dispatched": True,
                      "decision": "insert", "verified": False, "request_id": request_id,
                      "delivery": receipt["delivery"], "recovered": True})
        state["last_request_id"] = request_id
        state["last_decision"] = {**choice, "at": self.now(), "heartbeat_id": review["id"], "request_id": request_id}

    @contextmanager
    def transaction(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS review_state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT body FROM review_state WHERE id=1").fetchone()
                state = json.loads(row[0]) if row else {}
                yield state
                db.execute("INSERT OR REPLACE INTO review_state VALUES(1,?)", (json.dumps(state, ensure_ascii=False),))
        finally:
            db.close()

    def state(self):
        if not self.path.exists():
            return {}
        db = sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True, timeout=5)
        try:
            row = db.execute("SELECT body FROM review_state WHERE id=1").fetchone()
            return json.loads(row[0]) if row else {}
        finally:
            db.close()

    def configure(self, policy):
        with self.transaction() as state:
            state["policy"] = asdict(policy)

    def stopping(self):
        if not self.mailbox.path.exists():
            return False
        with self.mailbox.connection() as db:
            return db.execute("SELECT 1 FROM commands WHERE kind='stop' AND state IN ('queued','dispatching') LIMIT 1").fetchone() is not None

    def observe(self, snapshot):
        """Called by the existing runtime publish path, never by a frontend timer."""
        now = self.now()
        observed = review_observation(snapshot, now)
        if not observed or self.stopping():
            return
        with self.transaction() as state:
            self.reconcile(state)
            policy = ReviewPolicy.parse(state.get("policy", {}))
            if not policy.enabled:
                return
            previous = state.get("review", {})
            revision = self.mailbox.intent_revision()
            same_session = previous.get("session") == observed["session"]
            same_intent = previous.get("revision") == revision and previous.get("intent") == observed["intent"]
            urgent = bool(observed["urgent"] and observed["urgent"] != previous.get("urgent"))
            if state.get("material") != observed["material"] or not same_session:
                state.update(material=observed["material"], material_since=now)
            observed["evidence"]["material_unchanged_seconds"] = int(now - state.get("material_since", now))
            if now < state.get("retry_after", 0) and not urgent and same_session and same_intent:
                return
            pending = previous and not previous.get("result") and same_session and same_intent and not urgent
            if pending:
                if now - previous["created_at"] > 180:
                    previous["result"] = {"acknowledged": False, "error": "main_brain_not_acknowledged"}
                    state["retry_after"] = now + 300
                else:
                    previous["evidence"] = observed["evidence"]
                    previous["summary"] = summary(observed["evidence"])
                return
            elapsed = now - state.get("created_at", 0)
            changed = not same_session or not same_intent or observed["signal"] != previous.get("signal")
            if not urgent and (elapsed < policy.min_interval_seconds or (not changed and elapsed < policy.review_interval_seconds)):
                return
            state.update(created_at=now, review={**observed, "id": uuid.uuid4().hex[:12], "created_at": now,
                         "revision": revision, "attempts": 0, "summary": summary(observed["evidence"]),
                         "trigger": "state_changed" if changed else "periodic_review"})

    def offer(self):
        """Claim one bounded delivery attempt; does not manufacture a game event."""
        current = review_observation(observation(self.directory), self.now())
        if not current or self.stopping():
            return {"offered": False, "reason": "no_fresh_running_observation"}
        with self.transaction() as state:
            self.reconcile(state)
            review = state.get("review", {})
            if not state.get("policy", {}).get("enabled") or not review or review.get("result"):
                return {"offered": False, "reason": "no_pending_review"}
            if current["session"] != review["session"] or current["intent"] != review["intent"] or self.mailbox.intent_revision() != review["revision"]:
                return {"offered": False, "reason": "review_superseded"}
            now = self.now()
            if not 0 <= now - review["created_at"] <= 180:
                return {"offered": False, "reason": "review_expired"}
            if review["attempts"] >= 2 or now - review.get("last_attempt", 0) < 90:
                return {"offered": False, "reason": "awaiting_main_brain"}
            review["attempts"] += 1
            review["last_attempt"] = now
            return {"offered": True, "review": json.loads(json.dumps(review))}

    def delivered(self, review_id, accepted):
        with self.transaction() as state:
            review = state.get("review", {})
            if review.get("id") == review_id:
                review["notification_accepted"] = accepted is True
                if accepted:
                    state["submitted_at"] = self.now()

    def decide(self, review_id, decision, reason="", goal=""):
        if decision not in {"inspect", "continue", "insert"} or not all(isinstance(v, str) for v in (review_id, reason, goal)):
            return {"is_error": True, "error": "invalid_review"}
        if len(reason) > 600 or len(goal) > 2000 or (decision != "inspect" and not reason.strip()) or (decision == "insert" and not goal.strip()):
            return {"is_error": True, "error": "reason_and_stage_goal_required"}
        current = review_observation(observation(self.directory), self.now())
        choice = {"decision": decision, "reason": reason.strip(), "goal": goal.strip()}
        with self.transaction() as state:
            self.reconcile(state)
            review = state.get("review", {})
            if not state.get("policy", {}).get("enabled") or self.stopping():
                return {"is_error": True, "error": "disabled_or_stopped"}
            if review.get("id") != review_id:
                return {"is_error": True, "error": "review_superseded"}
            compare = ("decision", "goal") if review.get("recovered") else ("decision", "goal", "reason")
            if review.get("choice") and any(review["choice"][key] != choice[key] for key in compare) and decision != "inspect":
                return {"is_error": True, "error": "review_choice_conflict"}
            if review.get("result"):
                return review["result"]
            if not current or current["session"] != review["session"] or not 0 <= self.now() - review["created_at"] <= 180:
                return {"is_error": True, "error": "review_expired_or_game_unavailable"}
            if decision == "inspect":
                return {"heartbeat_id": review_id, "next": "choose continue or insert; do not wait for audience approval",
                        "last_decision": state.get("last_decision"), **review["evidence"]}
            request_id = self.request_id(review_id)
            existing = self.mailbox.get(request_id)
            if not existing and (self.mailbox.intent_revision() != review["revision"] or current["intent"] != review["intent"]):
                return {"is_error": True, "error": "intent_revision_changed"}
            if decision == "insert" and not existing:
                if current["evidence"]["phase"] != "running" or not current["evidence"]["connected"]:
                    return {"is_error": True, "error": "game_not_running"}
                previous = self.mailbox.get(state.get("last_request_id", ""))
                if previous and previous["delivery"] in {"queued", "dispatching", "planning", "paused"}:
                    return {"is_error": True, "error": "previous_intent_pending", "request_id": previous["request_id"],
                            "next": "continue existing goal; explicit user feedback uses the regular intent mailbox"}
                if goal.strip() == (current["evidence"]["current_goal"].get("goal") or current["evidence"]["standing_goal"]):
                    return {"is_error": True, "error": "goal_already_active"}
            result = {"acknowledged": True, "dispatched": False, "decision": decision, "verified": False,
                      "reply": "已记录主脑判断，未新增任务；现在可简短说明情况和打算。"}
            if decision == "insert":
                try:
                    receipt = self.mailbox.submit("feedback", {"goal": goal.strip(), "mode": "insert"}, request_id,
                                                  expected_revision=review["revision"])
                except ValueError as error:
                    return {"is_error": True, "error": str(error)}
                state["last_request_id"] = request_id
                result.update(dispatched=True, request_id=request_id, delivery=receipt["delivery"],
                              reply="阶段目标已投递，原生队列在安全检查点插入；尚未证明完成。现在可简短说明打算。")
            review.update(choice=choice, result=result)
            state["last_decision"] = {**choice, "at": self.now(), "heartbeat_id": review_id, "request_id": result.get("request_id")}
            return result


