"""Private, host-neutral identity/intent/selected-memory projection for the body."""

import hashlib
import json
import time
import copy
import uuid
import re
from datetime import datetime

from . import host_recent as recent


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
    result["memories_selected"] = value.get("memories_selected", "memories" in value)
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
            "memory_selection": ("host_selected" if dynamic["memories"] else "host_selected_empty") if dynamic.get("memories_selected") else "not_provided",
            "revision": hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]}


class HostContextPort:
    def __init__(self, directory, *, now=time.time):
        self.directory, self.path, self.now = directory, directory / "host-context.json", now
        self.recent_path = directory / "host-recent-context.json"
        self._originals = {}

    def _recent_status(self, request):
        expected = recent.binding(request, request=True)
        snapshot = json.loads((self.directory / "status.json").read_text(encoding="utf-8"))
        age = self.now() - datetime.fromisoformat(snapshot["updated_at"]).timestamp()
        if (not 0 <= age <= 30 or snapshot.get("phase") != "running" or snapshot.get("game_connected") is not True
                or snapshot.get("runtime_session") != expected["session"]
                or snapshot.get("settings_identity") != expected["identity"]
                or snapshot.get("native_run") != expected["run"]
                or snapshot.get("game_identity") != expected["scope"]
                or snapshot.get("body_death_episode_id") != expected["death_episode_id"]
                or recent.binding(snapshot.get("host_recent_request"), request=True) != expected):
            raise ValueError("recent_status_unavailable")
        host = self.read(expected["intent_revision"])
        if not host or host["stable"]["agent_name"] != expected["actor"]:
            raise ValueError("recent_actor_unavailable")
        return expected

    def publish_recent(self, projection, *, binding):
        """Atomically replace only recent language, without renewing base leases.

        ``binding`` is the complete status.host_recent_request, including as_of.
        The projection embeds its identity fields with as_of omitted.
        """
        try:
            expected = self._recent_status(binding)
            value = recent.validate(projection, expected, self.now(), fit=True)
            self.directory.mkdir(parents=True, exist_ok=True)
            temporary = self.recent_path.with_name("host-recent-" + uuid.uuid4().hex + ".tmp")
            try:
                temporary.write_text(recent.encoded(value), encoding="utf-8")
                # Status can change while validating/writing the temporary file.
                self._recent_status(binding)
                temporary.replace(self.recent_path)
            finally:
                temporary.unlink(missing_ok=True)
            return recent.diagnostics(value, self.now())
        except (OSError, ValueError, KeyError, TypeError, OverflowError):
            return recent.unavailable("publication_rejected")

    def read_recent(self, request):
        try:
            expected = self._recent_status(request)
            payload_limit = recent.FULL_STORAGE_BYTES if expected.get("context_mode") == "full" else recent.STORAGE_BYTES
            if self.recent_path.stat().st_size > payload_limit:
                return recent.unavailable("snapshot_too_large")
            value = json.loads(self.recent_path.read_text(encoding="utf-8"))
            validated = recent.validate(value, expected, self.now())
            self._recent_status(request)
            return validated
        except (OSError, ValueError, KeyError, TypeError, OverflowError):
            return recent.unavailable("snapshot_unavailable")

    def queryable_recent(self, value, request):
        """Mint only for a current validated record; registry is private and bounded."""
        value = recent.validate(value, request, self.now())
        expected = recent.binding(request, request=True)
        self._originals = {h: row for h, row in self._originals.items()
                           if row["binding"] == expected and self.now() <= row["expires_at"]}
        for row in value["recent_messages"]:
            stored = {"binding": expected, "expires_at": min(value["expires_at"], row["occurred_at"] + 600), "record": copy.deepcopy(row)}
            handle = next((h for h, old in self._originals.items() if old == stored), None)
            if handle is None:
                handle = recent.HANDLE_PREFIX + uuid.uuid4().hex
                self._originals[handle] = stored
            row["original_ref"] = {"tool": "mc_original", "handle": handle, "body_queryable": True,
                                   "full_text_available": not row["truncated"]}
        payload_limit = recent.FULL_STORAGE_BYTES if request.get("context_mode") == "full" else recent.STORAGE_BYTES
        while recent.size(self._originals) > payload_limit:
            self._originals.pop(next(iter(self._originals)))
        for row in value["recent_messages"]:
            if row["original_ref"]["handle"] not in self._originals:
                row["original_ref"] = {"body_queryable": False, "reason": "original_budget"}
        return value

    def original_page(self, handle, request, offset, limit):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            return {"status": "unavailable", "reason": "invalid_page"}
        try:
            expected = recent.binding(request, request=True)
            if not isinstance(handle, str) or not re.fullmatch(r"host-context:[a-f0-9]{32}", handle):
                return {"status": "unavailable", "reason": "invalid_handle"}
            saved = self._originals.get(handle)
            if saved is None or saved["binding"] != expected:
                return {"status": "unavailable", "reason": "scope_or_handle"}
            if self.now() > saved["expires_at"]:
                return {"status": "expired"}
            row = saved["record"]
            content = row["text"]
            if offset > len(content):
                return {"status": "unavailable", "reason": "invalid_page"}
            end = min(len(content), offset + limit)
            return {"status": "truncated_original" if row["truncated"] else "available", "handle": handle,
                    "text": content[offset:end], "offset": offset, "next_offset": end, "has_more": end < len(content),
                    "total_characters": len(content), "retained_bytes": len(content.encode()),
                    "text_sha256": row["text_sha256"], "retained_sha256": hashlib.sha256(content.encode()).hexdigest(),
                    "full_text_available": not row["truncated"]}
        except (ValueError, KeyError, TypeError):
            return {"status": "unavailable", "reason": "binding_unavailable"}

    def publish(self, context, *, session, revision):
        payload = validate_host_context(context)
        try:
            old = json.loads(self.path.read_text(encoding="utf-8"))
            if (old["stable"]["agent_name"] != payload["agent_name"] or old["dynamic"]["current_intent"] != payload["current_intent"]
                    or old["session"] != session or old["intent_revision"] != revision):
                self.recent_path.unlink(missing_ok=True)
                self._originals.clear()
        except (OSError, ValueError, KeyError, TypeError):
            pass
        issued_at = self.now()
        value = {"schema": "agent-mc-host-context/v1", "session": session, "intent_revision": revision,
                 "issued_at": issued_at, "expires_at": issued_at + 600,
                 "stable": {key: payload[key] for key in ("agent_name", "persona", "persona_source")},
                 "dynamic": {key: payload[key] for key in ("current_intent", "memories", "memories_selected")}}
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)
        try:
            profile = json.loads((self.directory / "host-character.json").read_text(encoding="utf-8"))
            if profile["stable"]["agent_name"] != payload["agent_name"]:
                self.clear_static()
                self.recent_path.unlink(missing_ok=True)
                self._originals.clear()
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return metadata(value)

    def publish_static(self, context, *, scope):
        """Configured public character only; never renew scoped intent/memory."""
        if not isinstance(context, dict) or set(context) != {"agent_name", "persona", "persona_source"} or context.get("persona_source") != "character_profile":
            raise ValueError("static_character_profile_required")
        payload = validate_host_context(context)
        if not payload["persona"]:
            raise ValueError("static_character_profile_required")
        stable = {key: payload[key] for key in ("agent_name", "persona", "persona_source")}
        issued = self.now()
        value = {"stable": stable, "scope": scope, "issued_at": issued, "expires_at": issued + 600}
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / "host-character.json"
        try:
            previous = json.loads(path.read_text(encoding="utf-8"))
            if previous["stable"]["agent_name"] != stable["agent_name"]:
                self.recent_path.unlink(missing_ok=True)
                self._originals.clear()
        except (OSError, ValueError, KeyError, TypeError):
            pass
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        temporary.replace(path)
        # Actor replacement must not resurrect a previous actor's selected data.
        try:
            old = json.loads(self.path.read_text(encoding="utf-8"))
            if old["stable"]["agent_name"] != stable["agent_name"]:
                self.path.unlink(missing_ok=True)
                self.recent_path.unlink(missing_ok=True)
                self._originals.clear()
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return {"available": True, "persona_source": "character_profile"}

    def clear_static(self):
        (self.directory / "host-character.json").unlink(missing_ok=True)

    def invalidate(self):
        # Do not retain a previous profile after a host opts out or changes role.
        self.path.unlink(missing_ok=True)
        self.clear_static()
        self.recent_path.unlink(missing_ok=True)
        self._originals.clear()

    def _read_dynamic(self, revision):
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

    def read(self, revision):
        dynamic = self._read_dynamic(revision)
        try:
            from .death_memory import scope_key
            path = self.directory / "host-character.json"
            if path.stat().st_size > 5000:
                return dynamic
            profile = json.loads(path.read_text(encoding="utf-8"))
            snapshot = json.loads((self.directory / "status.json").read_text(encoding="utf-8"))
            age = self.now() - datetime.fromisoformat(snapshot["updated_at"]).timestamp()
            if (profile["scope"] != scope_key(snapshot.get("game_identity")) or not 0 <= age <= 30
                    or snapshot.get("phase") != "running" or snapshot.get("game_connected") is not True
                    or not profile["issued_at"] <= self.now() <= profile["expires_at"] <= profile["issued_at"] + 600):
                return dynamic
            stable = profile["stable"]
            validate_host_context(stable)
            if stable["persona_source"] != "character_profile":
                return dynamic
            if dynamic and dynamic["stable"]["agent_name"] != stable["agent_name"]:
                return dynamic  # A freshly accepted actor supersedes an older static binding.
            if dynamic and dynamic["stable"]["agent_name"] == stable["agent_name"]:
                if dynamic["stable"]["persona_source"] == "host_projection" and dynamic["stable"]["persona"]:
                    return dynamic
                return {"stable": stable, "dynamic": dynamic["dynamic"]}
            return {"stable": stable, "dynamic": {"current_intent": "", "memories": [], "memories_selected": False}}
        except (OSError, ValueError, KeyError, TypeError):
            return dynamic
