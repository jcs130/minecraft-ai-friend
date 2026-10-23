"""Fresh, meaningful commentary signals; no host, model or speech side effects."""

import hashlib
import json
import re
from datetime import datetime

from .observations import body_feedback, feedback_signal, tool_failure_view


def _brief(value, limit):
    raw = str(value or "").encode("utf-8")
    return raw.decode() if len(raw) <= limit else raw[:limit - 3].decode("utf-8", errors="ignore") + "…"


def _band(text, label, boundaries):
    match = re.search(label + r"\s*(\d+(?:\.\d+)?)\s*/", text)
    if not match:
        return None
    value = float(match[1])
    return next((index for index, ceiling in enumerate(boundaries) if value <= ceiling), len(boundaries))


def _task_progress(task):
    """Select actual terminal steps, including successes in a blocked batch.

    Native mixed receipts put successful steps after ``做成的:``. They do not
    say the whole task completed. Keep that distinction in the presentation.
    """
    task = re.split(r"\[背包\]|\[重复尝试记录\]", task, maxsplit=1)[0]
    split = re.split(r"做成的[:：]", task, maxsplit=1)
    partial = len(split) == 2
    successful = split[-1]
    rows = re.split(r"(?=第\s*\d+\s*步\s*\{)", successful)
    useful = []
    for row in rows:
        skills = set(re.findall(r'"skill"\s*:\s*"([a-z_]+)"', row))
        if not skills - {"observe", "find", "check"}:
            continue
        if re.search(r"没做成|失败|未成功|跳过|取消|没跑|本来就是|已经够|无需", row):
            continue
        # A detailed native terminal step has its actual elapsed time/outcome;
        # retain the old compact terminal receipt format as well.
        if "用时" in row or "完成:" in row or "完成：" in row:
            useful.append(row.strip())
    return "\n".join(useful[-2:]), "partial" if partial else "completed"


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
    progress, outcome = _task_progress(task)
    body = str(facts.get("body", ""))
    feedback = body_feedback(snapshot, facts)
    failure = tool_failure_view(snapshot.get("tool_failure"))
    failed = [row for row in feedback["native_outcomes"] if not row["observation_only"] and row["phase"] in {"blocked", "rejected", "partial"}][-1:]
    failure_id = (failed[0]["execution_id"] + ":" + failed[0]["phase"] if failed else
                  json.dumps([failure["tool"], failure["error"], failure["receipt"]], sort_keys=True) if failure else "")
    baseline = {"connected": connected, "phase": phase,
                "session": snapshot.get("session", str(snapshot.get("owner_pid", "")) + ":" + str((snapshot.get("viewer") or {}).get("session", ""))),
                "health": _band(body, "生命", (0, 6, 12)), "hunger": _band(body, "饥饿", (6, 12)),
                "items": items, "progress": hashlib.sha256(progress.encode()).hexdigest() if progress else "",
                "failure": hashlib.sha256(failure_id.encode()).hexdigest() if failure_id else "",
                "body_feedback": feedback_signal({**feedback, "native_outcomes": []}),
                "body_phase": feedback["body_events"][-1]["phase"] if feedback["body_events"] else "inhibited" if feedback["bodyRestriction"] else "",
                "restriction": feedback["bodyRestriction"]}
    # Reviews already carry full inventory and original fact handles for strategy.
    # Presentation needs the current activity and outcome, not another bag dump.
    payload = {"sampled_at": sampled_at, "connected": connected, "phase": phase,
               "error": _brief(snapshot.get("error", snapshot.get("runtime_error", "")), 160),
               "facts": {key: _brief(facts.get(key, ""), size) for key, size in (
                   ("body", 180), ("place", 160), ("queue", 300))},
               "progress": _brief(progress, 420), "task_outcome": outcome if progress else None,
               "body_feedback": {**feedback, "tool_failure": failure},
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
        if baseline["failure"] and baseline["failure"] != previous.get("failure"):
            topics.append("task_failure")
        if baseline["body_feedback"] != previous.get("body_feedback", baseline["body_feedback"]):
            phase = baseline["body_phase"]
            if phase in {"inhibited", "recovered", "stalled"}:
                topics.append("body_" + phase)
            elif previous.get("restriction") and not baseline["restriction"]:
                topics.append("body_recovered")
    urgent = ((baseline["health"] in {0, 1} and (not previous or baseline["health"] != previous.get("health")))
              or (baseline["phase"] == "failed" and previous.get("phase") != "failed"))
    return {"topics": topics, "urgent": urgent}
