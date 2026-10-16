"""One applicability contract for transient host proposals, never user intent."""

from .death_memory import identity, lifecycle, scope_key


def body_baseline(facts, latest_death=None):
    life = lifecycle(facts)
    life = life if isinstance(life, dict) else {}
    return {"scope": scope_key(identity(facts)),
            "lifecycle": {"phase": life.get("phase"), "episodeId": life.get("episodeId")},
            "death_id": latest_death.get("id") if latest_death else None}


def inapplicable_reason(goal, baseline):
    if not goal or goal.get("origin") != "host_review":
        return None
    if not isinstance(goal.get("stage_baseline"), dict):
        return "missing_body_baseline"
    if goal["stage_baseline"] != baseline:
        return "body_episode_changed"
    if not baseline.get("scope") or baseline.get("lifecycle", {}).get("phase") != "alive":
        return "body_baseline_unavailable"
    if baseline.get("death_id") and baseline["lifecycle"].get("episodeId") != baseline["death_id"]:
        return "body_baseline_unavailable"
    return None


def historical_proposal(goal, baseline):
    return {**goal, "historical": True, "applicability": "requires_fresh_review",
            "reason": inapplicable_reason(goal, baseline) or "requires_fresh_review", "verified": False}
