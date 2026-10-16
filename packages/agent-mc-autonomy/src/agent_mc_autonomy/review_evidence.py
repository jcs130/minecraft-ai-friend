"""Bounded host views with immutable, lossless original evidence pages."""

import hashlib
import json
import re
import uuid


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def completion_contract(review_id, reference, *, pending_death, legacy=None):
    """Describe the smallest final transaction without choosing for the host."""
    contract = {
        "required": {"heartbeat_id": review_id, "decision": ["continue", "insert", "revise"],
                     "reason": "One short factual clause from inspected evidence."},
        "goal": "Required only for insert/revise; a concise stage within user intent and standing goal.",
        "constraints": "World-specific capabilities require fresh evidence, not unrelated memories. "
            "Revise requires stage_delivery.can_revise. "
            "For a reassessable historical_goal, continue revalidates it on this baseline; revise replaces it.",
    }
    if legacy:
        contract["required"] = {"heartbeat_id": review_id, **legacy["choice"]}
        contract["constraints"] = "Resubmit the exact original choice; only reflection completes. No goal, speech or context replay."
        contract.pop("goal")
        pending_death = not legacy["reflection_already_saved"]
    if pending_death:
        contract["death_reflection"] = {
            "required": {"evidence_ref": reference},
            "one_of": [
                {"outcome": "lesson", "lesson": "Short evidence-based lesson.",
                 "applicability": "Short condition where it applies."},
                {"outcome": "deferred", "reason": "Short honest reason evidence is insufficient."},
            ],
        }
    return contract


def preview(value, limit):
    """Bound any section in wire bytes; originals are separately queryable."""
    raw = encoded(value).encode()
    if len(raw) <= limit:
        return value
    # A JSON string may escape characters again, so measure the actual envelope.
    text = raw[:limit // 2].decode("utf-8", errors="ignore")
    while len(encoded({"preview": text, "abridged": True}).encode()) > limit:
        text = text[:-1]
    return {"preview": text, "abridged": True}


def save(directory, review, lineage, last_decision):
    value = {"heartbeat_id": review["id"], "session": review["session"], "scope": review["scope"],
             "intent_revision": review["revision"], "evidence": review["evidence"],
             "goal_lineage": lineage, "last_decision": last_decision}
    raw = encoded(value)
    reference = hashlib.sha256(raw.encode()).hexdigest()[:24]
    folder = directory / "review-evidence"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (reference + ".json")
    if path.exists():
        if path.read_text(encoding="utf-8") != raw:
            raise ValueError("review_evidence_collision")
    else:
        temporary = folder / (reference + "." + uuid.uuid4().hex + ".tmp")
        try:
            temporary.write_text(raw, encoding="utf-8")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return reference


def detail(directory, heartbeat_id, reference, path=None, offset=0):
    """Character offsets over canonical JSON; concatenate pages for exact data.

    These historical reads never inspect a current body or acknowledge a review.
    Only the already public review envelope is stored, never private host context.
    """
    path = [] if path is None else path
    if (not isinstance(reference, str) or not re.fullmatch(r"[0-9a-f]{24}", reference)
            or not isinstance(path, list) or len(path) > 16
            or any(type(key) not in {str, int} or (isinstance(key, str) and len(key) > 160)
                   or (type(key) is int and key < 0) for key in path)
            or type(offset) is not int or offset < 0):
        return {"is_error": True, "error": "invalid_evidence_query"}
    try:
        value = json.loads((directory / "review-evidence" / (reference + ".json")).read_text(encoding="utf-8"))
        if value["heartbeat_id"] != heartbeat_id:
            raise ValueError()
        provenance = {key: value[key] for key in ("heartbeat_id", "intent_revision")}
        provenance["scope_digest"] = hashlib.sha256(encoded(value["scope"]).encode()).hexdigest()[:24]
        sampled = value["evidence"]["sampled_at"]
        for key in path:
            value = value[key]
        raw = encoded(value)
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return {"is_error": True, "error": "evidence_not_found"}
    end = min(len(raw), offset + 768)
    return {"evidence_ref": reference, "provenance": provenance, "sampled_at": sampled,
            "historical": True, "grants_inspection": False, "path": path, "offset": offset,
            "json_chunk": raw[offset:end], "next_offset": end, "has_more": end < len(raw),
            "encoding": "Concatenate json_chunk strings in offset order, then parse JSON."}


def compact(evidence, reference):
    result = {key: preview(evidence[key], limit) for key, limit in (
        ("sampled_at", 100), ("phase", 60), ("connected", 30), ("standing_goal", 750),
        ("current_user_goal", 850), ("current_goal", 850), ("historical_goal", 850), ("pending", 750), ("facts", 3200),
        ("body_baseline", 800), ("tool_failure", 1200), ("planner_error", 400),
        ("runtime_error", 400), ("read_activity", 400), ("death_recovery", 1500),
        ("unactioned_replies", 30), ("planner_retry_seconds", 30), ("material_unchanged_seconds", 30))
        if key in evidence and evidence[key] not in (None, "", [], {})}
    # Retain success and failure counts/samples together, rather than slicing a
    # long raw receipt before its successful tail. All outcomes remain in detail.
    result["native_outcomes"] = []
    for index, row in list(enumerate(evidence.get("native_outcomes", [])))[-3:]:
        steps = row.get("step_outcomes") or {}
        result["native_outcomes"].append({
            **{key: preview(row[key], 180) for key in ("execution_id", "phase", "terminal", "observation_only", "goal_verified", "tool", "original_event") if key in row},
            "receipt": preview(row.get("receipt", ""), 420),
            "step_outcomes": {key: steps[key] for key in ("status", "counts", "mixed", "valid", "invalid", "omitted") if key in steps},
            "samples": preview(steps.get("samples", []), 700), "detail_path": ["evidence", "native_outcomes", index]})
    result["body_events"] = preview(evidence.get("body_events", [])[-2:], 700)
    if episode := evidence.get("death_episode"):
        result["death_episode"] = {key: preview(episode[key], 300) for key in
            ("id", "source_event", "observed_at", "position", "health", "food", "cause") if key in episode}
        result["death_episode"].update(historical=True, evidence_ref=reference)
        preview_rows = []
        for index, row in enumerate(episode.get("combat_observations", [])[:2]):
            item = {k: row[k] for k in ("id", "reason", "swings", "original_event")}
            item["detail_path"] = ["evidence", "death_episode", "combat_observations", index]
            if summary := row.get("controlSummary"):
                item.update({k: summary[k] for k in ("finalMode", "enteredDesperate")})
                if retreat := summary.get("retreat"):
                    item.update({k: retreat[k] for k in ("bankCandidate", "routeStatus", "movement")})
            if len(encoded([*preview_rows, item]).encode()) <= 1800:
                preview_rows.append(item)
        if preview_rows:
            result["death_episode"]["combat_observations"] = preview_rows
            result["death_episode"]["combat_observations_omitted"] = len(episode.get("combat_observations", [])) - len(preview_rows)

    result["evidence_ref"] = reference
    result["details"] = {"available": True, "query": "inspect with evidence_ref, detail_path (array of keys/indices), detail_offset; pages are historical JSON, never a fresh inspection."}
    return result
