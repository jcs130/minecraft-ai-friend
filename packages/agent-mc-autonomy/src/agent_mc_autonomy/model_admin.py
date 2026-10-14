"""Explicit operator checks; never imported by the Minecraft body."""

import asyncio
import json

import httpx

from .model_auth import Authorization
from .planner import HttpPlanner


async def list_models(config, *, client=None):
    owned = client is None
    client = client or httpx.AsyncClient(timeout=30, trust_env=False, follow_redirects=False)
    try:
        async with asyncio.timeout(30):
            headers = await Authorization(config).headers(client)
            async with client.stream("GET", config.base_url.rstrip("/") + "/models", headers=headers, follow_redirects=False) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 2 * 1024 * 1024:
                        raise ValueError("brain_model_catalog_too_large")
                raw = json.loads(data)
        if not isinstance(raw, dict):
            raise ValueError("brain_model_catalog_invalid")
        rows = raw.get("models", raw.get("data", []))
        if not isinstance(rows, list):
            raise ValueError("brain_model_catalog_invalid")
        result = []
        for row in rows[:1000]:
            if not isinstance(row, dict) or row.get("visibility", "list") != "list":
                continue
            identifier = row.get("slug") or row.get("id") or row.get("name")
            if isinstance(identifier, str):
                result.append({"id": identifier.removeprefix("models/"), "label": str(row.get("display_name") or row.get("displayName") or identifier)[:200]})
        return {"models": result, "has_more": bool(raw.get("has_more") or raw.get("nextPageToken") or len(rows) > 1000),
                "inference_called": False, "game_started": False}
    except httpx.HTTPStatusError as error:
        raise RuntimeError(f"brain_catalog_http_{error.response.status_code}") from None
    except (httpx.HTTPError, ValueError, TypeError, TimeoutError):
        raise RuntimeError("brain_catalog_unavailable") from None
    finally:
        if owned:
            await client.aclose()


async def check_model(config, *, client=None, max_output_tokens=2048):
    planner = HttpPlanner(config, max_output_tokens, 30, client=client)
    try:
        response = await planner.decide([{"role": "user", "content": "Connectivity check. Call connection_check once with value=ok. Do not perform any other action."}],
            [{"type": "function", "function": {"name": "connection_check", "description": "Return the fixed check value; performs no action.",
                "parameters": {"type": "object", "properties": {"value": {"type": "string", "enum": ["ok"]}}, "required": ["value"], "additionalProperties": False}}}])
        calls = response.get("tool_calls", [])
        valid = len(calls) == 1 and calls[0]["function"]["name"] == "connection_check" and json.loads(calls[0]["function"]["arguments"]) == {"value": "ok"}
        return {"tool_call_valid": valid, "model_status": response["model_status"], "game_started": False, "gameplay_verified": False}
    finally:
        await planner.aclose()
