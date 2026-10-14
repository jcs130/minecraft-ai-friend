"""Low-level planning inference; high-level intent arrives through the mailbox."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Protocol

from .perception import has_images, text_only
from .model_config import HttpPlannerConfig
from .model_auth import Authorization
from .model_protocols import decode, request, scope, usage_metrics
from .model_stream import collect


class Planner(Protocol):
    async def decide(self, messages: list[dict], tools: list[dict]) -> dict: ...

    async def aclose(self) -> None: ...


class PlannerResponseError(ValueError):
    """Rejected inference, before any tool from this response can be dispatched."""

    def __init__(self, diagnostic):
        super().__init__("brain_response_invalid_or_incomplete")
        self.diagnostic = diagnostic


def decision(message: dict) -> dict:
    """Reject malformed provider output before the controller can dispatch it."""
    if not isinstance(message, dict) or not isinstance(message.get("content"), (str, type(None))):
        raise ValueError("brain_response_invalid")
    calls = message.get("tool_calls") or []
    if not isinstance(calls, list) or len(calls) > 8:
        raise ValueError("brain_response_invalid")
    if not calls and not (message.get("content") or "").strip():
        raise ValueError("brain_response_empty")
    for call in calls:
        if not isinstance(call, dict):
            raise ValueError("brain_response_invalid")
        function = call.get("function")
        if (call.get("type") != "function" or not isinstance(call.get("id"), str) or not call["id"]
                or not isinstance(function, dict) or not isinstance(function.get("name"), str)
                or not function["name"] or not isinstance(function.get("arguments"), str)):
            raise ValueError("brain_response_invalid")
    if len({call["id"] for call in calls}) != len(calls):
        raise ValueError("brain_response_duplicate_call_id")
    result = {"content": message.get("content"), "tool_calls": calls}
    if isinstance(message.get("reasoning_content"), str):
        result["reasoning_content"] = message["reasoning_content"]
    return result


class HttpPlanner:
    """Explicit provider port. Retries and game ownership belong to the controller."""

    def __init__(self, config: HttpPlannerConfig, max_output_tokens: int, timeout: int, *, client=None, authorization=None,
                 context_counter=None):
        import httpx

        self.config, self.max_output_tokens, self.timeout = config, max_output_tokens, timeout
        self.context_counter = context_counter
        config.validate_budget(max_output_tokens)
        config.key()  # Fail before starting a body when an explicitly named key is missing.
        self.auth = authorization or Authorization(config)
        self.client = client or httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False)

    async def _request(self, messages, tools):
        url, body = request(self.config, messages, tools, self.max_output_tokens)
        headers = await self.auth.headers(self.client)
        async with self.client.stream("POST", url, headers=headers, json=body, follow_redirects=False) as response:
            response.raise_for_status()
            if self.config.stream:
                if "text/event-stream" not in response.headers.get("content-type", ""):
                    raise ValueError("brain_stream_content_type_invalid")
                return await collect(self.config.protocol, response)
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > 8 * 1024 * 1024:
                    raise ValueError("brain_response_too_large")
            return json.loads(raw), None

    async def decide(self, messages: list[dict], tools: list[dict]) -> dict:
        import httpx

        started, payload = time.monotonic(), None
        images = self.config.image_input and has_images(messages)
        try:
            async with asyncio.timeout(self.timeout):
                try:
                    payload, first_output = await self._request(messages if images else text_only(messages), tools)
                except httpx.HTTPStatusError as error:
                    # Preserve the original explicit text fallback for image incompatibility.
                    if not images or error.response.status_code not in {400, 415, 422}:
                        raise
                    images = False
                    payload, first_output = await self._request(text_only(messages), tools)
                message, state, usage = decode(self.config, payload)
                result = decision(message)
                result.pop("reasoning_content", None)  # Kept once in scoped native replay data.
            return {**result, "_provider_state": {"scope": scope(self.config), "data": state},
                    "model_status": {"route": "standalone_vision" if images else "standalone_text", "image_used": images,
                        "provider": self.config.provider, "protocol": self.config.protocol, "model": self.config.model,
                        "stream": self.config.stream, "latency_ms": round((time.monotonic() - started) * 1000),
                        "first_output_ms": round((first_output - started) * 1000) if first_output else None,
                        "usage": usage_metrics(self.config.protocol, usage)}}
        except httpx.HTTPStatusError as error:
            raise RuntimeError(f"brain_http_error_{error.response.status_code}") from None
        except (httpx.HTTPError, TimeoutError):
            raise RuntimeError("brain_transport_error") from None
        except (ValueError, TypeError, KeyError, IndexError, AttributeError):
            diagnostic = {"protocol": self.config.protocol, "reason": "invalid_or_incomplete_response"}
            if self.config.protocol == "chat" and isinstance(payload, dict):
                choices = payload.get("choices")
                diagnostic = {"choice": choices[0] if isinstance(choices, list) and choices else None}
            raise PlannerResponseError(diagnostic) from None

    async def aclose(self) -> None:
        await self.client.aclose()
