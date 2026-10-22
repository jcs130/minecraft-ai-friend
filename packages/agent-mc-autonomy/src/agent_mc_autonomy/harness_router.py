"""Explicit UHP planning adapter; Minecraft actions stay with the sole coordinator."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from .model_config import endpoint, environment, secret, text
from .perception import text_only
from .planner import PlannerResponseError, decision
from .model_protocols import usage_metrics


INSTRUCTIONS = """You are the planning backend of an existing Minecraft Agent coordinator.
The supplied messages contain its instructions, user goal, historical tool exchanges and current facts.
The supplied tools are DECISION SCHEMAS, not tools installed inside this harness.
Do not execute Minecraft commands, connect to a game, launch another controller or claim to execute an action.
Select the next calls for the coordinator to validate and execute. Return ONLY one JSON object:
{"content":null,"tool_calls":[{"id":"unique-call-id","type":"function","function":{"name":"an advertised tool","arguments":"a JSON object encoded as a string"}}]}
Use at most eight calls, immediate reads first and at most one action last. A text-only reply may use
{"content":"short reply","tool_calls":[]}. No Markdown fences. Never invent tool results or game progress.
Only the latest supplied facts describe current state. Historical memories remain attributed history.
"""


@dataclass(frozen=True)
class HarnessRouterConfig:
    base_url: str = ""
    harness_id: str = ""
    model: str = ""
    api_key_env: str = "HARNESSROUTER_API_KEY"
    max_step: int = 4
    poll_seconds: float = 0.5

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict) or set(raw) - cls.__dataclass_fields__.keys():
            raise ValueError("harness_config_invalid")
        value = cls(**raw)
        endpoint(value.base_url)
        text(value.harness_id, "harness_id", empty=False)
        text(value.model, "model", empty=False)
        if len(value.harness_id) > 128 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-" for c in value.harness_id):
            raise ValueError("harness_id_invalid")
        environment(value.api_key_env)
        if not value.api_key_env:
            raise ValueError("harness_key_environment_required")
        if type(value.max_step) is not int or not 1 <= value.max_step <= 64:
            raise ValueError("harness_step_budget_invalid")
        if type(value.poll_seconds) not in {int, float} or not 0.1 <= value.poll_seconds <= 5:
            raise ValueError("harness_poll_interval_invalid")
        return value

    def key(self):
        return secret(self.api_key_env)

    def validate_budget(self, budget):
        if type(budget) is not int or not 128 <= budget <= 131072:
            raise ValueError("brain_output_budget_invalid")


def finite_json(text):
    def reject(_):
        raise ValueError("non_finite_json")
    return json.loads(text, parse_constant=reject)


def decode_plan(payload, tools):
    if not isinstance(payload, dict) or payload.get("status") != "completed":
        raise ValueError("harness_response_not_completed")
    fragments = []
    for item in payload.get("output", []):
        if item.get("type") == "message" and item.get("role", "assistant") == "assistant":
            for part in item.get("content", []):
                if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                    fragments.append(part["text"])
    result = finite_json("".join(fragments))
    if not isinstance(result, dict) or set(result) - {"content", "tool_calls"}:
        raise ValueError("harness_plan_shape_invalid")
    # UHP output is text, so some harness/model combinations return a JSON
    # object instead of Chat's JSON-encoded argument string. Canonicalize only
    # this representation; original native schemas still validate every value.
    calls = result.get("tool_calls")
    if isinstance(calls, list):
        for call in calls:
            function = call.get("function") if isinstance(call, dict) else None
            if isinstance(function, dict) and isinstance(function.get("arguments"), dict):
                function["arguments"] = json.dumps(function["arguments"], ensure_ascii=False, allow_nan=False)
    result = decision(result)
    allowed = {tool["function"]["name"] for tool in tools}
    for call in result["tool_calls"]:
        if call["function"]["name"] not in allowed or not isinstance(finite_json(call["function"]["arguments"]), dict):
            raise ValueError("harness_plan_tool_invalid")
    return result


class HarnessRouterPlanner:
    """A fresh UHP task per decision; portable context is supplied by our host.

    UHP's request tools field is reserved/ignored, so schemas travel as data and
    the final JSON is validated before the existing native queue sees any call.
    A cancelled/failed harness can therefore never independently mutate the body.
    """

    def __init__(self, config, max_output_tokens, timeout, *, client=None, journal: Path | None = None):
        import httpx
        config.validate_budget(max_output_tokens)
        config.key()
        self.config, self.max_output_tokens, self.timeout = config, max_output_tokens, timeout
        self.client = client or httpx.AsyncClient(timeout=timeout, trust_env=False, follow_redirects=False)
        self.journal = journal
        self.response_id = None
        self.lock = asyncio.Lock()

    def headers(self, request_id=None):
        result = {"Authorization": "Bearer " + self.config.key(), "UHP-Version": "2026-09-28"}
        if request_id:
            result["Idempotency-Key"] = request_id
        return result

    def record(self, request_id, **fields):
        if self.journal:
            self.journal.parent.mkdir(parents=True, exist_ok=True)
            with self.journal.open("a", encoding="utf-8") as output:
                output.write(json.dumps({"request_id": request_id, "harness_id": self.config.harness_id,
                    "model": self.config.model, "recorded_at": time.time(), **fields}, ensure_ascii=False) + "\n")

    async def request(self, method, path, **kwargs):
        raw = bytearray()
        async with self.client.stream(method, self.config.base_url.rstrip("/") + path,
                                      follow_redirects=False, **kwargs) as response:
            response.raise_for_status()
            if not 200 <= response.status_code < 300:
                raise ValueError("harness_redirect_refused")
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("harness_response_too_large")
            return json.loads(raw)

    async def inspect(self):
        """Explicit discovery only. Does not invoke a model or connect a game."""
        import httpx
        try:
            return await self.request("GET", "/v1/uhp", headers=self.headers())
        except (httpx.HTTPError, ValueError):
            raise RuntimeError("harness_discovery_failed") from None

    async def cancel(self, response_id):
        if not isinstance(response_id, str) or not response_id.startswith("resp_") or not all(c.isalnum() or c in "_-" for c in response_id):
            raise ValueError("harness_response_id_invalid")
        return await self.request("POST", "/v1/responses/" + response_id + "/cancel", headers=self.headers())

    async def decide(self, messages, tools):
        async with self.lock:
            return await self._decide(messages, tools)

    async def _decide(self, messages, tools):
        import httpx
        request_id, started = str(uuid.uuid4()), time.monotonic()
        portable = [{key: value for key, value in row.items() if key in {"role", "content", "tool_calls", "tool_call_id"}}
                    for row in text_only(messages)]
        body = {"input": json.dumps({"messages": portable, "tools": tools}, ensure_ascii=False, allow_nan=False),
                "instructions": INSTRUCTIONS, "metadata": {"harness_id": self.config.harness_id},
                "model": self.config.model, "stream": False, "background": True,
                "max_step": self.config.max_step, "max_output_tokens": self.max_output_tokens,
                "timeout_seconds": self.timeout}
        self.response_id = None
        self.record(request_id, phase="submitting", body_dispatched=False)
        try:
            async with asyncio.timeout(self.timeout):
                payload = await self.request("POST", "/v1/responses", headers=self.headers(request_id), json=body)
                response_id = payload.get("id")
                if not isinstance(response_id, str) or not response_id.startswith("resp_") or not all(c.isalnum() or c in "_-" for c in response_id):
                    raise ValueError("harness_response_id_invalid")
                self.response_id = response_id
                self.record(request_id, phase="accepted", response_id=response_id, body_dispatched=False)
                while payload.get("status") in {"queued", "in_progress", "running"}:
                    await asyncio.sleep(self.config.poll_seconds)
                    payload = await self.request("GET", "/v1/responses/" + response_id, headers=self.headers())
                    if payload.get("id") != response_id:
                        raise ValueError("harness_response_identity_mismatch")
                if payload.get("status") in {"failed", "cancelled"}:
                    code = (payload.get("error") or {}).get("code")
                    self.record(request_id, phase="failed", response_id=response_id,
                                status=payload["status"], error_code=code if isinstance(code, str) and code.isidentifier() else None,
                                body_dispatched=False)
                    # A refused model/backend is not a malformed tool proposal;
                    # do not turn it into the controller's automatic JSON repair loop.
                    raise RuntimeError("harness_task_failed_no_game_dispatch")
                if payload.get("model") and payload["model"] != self.config.model:
                    raise ValueError("harness_model_substitution_refused")
                result = decode_plan(payload, tools)
            self.record(request_id, phase="completed", response_id=response_id, body_dispatched=False)
            return {**result, "model_status": {"route": "harnessrouter", "provider": "harnessrouter", "protocol": "uhp",
                    "harness_id": self.config.harness_id,
                    "model": self.config.model, "response_id": response_id, "request_id": request_id,
                    "latency_ms": round((time.monotonic() - started) * 1000), "image_used": False,
                    "usage": usage_metrics("responses", payload.get("usage") or {})}}
        except asyncio.CancelledError:
            await self._abandon(request_id, "cancelled")
            raise
        except httpx.HTTPStatusError as error:
            await self._abandon(request_id, "http_error")
            raise RuntimeError(f"harness_http_error_{error.response.status_code}") from None
        except (httpx.HTTPError, TimeoutError):
            await self._abandon(request_id, "transport_unknown")
            raise RuntimeError("harness_transport_error_no_game_dispatch") from None
        except (ValueError, TypeError, KeyError, AttributeError):
            await self._abandon(request_id, "invalid_response")
            raise PlannerResponseError({"protocol": "uhp", "reason": "invalid_or_incomplete_plan", "body_dispatched": False}) from None

    async def _abandon(self, request_id, phase):
        confirmed = False
        if self.response_id:
            try:
                async with asyncio.timeout(3):
                    result = await self.cancel(self.response_id)
                    confirmed = result.get("status") in {"cancelled", "completed", "failed", "incomplete"}
            except Exception:
                pass
        self.record(request_id, phase=phase, response_id=self.response_id, cancellation_confirmed=confirmed, body_dispatched=False)

    async def aclose(self):
        await self.client.aclose()
