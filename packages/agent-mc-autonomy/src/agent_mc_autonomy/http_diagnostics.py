"""Bounded provider-error classification; arbitrary response text never escapes."""
import json

LIMIT = 16 * 1024


async def rejection(response):
    raw = bytearray()
    async for chunk in response.aiter_bytes():
        raw.extend(chunk[:LIMIT - len(raw)])
        if len(raw) >= LIMIT:
            break
    text = raw.decode("utf-8", errors="replace").lower()
    try:
        payload = json.loads(text)
        detail = payload.get("error", payload) if isinstance(payload, dict) else {}
        if isinstance(detail, dict):
            text = " ".join(str(detail.get(key, "")) for key in ("code", "type", "message"))
    except (ValueError, TypeError):
        pass
    category = "provider_request_rejected"
    if "duplicate" in text and any(word in text for word in ("tool", "function")):
        category = "duplicate_tool_name"
    elif "schema" in text and any(word in text for word in ("items", "parameters", "properties")):
        category = "tool_schema_incompatible"
    elif any(word in text for word in ("context_length", "context length", "context window", "too many tokens")):
        category = "context_limit"
    elif response.status_code == 401 or "unauthorized" in text or "api key" in text and "invalid" in text:
        category = "credentials_rejected"
    elif response.status_code == 403:
        category = "model_access_denied"
    return {"category": category, **({"body_truncated": True} if len(raw) >= LIMIT else {})}
