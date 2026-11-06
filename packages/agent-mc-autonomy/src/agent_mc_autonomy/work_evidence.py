"""Use canonical core review/wait reduction over MCP; never reimplement it here."""
from .bridge import json_content

SCHEMA = "agent-mc/work-evidence/v1"
PROTOCOL = "agent-mc/v1"


async def inspect_work_evidence(bridge, action, arguments):
    field = {"report_review": "reportReviewAction", "execution_wait": "executionWaitAction"}[action]
    tool = next((t for t in bridge.tools if
                 (t.get("_meta", {}).get(PROTOCOL, {}).get("workEvidence") or {}).get(field) == action), None)
    capability = ((tool or {}).get("_meta", {}).get(PROTOCOL, {}).get("workEvidence") or {})
    if (not tool or capability.get("schema") != SCHEMA or capability.get("tool") != tool["name"]
            or capability.get("source") != "caller-supplied"
            or action not in tool.get("inputSchema", {}).get("properties", {}).get("action", {}).get("enum", [])):
        return {"schema": SCHEMA, "available": False, "source": "caller-supplied",
                "mutated": False, "goalCompleted": False, "disposition": "unknown"}
    result = json_content(await bridge.call(tool["name"], {"protocol": PROTOCOL, "action": action, **arguments}))
    valid = (result.get("schema") == SCHEMA and result.get("source") == "caller-supplied"
             and result.get("mutated") is False and result.get("goalCompleted") is False)
    if action == "report_review":
        record = arguments["reportRecord"]
        valid = (valid and result.get("assignmentId") == record.get("assignmentId")
                 and result.get("reportRevision") == record.get("reportRevision")
                 and result.get("disposition") in {"reviewable", "idempotent", "reject"})
    else:
        rows = result.get("candidates")
        valid = (valid and result.get("disposition") in {"unique", "ambiguous", "none"}
                 and isinstance(rows, list)
                 and all(isinstance(row, dict) and row.get("world") == arguments["waitOptions"]["world"]
                         and all(isinstance(row.get(k), str) and row[k] for k in ("world", "kind", "id"))
                         for row in rows))
        if valid:
            valid = ((result["disposition"] == "unique" and len(rows) == 1 and result.get("wait") == rows[0])
                     or (result["disposition"] == "none" and not rows and result.get("wait") is None)
                     or (result["disposition"] == "ambiguous" and len(rows) > 1 and result.get("wait") is None))
    if not valid:
        raise ValueError("Invalid core work evidence response")
    return result
