"""Bounded attributed historical language; never a command or world fact."""

import copy
import hashlib
import json
import math
import re

SCHEMA = "agent-mc-host-recent/v1"
STORAGE_BYTES = 8192
FULL_STORAGE_BYTES = 1048576
TAIL_BYTES = 2400
HANDLE_PREFIX = "host-context:"
BINDING_FIELDS = {"identity", "actor", "session", "run", "scope", "intent_revision", "death_episode_id"}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def size(value):
    return len(encoded(value).encode("utf-8"))


def fields(value, required, optional=()):
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - set(optional):
        raise ValueError("recent_fields_invalid")


def text(value, limit=160, *, nullable=False):
    if nullable and value is None:
        return value
    if not isinstance(value, str) or not value.strip() or any(ord(c) < 32 for c in value) or len(value.encode("utf-8")) > limit:
        raise ValueError("recent_text_invalid")
    return value


def timestamp(value):
    try:
        valid = type(value) in {int, float} and math.isfinite(value) and value >= 0
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("recent_time_invalid")
    return value


def binding(value, *, request=False):
    fields(value, BINDING_FIELDS | ({"as_of"} if request else set()), {"context_mode"})
    if "context_mode" in value and value["context_mode"] != "full":
        raise ValueError("recent_context_mode_invalid")
    for key in ("identity", "actor", "session", "run"):
        text(value[key])
    text(value["death_episode_id"], nullable=True)
    fields(value["scope"], {"realm", "account", "agent"})
    for item in value["scope"].values():
        text(item, 500)
    if type(value["intent_revision"]) is not int or value["intent_revision"] < 0:
        raise ValueError("recent_revision_invalid")
    if request:
        timestamp(value["as_of"])
    return copy.deepcopy({k: value[k] for k in BINDING_FIELDS | ({"context_mode"} if "context_mode" in value else set())})


def unavailable(reason):
    return {"available": False, "reason": reason}


