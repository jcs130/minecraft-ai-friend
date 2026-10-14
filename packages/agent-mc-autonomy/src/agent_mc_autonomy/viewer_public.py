"""Bounded public playback state; never expose prompts, arguments or host config."""

from datetime import datetime, timezone
import re


def tool_receipt(name, arguments, result):
    steps = arguments.get("steps")
    skills = [step.get("skill", "") for step in steps if isinstance(step, dict)] if isinstance(steps, list) else []
    operation = " → ".join(skill for skill in skills[:8] if isinstance(skill, str) and re.fullmatch(r"[a-z_]{1,40}", skill))
    execution = result.get("execution") or {}
    failed = result.get("failed") is True or execution.get("phase") in {"blocked", "failed", "cancelled"}
    code = "rejected" if failed and not execution else execution.get("phase") if execution.get("terminal") else "queued" if execution else "returned"
    return {"at": datetime.now(timezone.utc).isoformat(), "action": {"type": name[:80], "operation": operation},
            "execution_id": execution.get("id"), "result": {"ok": not failed, "code": code or "terminal", "effectVerified": False}}


def viewer_projection(state, username, session):
    receipt = state.get("viewer_action")
    if receipt:
        receipt = {**receipt, "result": dict(receipt["result"])}
        terminal = state.get("viewer_terminal") or {}
        if terminal.get("terminal") is True and terminal.get("id") == receipt.get("execution_id"):
            phase = terminal.get("phase", "terminal")
            receipt["result"].update(ok=phase not in {"blocked", "failed", "cancelled"}, code=phase)
    mode = "offline" if not state.get("game_connected") else "acting" if state.get("pending") else "observing"
    if state.get("phase") in {"starting", "stopping"}:
        mode = state["phase"]
    action = " / ".join(value for value in ((receipt or {}).get("action") or {}).values() if value)
    return {"schema_version": 1, "session": session, "username": username,
            "updated_at": datetime.now(timezone.utc).isoformat(), "online": state.get("game_connected") is True,
            "mode": mode, "goal": str((state.get("current_goal") or {}).get("goal") or state.get("standing_goal") or "")[:1000],
            "action": action, "receipts": [receipt] if receipt else [],
            "lastDecision": {"at": state.get("viewer_decision_at")} if state.get("viewer_decision_at") else None}
