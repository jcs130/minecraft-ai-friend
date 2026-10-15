"""Private, host-neutral identity/intent/selected-memory projection for the body."""

import hashlib
import json
import time
from datetime import datetime


def validate_host_context(value):
    allowed = {"agent_name", "persona", "persona_source", "current_intent", "memories", "memories_selected"}
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError("host_context_fields_invalid")
    result = {}
    for key, limit in (("agent_name", 160), ("persona", 2400), ("current_intent", 1600)):
        text = value.get(key, "")
        if not isinstance(text, str) or len(text.encode("utf-8")) > limit or "\x00" in text:
            raise ValueError("host_context_text_invalid")
        result[key] = text.strip()
    if not result["agent_name"]:
        raise ValueError("host_context_identity_required")
    source = value.get("persona_source", "host_projection")
    if source not in {"character_profile", "host_projection"}:
        raise ValueError("host_context_source_invalid")
    result["persona_source"] = source
    result["memories_selected"] = value.get("memories_selected", True)
    if type(result["memories_selected"]) is not bool:
        raise ValueError("host_context_memory_selection_invalid")
    memories = value.get("memories", [])
    if not isinstance(memories, list) or len(memories) > 6:
        raise ValueError("host_context_memory_limit")
    result["memories"] = []
    for row in memories:
        if not isinstance(row, dict) or set(row) != {"id", "source", "text"}:
            raise ValueError("host_context_memory_provenance_required")
        for key, limit in (("id", 160), ("source", 160), ("text", 1800)):
            if not isinstance(row[key], str) or not row[key].strip() or len(row[key].encode("utf-8")) > limit or "\x00" in row[key]:
                raise ValueError("host_context_memory_invalid")
        result["memories"].append(dict(row))
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > 16000:
        raise ValueError("host_context_payload_limit")
    return result


def metadata(value):
    if value is None:
        return {"available": False}
    stable, dynamic = value["stable"], value["dynamic"]
    return {"available": True, "agent_name": stable["agent_name"], "persona_source": stable["persona_source"],
            "persona_bytes": len(stable["persona"].encode("utf-8")), "memory_count": len(dynamic["memories"]),
            "memory_selection": "host_selected" if dynamic.get("memories_selected") else "not_provided",
            "revision": hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]}


class HostContextPort:
    def __init__(self, directory, *, now=time.time):
        self.directory, self.path, self.now = directory, directory / "host-context.json", now

    def publish(self, context, *, session, revision):
        payload = validate_host_context(context)
        issued_at = self.now()
        value = {"schema": "agent-mc-host-context/v1", "session": session, "intent_revision": revision,
                 "issued_at": issued_at, "expires_at": issued_at + 600,
                 "stable": {key: payload[key] for key in ("agent_name", "persona", "persona_source")},
                 "dynamic": {key: payload[key] for key in ("current_intent", "memories", "memories_selected")}}
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)
        return metadata(value)

    def invalidate(self):
        # Do not retain a previous profile after a host opts out or changes role.
        self.path.unlink(missing_ok=True)

    def read(self, revision):
        try:
            if self.path.stat().st_size > 18000:
                return None
            value = json.loads(self.path.read_text(encoding="utf-8"))
            snapshot = json.loads((self.directory / "status.json").read_text(encoding="utf-8"))
            session = str(snapshot.get("owner_pid", "")) + ":" + str((snapshot.get("viewer") or {}).get("session", ""))
            age = self.now() - datetime.fromisoformat(snapshot["updated_at"]).timestamp()
            if (value["schema"] != "agent-mc-host-context/v1" or value["session"] != session
                    or value["intent_revision"] != revision or not 0 <= age <= 30
                    or not value["issued_at"] <= self.now() <= value["expires_at"] <= value["issued_at"] + 600
                    or snapshot.get("phase") != "running" or snapshot.get("game_connected") is not True):
                return None
            validate_host_context({**value["stable"], **value["dynamic"]})
            return {"stable": value["stable"], "dynamic": value["dynamic"]}
        except (OSError, ValueError, TypeError, KeyError):
            return None
