"""Bounded game-only death history in the existing strategic review database."""

import json
import math
import sqlite3
from contextlib import contextmanager


def scope_key(scope):
    if not isinstance(scope, dict) or set(scope) != {"realm", "account", "agent"} or not all(
            isinstance(v, str) and 0 < len(v) <= 500 for v in scope.values()):
        return None
    return json.dumps([scope[k] for k in ("realm", "account", "agent")], ensure_ascii=False)


def identity(facts):
    try:
        value = json.loads(next(p["text"] for p in facts.get("parts", []) if p["key"] == "identity"))
        return value if scope_key(value) else None
    except (StopIteration, KeyError, TypeError, ValueError):
        return None


def lifecycle(facts):
    try:
        return json.loads(next(p["text"] for p in facts.get("parts", []) if p["key"] == "deathLifecycle"))
    except (StopIteration, KeyError, TypeError, ValueError):
        return None


def recovery_state(facts):
    try:
        value = json.loads(next(p["text"] for p in facts.get("parts", []) if p["key"] == "recoveryState"))
        return value if isinstance(value, dict) else {}
    except (StopIteration, KeyError, TypeError, ValueError):
        return {}


def recovery_context(episode, facts, objective=None):
    """Measured displacement is evidence for a choice, never an instruction to return."""
    current = recovery_state(facts)
    old, new = episode.get("position") or {}, current.get("position") or {}
    distance = None
    dimension = old.get("dimension")
    if dimension and dimension == current.get("dimension") and all(
            type(p.get(axis)) in {int, float} and math.isfinite(p[axis]) for p in (old, new) for axis in ("x", "y", "z")):
        distance = round(math.dist([old[a] for a in ("x", "y", "z")], [new[a] for a in ("x", "y", "z")]), 1)
    return {"episode_id": episode["id"], "historical_position": episode.get("position"),
            "current": current, "straight_line_death_distance": distance, "route_distance": None,
            "objective_proposal": objective, "applicability": "requires_fresh_review",
            "next": "Reevaluate the original objective and stage against current spawn position, inventory and native cancellation receipts. "
                    "Earlier coordinates and routes are historical proposals. Explain whether to continue locally, revise or defer the stage, "
                    "or return only if current evidence supports it. Distance is straight-line evidence, not route safety or a command to return."}


TOOL = {"type": "function", "function": {"name": "death_review",
    "description": "Local scoped death history: search/get factual episodes; report an inferred lesson with applicability and evidence. No model, body or network call. Improvement remains unverified.",
    "parameters": {"type": "object", "additionalProperties": False, "required": ["action"], "properties": {
        "action": {"enum": ["search", "get", "report"]}, "id": {"type": "string", "maxLength": 80},
        "query": {"type": "string", "maxLength": 200}, "lesson": {"type": "string", "maxLength": 1200},
        "applicability": {"type": "string", "maxLength": 600}, "evidence": {"type": "string", "maxLength": 600}}}}}


