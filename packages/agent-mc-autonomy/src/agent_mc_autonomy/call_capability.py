"""Cross-language consumption of canonical core capabilities, without policy copies."""

from .bridge import json_content

SCHEMA = "agent-mc/call-capability/v1"
PROTOCOL = "agent-mc/v1"


async def inspect_call(bridge, name, arguments):
    unknown = {"schema": SCHEMA, "tool": name, "valid": False, "available": None,
               "readOnly": None, "backgroundLearning": None, "reason": "unsupported", "dispatched": False}
    tool = next((t for t in bridge.tools if t.get("name") == name), None)
    if not tool:
        return {**unknown, "reason": "unknown_tool"}
    capability = (tool.get("_meta", {}).get(PROTOCOL) or {}).get("callCapabilities")
    if (not isinstance(capability, dict) or capability.get("schema") != SCHEMA
            or capability.get("action") != "inspect_call"
            or capability.get("tool") not in {t.get("name") for t in bridge.tools}):
        return unknown
    result = json_content(await bridge.call(capability["tool"], {
        "protocol": PROTOCOL, "action": "inspect_call", "tool": name, "arguments": arguments}))
    if (result.get("schema") != SCHEMA or result.get("tool") != name or result.get("dispatched") is not False
            or type(result.get("valid")) is not bool
            or any(result.get(key) is not None and type(result[key]) is not bool
                   for key in ("available", "readOnly", "backgroundLearning"))
            or result.get("reason") not in {"declared", "unknown_tool", "invalid_arguments", "classification_unavailable"}
            or (result.get("reason") != "declared" and any(result.get(k) is True for k in ("readOnly", "backgroundLearning")))):
        raise ValueError("Invalid core call capability response")
    return result


async def resolve_work(bridge, references):
    protocol = next((t for t in bridge.tools if "resolve_work" in
                     t.get("inputSchema", {}).get("properties", {}).get("action", {}).get("enum", [])), None)
    if not protocol:
        return {"protocol": PROTOCOL, "adopted": False, "available": False,
                "resolutions": [{"reference": r, "state": None, "disposition": "unknown"} for r in references]}
    result = json_content(await bridge.call(protocol["name"], {
        "protocol": PROTOCOL, "action": "resolve_work", "references": references}))
    rows = result.get("resolutions")
    if (result.get("protocol") != PROTOCOL or result.get("adopted") is not False
            or not isinstance(rows, list) or len(rows) != len(references)
            or any(not isinstance(row, dict) or row.get("reference") != reference
                   or row.get("disposition") not in {"active", "retire", "unknown", "conflict"}
                   for row, reference in zip(rows, references))):
        raise ValueError("Invalid core work resolution response")
    return result
