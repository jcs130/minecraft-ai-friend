"""Local command delivery only; the native executor owns the actual work queue."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from .stage_applicability import historical_proposal, inapplicable_reason


class Mailbox:
    def __init__(self, directory: Path):
        self.path = directory / "commands.sqlite3"

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("""CREATE TABLE IF NOT EXISTS commands (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
                state TEXT NOT NULL, receipt TEXT, created REAL NOT NULL)""")
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _intent_revision(db):
        return db.execute("SELECT coalesce(max(rowid),0) FROM commands WHERE kind IN ('goal','feedback','stop')").fetchone()[0]

    def intent_revision(self):
        """Monotonic intent generation, including queued user changes and stops."""
        if not self.path.exists():
            return 0
        with self.connection() as db:
            return self._intent_revision(db)

    def submit(self, kind: str, payload: dict, request_id: str, *, expected_revision=None) -> dict:
        try:
            uuid.UUID(request_id)
        except (ValueError, TypeError, AttributeError):
            raise ValueError("request_id_must_be_uuid: reuse the same ID when confirmation is uncertain") from None
        if kind not in {"steps", "stop", "goal", "feedback"} or not isinstance(payload, dict):
            raise ValueError("command_invalid")
        if kind == "goal" and (not {"goal"} <= set(payload) <= {"goal", "origin", "stage_baseline"} or not isinstance(payload["goal"], str)
                or not payload["goal"].strip() or len(payload["goal"]) > 4000):
            raise ValueError("goal_must_contain_1_to_4000_characters")
        if kind == "feedback" and (not {"goal", "mode"} <= set(payload) <= {"goal", "mode", "revision_of", "origin", "parent_id", "stage_baseline", "review_decision"} or not isinstance(payload["goal"], str)
                or not payload["goal"].strip() or len(payload["goal"]) > 4000 or payload["mode"] not in {"insert", "replace"}):
            raise ValueError("feedback_requires_goal_and_explicit_insert_or_replace_mode")
        if kind in {"goal", "feedback"} and (not isinstance(payload.get("origin", "unknown"), str)
                or payload.get("origin", "unknown") not in {"user", "host_review", "unknown"}):
            raise ValueError("goal_origin_must_be_user_host_review_or_unknown")
        if "stage_baseline" in payload and (payload.get("origin") != "host_review" or not isinstance(payload["stage_baseline"], dict)):
            raise ValueError("stage_baseline_requires_host_review")
        if "review_decision" in payload and (payload.get("origin") != "host_review" or payload["review_decision"] not in {"continue", "insert", "revise"}):
            raise ValueError("review_decision_requires_host_review_choice")
        if kind == "feedback" and "parent_id" in payload:
            try:
                uuid.UUID(payload["parent_id"])
            except (ValueError, TypeError, AttributeError):
                raise ValueError("parent_goal_must_be_uuid") from None
        if kind == "feedback" and "revision_of" in payload:
            try:
                uuid.UUID(payload["revision_of"])
            except (ValueError, TypeError, AttributeError):
                raise ValueError("revision_target_must_be_uuid") from None
            if payload["mode"] != "insert":
                raise ValueError("revision_preserves_native_work; use insert mode")
        if kind == "steps" and (set(payload) != {"steps", "queue"}
                or not isinstance(payload["steps"], list) or not 1 <= len(payload["steps"]) <= 32
                or not all(isinstance(step, dict) for step in payload["steps"])
                or payload["queue"] not in {"append", "afterCheckpoint", "now"}):
            raise ValueError("native_steps_or_queue_mode_invalid")
        text = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        if len(text.encode("utf-8")) > 24000:
            raise ValueError("command_too_large")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM commands WHERE id=?", (request_id,)).fetchone()
            if row:
                if row["kind"] != kind or row["payload"] != text:
                    raise ValueError("request_id_conflict")
                return self.result(row)
            if expected_revision is not None and self._intent_revision(db) != expected_revision:
                raise ValueError("intent_revision_changed")
            if "parent_id" in payload and not db.execute("SELECT 1 FROM commands WHERE id=? AND kind IN ('goal','feedback')", (payload["parent_id"],)).fetchone():
                raise ValueError("parent_goal_not_found")
            if kind != "stop" and db.execute("SELECT count(*) FROM commands WHERE state IN ('queued','dispatching','planning','paused')").fetchone()[0] >= 64:
                raise ValueError("command_inbox_full")
            db.execute("INSERT INTO commands VALUES (?, ?, ?, 'queued', NULL, ?)", (request_id, kind, text, time.time()))
            return self.result(db.execute("SELECT * FROM commands WHERE id=?", (request_id,)).fetchone())

    @staticmethod
    def result(row):
        return {"request_id": row["id"], "kind": row["kind"], "delivery": row["state"],
                "planner_report" if row["kind"] in {"goal", "feedback"} else "native_receipt": json.loads(row["receipt"]) if row["receipt"] else None}

    def get(self, request_id):
        if not self.path.exists():
            return None
        with self.connection() as db:
            row = db.execute("SELECT * FROM commands WHERE id=?", (request_id,)).fetchone()
            return self.result(row) if row else None

    def ready(self, allow_goal=True):
        if not self.path.exists():
            return False
        with self.connection() as db:
            return db.execute("SELECT 1 FROM commands WHERE state='queued' AND (kind!='goal' OR ?) LIMIT 1", (allow_goal,)).fetchone() is not None

    def check_uncertain(self):
        if self.path.exists():
            with self.connection() as db:
                if db.execute("SELECT 1 FROM commands WHERE state='dispatching' LIMIT 1").fetchone():
                    raise RuntimeError("outcome_unknown: inspect the dispatching command and original native receipts")

    def claim(self, allow_goal=True):
        if not self.path.exists():
            return None
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM commands WHERE state='queued' AND (kind!='goal' OR ?) ORDER BY CASE kind WHEN 'stop' THEN 0 WHEN 'feedback' THEN 1 ELSE 2 END, rowid LIMIT 1", (allow_goal,)).fetchone()
            if not row:
                return None
            db.execute("UPDATE commands SET state=? WHERE id=?", ("planning" if row["kind"] == "goal" else "dispatching", row["id"]))
            return {"id": row["id"], "kind": row["kind"], "payload": json.loads(row["payload"])}

    def finish(self, request_id, receipt):
        with self.connection() as db:
            db.execute("UPDATE commands SET state='delivered', receipt=? WHERE id=? AND state='dispatching'",
                       (json.dumps(receipt, ensure_ascii=False), request_id))

    def active_goal(self):
        if not self.path.exists():
            return None
        with self.connection() as db:
            row = db.execute("SELECT * FROM commands WHERE state='planning' ORDER BY rowid LIMIT 1").fetchone()
            return {"id": row["id"], "origin": "unknown", **json.loads(row["payload"]),
                    "queue_policy_consumed": bool(row["receipt"] and json.loads(row["receipt"]).get("queue_policy_consumed"))} if row else None

    def goal_lineage(self, request_id):
        """Current-to-parent original goals; old untagged records stay unknown."""
        if not self.path.exists() or not request_id:
            return []
        chain, seen = [], set()
        with self.connection() as db:
            while request_id and request_id not in seen:
                seen.add(request_id)
                row = db.execute("SELECT * FROM commands WHERE id=? AND kind IN ('goal','feedback')", (request_id,)).fetchone()
                if not row:
                    break
                payload = json.loads(row["payload"])
                chain.append({"id": row["id"], "state": row["state"], "origin": "unknown", **payload})
                request_id = payload.get("parent_id") or payload.get("revision_of")
        return chain

    def current_user_goal(self, request_id):
        return next((goal for goal in self.goal_lineage(request_id)
                     if goal["origin"] == "user" and goal["state"] in {"planning", "paused"}), None)

    def reassess_host_stages(self, baseline):
        """Retain immutable proposal/receipts; retire only its current applicability."""
        if not self.path.exists():
            return False
        changed = False
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute("SELECT id,payload FROM commands WHERE state IN ('queued','planning','paused') AND kind IN ('goal','feedback')").fetchall():
                if inapplicable_reason(json.loads(row["payload"]), baseline):
                    db.execute("UPDATE commands SET state='needs_reassessment' WHERE id=?", (row["id"],))
                    changed = True
            if not db.execute("SELECT 1 FROM commands WHERE state='planning'").fetchone():
                db.execute("UPDATE commands SET state='planning' WHERE id=(SELECT id FROM commands WHERE state='paused' ORDER BY rowid DESC LIMIT 1)")
        return changed

    def historical_goal(self, baseline):
        if not self.path.exists():
            return None
        with self.connection() as db:
            row = db.execute("SELECT id,payload FROM commands WHERE state='needs_reassessment' ORDER BY rowid DESC LIMIT 1").fetchone()
            return historical_proposal({"id": row["id"], **json.loads(row["payload"])}, baseline) if row else None

    def retire_host_admission(self, request_id):
        with self.connection() as db:
            db.execute("UPDATE commands SET state='needs_reassessment' WHERE id=? AND state='dispatching'", (request_id,))

    def submit_user_intent(self, kind, payload, request_id):
        """Explicit human entry only; retries cannot relabel pre-upgrade records."""
        if kind not in {"goal", "feedback"}:
            raise ValueError("user_intent_requires_goal_or_feedback")
        if self.path.exists():
            with self.connection() as db:
                row = db.execute("SELECT kind,payload FROM commands WHERE id=?", (request_id,)).fetchone()
            if row and row["kind"] == kind and json.loads(row["payload"]) == payload and "origin" not in payload:
                return self.submit(kind, payload, request_id)
        return self.submit(kind, {**payload, "origin": "user"}, request_id)

    def activate_feedback(self, command):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            revised = command["payload"].get("revision_of")
            if revised:
                row = db.execute("SELECT * FROM commands WHERE id=? AND state IN ('planning','needs_reassessment')", (revised,)).fetchone()
                if not row or json.loads(row["payload"]).get("mode") != "insert":
                    db.execute("UPDATE commands SET state='delivered', receipt=? WHERE id=? AND state='dispatching'",
                               ('{"failed":true,"reason":"revision_target_not_active","verified":false}', command["id"]))
                    return False
                # New UUID and immutable old payload/receipt preserve the audit.
                # This changes one stage, not the paused user-goal stack or body.
                receipt = json.loads(row["receipt"]) if row["receipt"] else {}
                if row["state"] == "needs_reassessment":
                    # Fresh reassessment is a new stage at a native checkpoint.
                    # The resumed user goal stays its retained parent.
                    db.execute("UPDATE commands SET state='paused' WHERE state='planning'")
                    receipt = {}
                db.execute("UPDATE commands SET state='revised' WHERE id=?", (revised,))
                db.execute("UPDATE commands SET state='planning', receipt=? WHERE id=? AND state='dispatching'",
                           (json.dumps({"queue_policy_consumed": bool(receipt.get("queue_policy_consumed"))}), command["id"]))
                return True
            state = "paused" if command["payload"]["mode"] == "insert" else "superseded"
            db.execute("UPDATE commands SET state=? WHERE state='planning'", (state,))
            if state == "superseded":
                db.execute("UPDATE commands SET state='superseded' WHERE state='paused'")
            db.execute("UPDATE commands SET state='planning' WHERE id=? AND state='dispatching'", (command["id"],))
            return True

    def consume_queue_policy(self, request_id):
        with self.connection() as db:
            db.execute("UPDATE commands SET receipt=? WHERE id=? AND state='planning'",
                       ('{"queue_policy_consumed":true}', request_id))

    def resume_goal(self):
        with self.connection() as db:
            db.execute("UPDATE commands SET state='planning' WHERE id=(SELECT id FROM commands WHERE state='paused' ORDER BY rowid DESC LIMIT 1)")
        return self.active_goal()

    def report_goal(self, request_id, report):
        with self.connection() as db:
            db.execute("UPDATE commands SET state=?, receipt=? WHERE id=? AND state='planning'",
                       (report["outcome"], json.dumps(report, ensure_ascii=False), request_id))

    def stop_queued(self):
        # An explicit stop must not leave queued commands for an unexpected restart.
        with self.connection() as db:
            db.execute("UPDATE commands SET state='cancelled' WHERE state IN ('queued','planning','paused')")


def observation(directory: Path):
    path = directory / "status.json"
    if not path.exists():
        return {"phase": "not_observed", "live_verified": False}
    # A persisted snapshot is never proof that its owner is still running.
    return {**json.loads(path.read_text(encoding="utf-8")), "live_verified": False, "source": "last_observed_snapshot"}