class DeathMemory:
    def __init__(self, directory):
        self.path = directory / "reviews.sqlite3"

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS death_episodes (scope TEXT, id TEXT, body TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope,id))")
                db.execute("CREATE TABLE IF NOT EXISTS death_cursors (scope TEXT, run TEXT, cursor INTEGER, PRIMARY KEY(scope,run))")
                yield db
        finally:
            db.close()

    def record(self, event, facts, recent, receipts, actions):
        meta = event.get("meta") or {}
        death = meta.get("death")
        if (not isinstance(death, dict) or not scope_key(death.get("scope"))
                or not isinstance(death.get("id"), str) or not 0 < len(death["id"]) <= 80
                or not isinstance(event.get("run"), str) or type(event.get("cursor")) is not int
                or not isinstance(event.get("ts"), str)):
            return None
        # Explicit field projection prevents host persona, chat and arbitrary metadata retention.
        episode = {k: death.get(k) for k in ("id", "scope", "observed_at", "position", "health", "food", "cause")}
        episode.update(source_event={k: event[k] for k in ("run", "cursor", "ts")}, historical=True,
                       behavioral_improvement_verified=False, lesson=None)
        same_scope = identity(facts) == death["scope"]
        episode["facts"] = [{k: p[k] for k in ("key", "text", "original") if k in p}
                            for p in facts.get("parts", []) if same_scope and p.get("key") in {"sample", "body", "gear", "life", "queue", "foodReserve", "lastTask", "terrain"}][:8]
        for part in episode["facts"]:
            part["text"] = str(part.get("text", ""))[:500]
        recent, receipts, actions = (recent, receipts, actions) if same_scope else ([], [], [])
        episode["recent_events"] = [{**{k: e[k] for k in ("run", "cursor", "ts", "type") if k in e},
                                     "text": str(e.get("text", ""))[:400]}
                                    for e in recent[-12:] if e.get("type") in {"minecraft.event", "minecraft.task", "minecraft.combat"}]
        episode["receipts"] = [{k: r[k] for k in ("tool", "execution_id", "phase", "receipt", "original_event") if k in r} for r in receipts[-6:]]
        episode["actions"] = actions[-6:]
        key = scope_key(death["scope"])
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT cursor FROM death_cursors WHERE scope=? AND run=?", (key, event["run"])).fetchone()
            if previous and previous[0] >= event["cursor"]:
                return None
            inserted = db.execute("INSERT OR IGNORE INTO death_episodes(scope,id,body) VALUES(?,?,?)",
                                  (key, episode["id"], json.dumps(episode, ensure_ascii=False))).rowcount
            db.execute("INSERT OR REPLACE INTO death_cursors VALUES(?,?,?)", (key, event["run"], event["cursor"]))
            db.execute("DELETE FROM death_cursors WHERE scope=? AND rowid NOT IN (SELECT rowid FROM death_cursors WHERE scope=? ORDER BY rowid DESC LIMIT 64)", (key, key))
            db.execute("DELETE FROM death_episodes WHERE scope=? AND rowid NOT IN (SELECT rowid FROM death_episodes WHERE scope=? ORDER BY rowid DESC LIMIT 32)", (key, key))
        return episode if inserted else None

    def entries(self, scope, *, pending=False):
        key = scope_key(scope)
        if not key:
            return []
        with self.connection() as db:
            rows = [json.loads(r[0]) for r in db.execute(
                "SELECT body FROM death_episodes WHERE scope=? ORDER BY rowid DESC LIMIT 32", (key,))]
            # Legacy notified means transport accepted, not reflection completed.
            return [r for r in rows if not pending or not (r.get("reflection") or r.get("lesson"))]

    def notified(self, episode):
        with self.connection() as db:
            db.execute("UPDATE death_episodes SET notified=1 WHERE scope=? AND id=?", (scope_key(episode["scope"]), episode["id"]))

    @staticmethod
    def validate_reflection(value, episode):
        if not isinstance(value, dict) or set(value) - {"episode_id", "outcome", "lesson", "applicability", "evidence", "reason"}:
            raise ValueError("invalid_death_reflection")
        if not episode or value.get("episode_id") != episode["id"]:
            raise ValueError("death_episode_mismatch")
        outcome = value.get("outcome")
        required = (("lesson", 1200), ("applicability", 600), ("evidence", 600)) if outcome == "lesson" else (("reason", 600),)
        if outcome not in {"lesson", "deferred"} or any(
                not isinstance(value.get(k), str) or not 1 <= len(value[k].strip()) <= size for k, size in required):
            raise ValueError("death_reflection_evidence_or_deferral_required")
        if outcome == "lesson" and not any(ref and ref in value["evidence"] for ref in
                                           (episode["id"], episode["source_event"].get("run"))):
            raise ValueError("death_evidence_must_reference_episode_or_source_run")
        return {"episode_id": episode["id"], "outcome": outcome,
                **{k: value[k].strip() for k, _ in required}, "source_event": episode["source_event"],
                "source": "main_brain_review", "hypothesis": True, "behavioral_improvement_verified": False}

    def context(self, scope, facts=None, objective=None):
        rows = self.entries(scope)
        if not rows:
            return None
        return {"latest_episode": {k: rows[0][k] for k in ("id", "source_event", "observed_at", "position", "health", "food", "cause")},
                **({"recovery": recovery_context(rows[0], facts, objective)} if facts is not None else {}),
                "lessons": [{"episode_id": r["id"], **r["lesson"]} for r in rows if r.get("lesson")][:3],
                "historical": True, "behavioral_improvement_verified": False,
                "next": "Use death_review get(id) to inspect facts and receipts. Review the death in this existing planning turn; record an inferred lesson only with applicability and evidence. Evaluate applicability against fresh facts before reuse."}

    def execute(self, scope, args):
        if not scope_key(scope):
            raise ValueError("No fresh game identity; death history is unavailable")
        action = args.get("action")
        allowed = {"search": {"action", "query"}, "get": {"action", "id"}, "report": {"action", "id", "lesson", "applicability", "evidence"}}
        if action not in allowed or set(args) - allowed[action]:
            raise ValueError("Invalid death_review arguments")
        rows = self.entries(scope)
        if action == "search":
            query = args.get("query", "")
            if not isinstance(query, str) or len(query) > 200:
                raise ValueError("query exceeds 200 characters")
            return {"episodes": [{k: r[k] for k in ("id", "source_event", "observed_at", "position", "cause", "lesson")} for r in rows
                                  if query.casefold() in json.dumps(r, ensure_ascii=False).casefold()][:8], "historical": True}
        row = next((r for r in rows if r["id"] == args.get("id")), None)
        if row is None:
            raise ValueError("Death episode not found in current realm/account/agent")
        if action == "get":
            return row
        for field, size in (("lesson", 1200), ("applicability", 600), ("evidence", 600)):
            if not isinstance(args.get(field), str) or not 1 <= len(args[field].strip()) <= size:
                raise ValueError(field + " is required and bounded")
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            # A host reflection may have committed after the search above.
            # Reread under the write lock rather than replace its whole row
            # with that older snapshot. Completed main-brain lessons win.
            current = db.execute("SELECT body FROM death_episodes WHERE scope=? AND id=?", (scope_key(scope), row["id"])).fetchone()
            if not current:
                raise ValueError("Death episode not found in current realm/account/agent")
            row = json.loads(current[0])
            if (row.get("reflection") or {}).get("outcome") == "lesson":
                return {"saved": False, "episode_id": row["id"], "lesson": row["lesson"],
                        "reason": "main_brain_reflection_completed", "behavioral_improvement_verified": False}
            row["lesson"] = {k: args[k].strip() for k in ("lesson", "applicability", "evidence")}
            row["lesson"].update(source="planner_inference", hypothesis=True, behavioral_improvement_verified=False)
            db.execute("UPDATE death_episodes SET body=? WHERE scope=? AND id=?", (json.dumps(row, ensure_ascii=False), scope_key(scope), row["id"]))
        return {"saved": True, "episode_id": row["id"], "lesson": row["lesson"], "behavioral_improvement_verified": False}
