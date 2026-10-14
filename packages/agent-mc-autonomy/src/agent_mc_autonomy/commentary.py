"""Fresh, meaningful commentary signals; no host, model or speech side effects."""

import hashlib
import json
import re
from datetime import datetime


def _brief(value, limit):
    raw = str(value or "").encode("utf-8")
    return raw.decode() if len(raw) <= limit else raw[:limit - 3].decode("utf-8", errors="ignore") + "…"


def _band(text, label, boundaries):
    match = re.search(label + r"\s*(\d+(?:\.\d+)?)\s*/", text)
    if not match:
        return None
    value = float(match[1])
    return next((index for index, ceiling in enumerate(boundaries) if value <= ceiling), len(boundaries))


def commentary_observation(status, now):
    """Project native facts or a review envelope, retaining originals at their source.

    Item counts, durability, movement, task IDs and read-only task completion do
    not create speaking opportunities. A candidate is evidence, never a spoken
    script, goal completion or playback receipt.
    """
    snapshot = status.get("observation", status)
    sampled_at = snapshot.get("updated_at", snapshot.get("sampled_at"))
    try:
        sampled = datetime.fromisoformat(sampled_at).timestamp()
    except (TypeError, ValueError):
        return None
    if not 0 <= now - sampled <= 30:
        return None
    connected = snapshot.get("game_connected", snapshot.get("connected")) is True
    phase = snapshot.get("phase")
    if not connected and phase not in {"failed", "stopped"}:
        return None
    source = snapshot.get("facts") or {}
    facts = ({part["key"]: str(part.get("text", "")) for part in source["parts"]}
             if isinstance(source.get("parts"), list) else source)
    if connected and not any(facts.get(key) for key in ("body", "gear", "queue")):
        return None
    gear = str(facts.get("gear", ""))
    bag = gear.partition("包里")[2].partition("鼠标")[0]
    items = sorted(set(name.strip() for name in re.findall(
        r"([^、，,：:；;。]+?)(?:\s+耐久\s*\d+/\d+)?\s*[×x]\s*\d+", bag)))
    task = str(facts.get("lastTask", ""))
    skills = set(re.findall(r'"skill"\s*:\s*"([a-z_]+)"', task))
    useful_task = (bool(skills - {"observe", "find", "check"}) and "完成" in task
                   and not re.search(r"失败|未成功|跳过|取消", task))
    body = str(facts.get("body", ""))
    baseline = {"connected": connected, "phase": phase,
                "session": snapshot.get("session", str(snapshot.get("owner_pid", "")) + ":" + str((snapshot.get("viewer") or {}).get("session", ""))),
                "health": _band(body, "生命", (0, 6, 12)), "hunger": _band(body, "饥饿", (6, 12)),
                "items": items, "progress": hashlib.sha256(task.encode()).hexdigest() if useful_task else ""}
    # Reviews already carry full inventory and original fact handles for strategy.
    # Presentation needs the current activity and outcome, not another bag dump.
    payload = {"sampled_at": sampled_at, "connected": connected, "phase": phase,
               "error": _brief(snapshot.get("error", snapshot.get("runtime_error", "")), 160),
               "facts": {key: _brief(facts.get(key, ""), size) for key, size in (
                   ("body", 180), ("place", 160), ("queue", 300))},
               "progress": _brief(task, 420) if useful_task else "",
               "viewer_url": status.get("viewer_url", ""),
               "viewer_binding_verified": status.get("viewer_body_binding_verified", False)}
    signature = hashlib.sha256(json.dumps(baseline, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {"signature": signature, "baseline": baseline, "payload": payload}


def commentary_changes(current, previous):
    """Compare observations without interpreting a planner's claim as progress."""
    baseline = current["baseline"]
    topics = []
    previous = previous or {}
    if not previous or baseline["session"] != previous.get("session"):
        topics = ["session_started"]
    else:
        if (baseline["connected"], baseline["phase"]) != (previous.get("connected"), previous.get("phase")):
            topics.append("connection_changed")
        for key in ("health", "hunger"):
            if baseline[key] is not None and baseline[key] != previous.get(key):
                topics.append(key + "_changed")
        if set(baseline["items"]) - set(previous.get("items", [])):
            topics.append("new_resources")
        if baseline["progress"] and baseline["progress"] != previous.get("progress"):
            topics.append("task_progress")
    urgent = ((baseline["health"] in {0, 1} and (not previous or baseline["health"] != previous.get("health")))
              or (baseline["phase"] == "failed" and previous.get("phase") != "failed"))
    return {"topics": topics, "urgent": urgent}
