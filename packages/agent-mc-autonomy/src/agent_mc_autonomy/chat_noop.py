"""Bounded review evidence for native public-chat noops, never a dispatch policy."""
import copy
import hashlib
import json
import time
from datetime import datetime


def _reference(value):
    if (not isinstance(value, dict) or not isinstance(value.get("run"), str)
            or not 1 <= len(value["run"]) <= 160 or type(value.get("cursor")) is not int
            or not 0 <= value["cursor"] <= 2**53 - 1
            or not isinstance(value.get("ts"), str) or not 1 <= len(value["ts"]) <= 80):
        return None
    try:
        if datetime.fromisoformat(value["ts"].replace("Z", "+00:00")).tzinfo is None:
            return None
    except ValueError:
        return None
    return {key: value[key] for key in ("run", "cursor", "ts")}


def chat_noop_view(value):
    """Keep the original terminal references, without chat text or invented effects."""
    if (not isinstance(value, dict) or value.get("schema") != "agent-mc-chat-noop-review/v1"
            or type(value.get("native_noops")) is not int or not 2 <= value["native_noops"] <= 10000
            or value.get("window_seconds") != 120 or value.get("physical_effect") != "unknown"
            or value.get("goal_verified") is not False or value.get("new_delivery_verified") is not False):
        return None
    first, latest = _reference(value.get("first_event")), _reference(value.get("latest_event"))
    if first is None or latest is None:
        return None
    return {"schema": "agent-mc-chat-noop-review/v1", "native_noops": value["native_noops"],
            "window_seconds": 120, "first_event": first, "latest_event": latest,
            "physical_effect": "unknown", "goal_verified": False, "new_delivery_verified": False,
            "guidance": "These exact public-chat steps repeatedly ended as native noop. They are not new delivered messages, relief of a need, or goal progress. Use the dated original receipts to reconsider the next useful action or wait for a stated condition. Historical review only; it does not block tools, certify current state, cancel work or authorize replay."}


class ChatNoopReview:
    """At most 16 plan hashes for 120s; missing effects remain unknown."""
    def __init__(self):
        self.rows = {}
        self.scope = None
        self.epoch = None

    def record(self, arguments, execution, scope, epoch, reference):
        if scope != self.scope or epoch != self.epoch:
            self.rows.clear()
            self.scope, self.epoch = scope, epoch
        now = time.monotonic()
        self.rows = {key: row for key, row in self.rows.items() if now - row["started"] < 120}
        steps = arguments.get("steps") if isinstance(arguments, dict) else None
        if (scope is None or not isinstance(steps, list) or not 1 <= len(steps) <= 16
                or any(not isinstance(s, dict) or s.get("skill") != "chat"
                       or not isinstance(s.get("text"), str) or not s["text"].strip()
                       or s["text"].lstrip().startswith("/") or len(s["text"].encode("utf-8")) > 4096
                       for s in steps)):
            return None
        if (not isinstance(execution, dict) or execution.get("kind") != "task"
                or execution.get("terminal") is not True or execution.get("phase") != "completed"
                or not isinstance(execution.get("id"), str) or not execution["id"]):
            return None
        evidence = execution.get("evidence")
        raw = evidence.get("steps") if isinstance(evidence, dict) else None
        ref = _reference(reference)
        if (ref is None or not isinstance(raw, list) or len(raw) != len(steps)
                or any(not isinstance(row, dict) or type(row.get("step")) is not int
                       or row["step"] != i + 1 for i, row in enumerate(raw))):
            return None
        # Narration and queue settings do not make an identical chat plan new.
        key = hashlib.sha256(json.dumps(steps, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
        if any(row.get("outcome") != "noop" or not isinstance(row.get("decision"), dict)
               or row["decision"].get("status") != "noop" for row in raw):
            # A fresh accepted conversation is not part of the noop episode.
            if all(row.get("outcome") == "ok" for row in raw):
                self.rows.pop(key, None)
            return None
        row = self.rows.get(key)
        if row and row["first"]["run"] != ref["run"]:
            row = None
            self.rows.pop(key)
        if row and execution["id"] in row["ids"]:
            return None
        if row is None:
            if len(self.rows) >= 16:
                self.rows.pop(next(iter(self.rows)))
            row = {"started": now, "first": ref, "count": 0, "ids": set()}
            self.rows[key] = row
        row["ids"].add(execution["id"])
        # Cap both metadata and deduplication memory for a pathological episode.
        row["count"] = min(row["count"] + 1, 10000)
        if len(row["ids"]) > 128:
            self.rows.pop(key)
            return None
        return chat_noop_view({"schema": "agent-mc-chat-noop-review/v1", "native_noops": row["count"],
            "window_seconds": 120, "first_event": copy.deepcopy(row["first"]), "latest_event": ref,
            "physical_effect": "unknown", "goal_verified": False, "new_delivery_verified": False})
