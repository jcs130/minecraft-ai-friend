"""Bounded dated comparisons of public project summaries, never a task policy."""
import hashlib

from .review_evidence import encoded, fact_preview, preview


WINDOW_SECONDS = 3600
SAMPLE_SECONDS = 300
MAX_SAMPLES = 8


def fingerprint(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def boundary(current):
    evidence = current["evidence"]
    baseline = evidence["body_baseline"]
    user = evidence.get("current_user_goal") or {}
    # Ordinary host stage revisions are not new user intent. World/run, actual
    # owner session, lifecycle, standing instructions and explicit user lineage
    # are boundaries; no comparison can authorize action on an old baseline.
    return fingerprint([current["session"], baseline, evidence["standing_goal"],
                        user.get("id"), user.get("goal")])


def sample(current, now):
    evidence = current["evidence"]
    facts = evidence["facts"]
    originals = evidence.get("original_facts", {})
    summaries = {key: originals.get(key, facts.get(key, "")) for key in ("goals", "methods")}
    if not any(summaries.values()):
        return None
    row = {"recorded_at": now, "sampled_at": evidence["sampled_at"],
           "summary_fingerprint": fingerprint(summaries),
           **{key: fact_preview(summaries[key], size) for key, size in (("goals", 1200), ("methods", 900))}}
    terminal = next((row for row in reversed(evidence.get("native_outcomes", []))
                     if row.get("terminal") is True and row.get("observation_only") is False), None)
    if terminal:
        row["latest_sampled_terminal"] = preview({key: terminal[key] for key in
            ("execution_id", "phase", "original_event") if key in terminal}, 500)
    return row


def record(state, current, now):
    """Existing body publication writes at most eight samples, with no wakeup."""
    row = sample(current, now)
    if row is None:
        state.pop("project_observation_window", None)
        return
    key = boundary(current)
    previous = state.get("project_observation_window", {})
    same = previous.get("boundary") == key
    rows = [r for r in previous.get("samples", []) if 0 <= now - r["recorded_at"] <= WINDOW_SECONDS] if same else []
    unchanged = (previous.get("unchanged_since", now)
                 if rows and previous.get("latest_fingerprint") == row["summary_fingerprint"] else now)
    if not rows or rows[-1]["summary_fingerprint"] != row["summary_fingerprint"] or now - rows[-1]["recorded_at"] >= SAMPLE_SECONDS:
        rows.append(row)
    if len(rows) > MAX_SAMPLES:
        rows = [rows[0], *rows[-(MAX_SAMPLES - 1):]]
    state["project_observation_window"] = {"boundary": key, "samples": rows,
        "latest_fingerprint": row["summary_fingerprint"], "unchanged_since": max(unchanged, now - WINDOW_SECONDS)}


def view(state, current, now):
    """Read the window plus the fresh snapshot; inspection creates no samples."""
    row = sample(current, now)
    if row is None:
        return None
    window = state.get("project_observation_window", {})
    same = window.get("boundary") == boundary(current)
    rows = [r for r in window.get("samples", []) if 0 <= now - r["recorded_at"] <= WINDOW_SECONDS] if same else []
    if rows and rows[-1]["sampled_at"] == row["sampled_at"]:
        rows[-1] = row
    else:
        rows.append(row)
    if len(rows) > MAX_SAMPLES:
        rows = [rows[0], *rows[-(MAX_SAMPLES - 1):]]
    unchanged = (max(window.get("unchanged_since", now), now - WINDOW_SECONDS)
                 if same and window.get("latest_fingerprint") == row["summary_fingerprint"] else now)
    return {"window_seconds": WINDOW_SECONDS, "sample_interval_seconds": SAMPLE_SECONDS,
        "sampled_summaries_unchanged_seconds": int(now - unchanged), "verified_progress": False,
        "meaning": "Dated sampled native goal/method summaries, not a continuous survey or verified achievement. "
            "Inventory activity may coexist with unchanged milestones. Missing samples are unknown; "
            "latest_sampled_terminal is a reference, not an action count or permission to replay. "
            "Compare actual effects and conditions before choosing to continue, finish, defer or revise a project.",
        "samples": [{**{k: v for k, v in item.items() if k != "summary_fingerprint"},
                     "historical": index != len(rows) - 1} for index, item in enumerate(rows)]}
