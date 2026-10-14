"""Bounded public playback state; never expose prompts, arguments or host config."""

from datetime import datetime, timezone
import json
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


def record_playback(state, values):
    """Keep only public action outcomes; repeated status publication adds nothing."""
    history = list(state.get("viewer_history") or [])[-20:]
    receipt = values.get("viewer_action")
    if receipt and (not history or receipt != history[-1]):
        history.append(receipt)
    terminal = values.get("viewer_terminal") or {}
    if terminal.get("terminal") is True and terminal.get("id"):
        previous = next((row for row in reversed(history) if row.get("execution_id") == terminal["id"]), None)
        phase = terminal.get("phase")
        if previous and previous["result"].get("code") != phase:
            history.append({**previous, "at": datetime.now(timezone.utc).isoformat(), "result": {
                "ok": phase not in {"blocked", "failed", "cancelled"}, "code": phase, "effectVerified": False}})
    failure = values.get("tool_failure")
    if isinstance(failure, dict):
        # Native/schema diagnostics can include private arguments. Publish a
        # stable category, not the raw error or planner recovery instructions.
        schema = str(failure.get("error", "")).startswith("Invalid arguments:")
        notice = "工具参数校验未通过；未派发到游戏" if schema else "操作遇到错误；完整回执保留在本地"
        if (history and history[-1].get("execution_id") is None and history[-1]["result"].get("ok") is False
                and history[-1]["action"].get("type") == str(failure.get("tool", ""))[:80]):
            history[-1] = {**history[-1], "notice": notice}
        else:
            history.append({"at": datetime.now(timezone.utc).isoformat(), "action": {
            "type": str(failure.get("tool", ""))[:80], "operation": ""}, "execution_id": None,
                "result": {"ok": False, "code": "rejected" if schema else "failed", "effectVerified": False}, "notice": notice})
    state["viewer_history"] = history[-20:]


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
    playback = {"timeline": list(state.get("viewer_history") or [])[-20:], "queue": []}
    for execution in (state.get("pending") or [])[:12]:
        if isinstance(execution, dict):
            row = {key: str(execution[key])[:120] for key in ("id", "kind", "phase", "operation") if execution.get(key) is not None}
            known = next((item for item in reversed(playback["timeline"]) if execution.get("id") and item.get("execution_id") == execution["id"]), None)
            if "operation" not in row and known:
                row["operation"] = str(known["action"].get("operation", ""))[:120]
            playback["queue"].append(row)
    value = {"schema_version": 1, "session": session, "username": username,
            "updated_at": datetime.now(timezone.utc).isoformat(), "online": state.get("game_connected") is True,
            "mode": mode, "goal": str((state.get("current_goal") or {}).get("goal") or state.get("standing_goal") or "")[:1000],
            "action": action, "receipts": [receipt] if receipt else [],
            "lastDecision": {"at": state.get("viewer_decision_at")} if state.get("viewer_decision_at") else None,
            "playback": playback}
    while len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > 15000 and playback["timeline"]:
        playback["timeline"].pop(0)
    return value