def digest(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("recent_hash_invalid")


def content(value, limit=STORAGE_BYTES):
    # Newlines are legitimate utterance content; provenance tokens are stricter.
    if not isinstance(value, str) or "\x00" in value or len(value.encode("utf-8")) > limit:
        raise ValueError("recent_content_invalid")


def clip(value, limit):
    return value.encode("utf-8")[:limit].decode("utf-8", errors="ignore")


def validate(projection, expected, now, *, fit=False):
    """Strict neutral contract for both injected providers and the atomic port.

    Publication accepts only already-selected records, never a shared-store page.
    It may trim their text/drop optional rows to enforce the combined bound.
    Reads must already satisfy the persisted bound.
    """
    expected = binding(expected, request="as_of" in expected)
    full = expected.get("context_mode") == "full"
    payload_limit = FULL_STORAGE_BYTES if full else STORAGE_BYTES
    fields(projection, {"schema", "binding", "source", "sampled_at", "expires_at", "coverage", "recent_messages", "recent_speech"})
    if projection["schema"] != SCHEMA:
        raise ValueError("recent_schema_invalid")
    if binding(projection["binding"]) != expected:
        raise ValueError("recent_binding_mismatch")
    sampled, expires = timestamp(projection["sampled_at"]), timestamp(projection["expires_at"])
    if not sampled <= now <= expires <= sampled + 30:
        raise ValueError("recent_expired")
    text(projection["source"])
    coverage = projection["coverage"]
    fields(coverage, {"state", "received_count", "limit", "saturated", "selected_count", "omitted_count", "reasons"}, {"arrival_cursor"})
    if not isinstance(coverage["state"], str) or coverage["state"] not in {"available", "empty", "unavailable", "partial"} or type(coverage["saturated"]) is not bool:
        raise ValueError("recent_coverage_invalid")
    for key in ("received_count", "limit", "selected_count", "omitted_count"):
        if type(coverage[key]) is not int or not 0 <= coverage[key] <= 1000000:
            raise ValueError("recent_coverage_invalid")
    if "arrival_cursor" in coverage:
        timestamp(coverage["arrival_cursor"])
    if not isinstance(coverage["reasons"], list) or len(coverage["reasons"]) > 8:
        raise ValueError("recent_coverage_invalid")
    for reason in coverage["reasons"]:
        if not isinstance(reason, str) or not re.fullmatch(r"[a-z0-9_]{1,64}", reason):
            raise ValueError("recent_reason_invalid")
    messages, speech = projection["recent_messages"], projection["recent_speech"]
    if not isinstance(messages, list) or len(messages) > (60 if full else 4) or not isinstance(speech, list) or len(speech) > (60 if full else 3):
        raise ValueError("recent_record_limit")
    if (coverage["selected_count"] != len(messages) + len(speech)
            or coverage["received_count"] != coverage["selected_count"] + coverage["omitted_count"]
            or coverage["limit"] < coverage["received_count"]
            or coverage["state"] in {"empty", "unavailable"} and (messages or speech)
            or coverage["state"] == "available" and not (messages or speech)):
        raise ValueError("recent_coverage_invalid")
    value = copy.deepcopy(projection)
    seen = set()
    for row in value["recent_messages"]:
        fields(row, {"id", "derived_id", "actor", "role", "source", "turn_type", "observed_at", "occurred_at", "clock_source", "text", "text_sha256", "truncated", "original_ref"}, {"conversation_id"})
        for key in ("id", "actor", "source", "turn_type"):
            text(row[key])
        if "conversation_id" in row:
            text(row["conversation_id"], nullable=True)
        if (row["actor"] != expected["actor"] or not isinstance(row["role"], str) or row["role"] not in {"user", "assistant"}
                or not isinstance(row["clock_source"], str) or row["clock_source"] not in {"producer", "arrival"}):
            raise ValueError("recent_provenance_invalid")
        if type(row["derived_id"]) is not bool or type(row["truncated"]) is not bool:
            raise ValueError("recent_provenance_invalid")
        occurred, observed = timestamp(row["occurred_at"]), timestamp(row["observed_at"])
        if not now - 600 <= occurred <= observed <= sampled or row["clock_source"] == "arrival" and occurred != observed:
            raise ValueError("recent_message_time_invalid")
        key = (row["source"], row["id"])
        if key in seen:
            raise ValueError("recent_duplicate_identity")
        seen.add(key)
        content(row["text"], payload_limit)
        digest(row["text_sha256"])
        if not row["truncated"] and hashlib.sha256(row["text"].encode()).hexdigest() != row["text_sha256"]:
            raise ValueError("recent_hash_mismatch")
        # References are descriptive provenance, never paths, URLs or tool handles.
        fields(row["original_ref"], {"source_id", "full_text_available"})
        text(row["original_ref"]["source_id"])
        if type(row["original_ref"]["full_text_available"]) is not bool or row["original_ref"]["full_text_available"] == row["truncated"]:
            raise ValueError("recent_original_invalid")
        if not full and len(row["text"].encode()) > 1600:
            if not fit:
                raise ValueError("recent_text_limit")
            row["text"], row["truncated"] = clip(row["text"], 1600), True
            row["original_ref"]["full_text_available"] = False
    for row in value["recent_speech"]:
        fields(row, {"actor", "source", "session", "run", "scope", "opportunity_id", "decision_id", "offered_at", "receipt_state", "text_sha256", "text_available", "playback_verified"}, {"speech_id", "text", "text_boundary", "truncated"})
        for key in ("actor", "source", "session", "run", "opportunity_id", "decision_id"):
            text(row[key])
        if "speech_id" in row:
            text(row["speech_id"], nullable=True)
        if any(row[key] != expected[key] for key in ("actor", "session", "run", "scope")):
            raise ValueError("recent_speech_binding_mismatch")
        key = (row["source"], row["opportunity_id"], row["decision_id"])
        if key in seen:
            raise ValueError("recent_duplicate_identity")
        seen.add(key)
        if not now - 300 <= timestamp(row["offered_at"]) <= sampled:
            raise ValueError("recent_speech_time_invalid")
        if (not isinstance(row["receipt_state"], str) or row["receipt_state"] not in {"accepted", "unknown", "rejected", "failed"}
                or type(row["text_available"]) is not bool or row["playback_verified"] is not False):
            raise ValueError("recent_speech_receipt_invalid")
        digest(row["text_sha256"])
        if row["text_available"]:
            if row.get("text_boundary") != "owned_sanitized_submission" or type(row.get("truncated", False)) is not bool:
                raise ValueError("recent_speech_boundary_invalid")
            content(row.get("text"), payload_limit)
            if not row.get("truncated") and hashlib.sha256(row["text"].encode()).hexdigest() != row["text_sha256"]:
                raise ValueError("recent_hash_mismatch")
            if not full and len(row["text"].encode()) > 600:
                if not fit:
                    raise ValueError("recent_text_limit")
                row["text"], row["truncated"] = clip(row["text"], 600), True
        elif {"text", "text_boundary", "truncated"} & row.keys():
            raise ValueError("recent_speech_text_unavailable")
    value["recent_messages"].sort(key=lambda r: (r["occurred_at"], r["source"], r["id"]))
    value["recent_speech"].sort(key=lambda r: (r["offered_at"], r["opportunity_id"], r["decision_id"]))
    if fit:
        while size(value) > payload_limit and drop_oldest(value):
            pass
    if size(value) > payload_limit:
        raise ValueError("recent_payload_limit")
    return value


def drop_oldest(value):
    """Prefer newer language but protect the latest eligible user utterance."""
    messages, speech = value["recent_messages"], value["recent_speech"]
    latest_user = next((r for r in reversed(messages) if r["role"] == "user"), None)
    candidates = [(r["occurred_at"], messages, r) for r in messages if r is not latest_user]
    candidates += [(r["offered_at"], speech, r) for r in speech]
    if not candidates:
        return False
    _, rows, row = min(candidates, key=lambda item: item[0])
    rows.remove(row)
    coverage = value["coverage"]
    coverage["selected_count"] -= 1
    coverage["omitted_count"] += 1
    coverage["state"] = "partial"
    if "combined_budget" not in coverage["reasons"]:
        coverage["reasons"] = (coverage["reasons"] + ["combined_budget"])[-8:]
    return True


def select_recent_messages(records, *, binding, sampled_at, source):
    """Select newest four validated neutral records, protecting the latest user.

    Adapters discard ineligible/unmatched shared-store records before calling.
    This accepts at most 60 neutral candidates; it never persists the candidate
    list. Distinct IDs with identical wording remain distinct occurrences.
    """
    if not isinstance(records, list) or len(records) > 60:
        raise ValueError("recent_candidates_invalid")
    validated = []
    for row in records:
        single = {"schema": SCHEMA, "binding": binding, "source": source,
                  "sampled_at": sampled_at, "expires_at": sampled_at + 30,
                  "coverage": {"state": "available", "received_count": 1, "limit": 1,
                               "selected_count": 1, "omitted_count": 0, "saturated": False, "reasons": []},
                  "recent_messages": [row], "recent_speech": []}
        validated.extend(validate(single, binding, sampled_at, fit=True)["recent_messages"])
    validated.sort(key=lambda r: (r["occurred_at"], r["source"], r["id"]))
    selected = validated if binding.get("context_mode") == "full" else validated[-4:]
    latest_user = next((r for r in reversed(validated) if r["role"] == "user"), None)
    if latest_user is not None and latest_user not in selected:
        selected[0] = latest_user
        selected.sort(key=lambda r: (r["occurred_at"], r["source"], r["id"]))
    return selected


def diagnostics(value, now):
    if not value or value.get("available") is False:
        return value or unavailable("not_provided")
    return {"available": value["coverage"]["state"] != "unavailable", "age_seconds": round(now - value["sampled_at"], 3),
            "coverage": copy.deepcopy(value["coverage"]), "messages": len(value["recent_messages"]), "speech": len(value["recent_speech"])}


def tail_projection(value, now):
    result = {key: copy.deepcopy(value[key]) for key in ("source", "sampled_at", "coverage", "recent_messages", "recent_speech")}
    result["age_seconds"] = round(now - value["sampled_at"], 3)
    return result
