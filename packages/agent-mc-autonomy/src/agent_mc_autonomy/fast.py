"""Optional typed focus selection. Native reflexes and queues retain action authority."""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

CRITERIA = {
    "survival": "Address observed immediate damage, low health or hunger; preserve native reflexes.",
    "inspect": "Resolve missing facts or a failed action before another attempt.",
    "work": "Continue the current user goal with a useful bounded native task.",
    "wait": "Preserve running native work and wait for its receipt.",
}
QUESTION = {"type": "choice", "instructions": "Select the next planning focus using only current observations. This is advice, not permission to execute an action.", "criteria": CRITERIA}


@dataclass(frozen=True)
class FastSettings:
    mode: str = "rules"
    endpoint: str = ""
    model: str = ""
    api_key_env: str = ""
    min_confidence: float = 0.75

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict) or set(raw) - {"mode", "endpoint", "model", "api_key_env", "min_confidence"}:
            raise ValueError("fast_settings_invalid")
        config = cls(**raw)
        if config.mode not in {"rules", "host", "system_one"}:
            raise ValueError("fast_mode_invalid")
        if any(not isinstance(v, str) or v != v.strip() or any(ord(c) < 32 for c in v)
               for v in (config.endpoint, config.model, config.api_key_env)):
            raise ValueError("fast_text_invalid")
        if not finite_unit(config.min_confidence):
            raise ValueError("fast_confidence_invalid")
        if config.api_key_env and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", config.api_key_env):
            raise ValueError("fast_key_environment_invalid")
        if config.endpoint:
            url = urlsplit(config.endpoint)
            if (url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password
                    or url.query or url.fragment or any(c.isspace() for c in config.endpoint)):
                raise ValueError("fast_endpoint_invalid")
            url.port
            if url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1", "::1"}:
                raise ValueError("fast_remote_endpoint_requires_https")
            if not url.path.endswith("/v1/systemone"):
                raise ValueError("fast_endpoint_requires_systemone_path")
        if config.mode == "system_one" and (not config.endpoint or not config.model):
            raise ValueError("fast_endpoint_and_model_required")
        return config


def finite_unit(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def validate_answer(answer):
    if not isinstance(answer, dict) or answer.get("type") != "choice" or answer.get("choice") not in CRITERIA:
        raise ValueError("fast_invalid_choice")
    probabilities = answer.get("probabilities")
    if (not isinstance(probabilities, dict) or set(probabilities) != set(CRITERIA)
            or not all(finite_unit(p) for p in probabilities.values())
            or abs(sum(probabilities.values()) - 1) > 0.02
            or probabilities[answer["choice"]] < max(probabilities.values())
            or not finite_unit(answer.get("confidence"))):
        raise ValueError("fast_invalid_distribution")
    # Jev confidence is derived from the distribution, not the selected probability.
    return {"choice": answer["choice"], "confidence": answer["confidence"],
            "selected_probability": probabilities[answer["choice"]]}


def focus_state(goal, facts, pending):
    selected = {p["key"]: str(p.get("text", ""))[:320] for p in facts.get("parts", [])
                if p.get("key") in {"body", "place", "foodReserve", "lastTask", "gear"}}
    # Never forward full chat, schema, image data or decision history to a fast model.
    return {"goal": goal[:500], "facts": selected, "native_work_pending": bool(pending)}


def rule_focus(state):
    body = state.get("facts", {}).get("body", "")
    health = re.search(r"(?:生命|health)\s*[:=]?\s*(\d+(?:\.\d+)?)", body, re.I)
    hunger = re.search(r"(?:饥饿|hunger|food)\s*[:=]?\s*(\d+(?:\.\d+)?)", body, re.I)
    if (health and float(health[1]) <= 8) or (hunger and float(hunger[1]) <= 4):
        return "survival"
    if state.get("native_work_pending"):
        return "wait"
    if not body or re.search(r"失败|failed|rejected", state.get("facts", {}).get("lastTask", ""), re.I):
        return "inspect"
    return "work"


class SystemOne:
    """Explicit local Decider or remote Jev-compatible service; no deployment/retry."""

    def __init__(self, config, *, client=None):
        import httpx

        self.config = config
        self.client = client or httpx.AsyncClient(timeout=2, follow_redirects=False, trust_env=False)

    async def select(self, state):
        key = os.environ.get(self.config.api_key_env, "") if self.config.api_key_env else ""
        if self.config.api_key_env and (not key or any(ord(c) < 32 for c in key)):
            raise ValueError("fast_key_unavailable")
        payload = {"model": self.config.model, "questions": {"focus": QUESTION}, "state": state}
        if len(json.dumps(payload, ensure_ascii=False).encode()) > 8192:
            raise ValueError("fast_state_too_large")
        async with self.client.stream("POST", self.config.endpoint,
                headers={"Authorization": "Bearer " + key} if key else {}, json=payload) as response:
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("fast_http_status")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 32768:
                    raise ValueError("fast_response_too_large")
        return json.loads(data)["answers"]["focus"]

    async def aclose(self):
        await self.client.aclose()


class FastPolicy:
    def __init__(self, config, selector=None):
        self.config, self.selector = config, selector
        self.retry_after = 0.0

    async def choose(self, state):
        import httpx

        fallback = {"source": "rules", "choice": rule_focus(state), "advisory_only": True}
        if self.selector is None:
            return {**fallback, "reason": "not_configured" if self.config.mode == "rules" else "provider_unavailable"}
        # Deterministic emergencies and running native work never wait on inference.
        if fallback["choice"] in {"survival", "wait"}:
            return {**fallback, "reason": "native_priority"}
        if time.monotonic() < self.retry_after:
            return {**fallback, "reason": "provider_cooldown"}
        started = time.monotonic()
        try:
            answer = validate_answer(await asyncio.wait_for(self.selector(state), timeout=2))
            if time.monotonic() - started > 5:
                raise ValueError("fast_stale")
            if answer["confidence"] < self.config.min_confidence:
                return {**fallback, "reason": "low_confidence", "confidence": answer["confidence"]}
            return {"source": self.config.mode, **answer, "advisory_only": True,
                    "latency_ms": round((time.monotonic() - started) * 1000)}
        except (TimeoutError, httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
            self.retry_after = time.monotonic() + 60
            return {**fallback, "reason": "provider_failed", "latency_ms": round((time.monotonic() - started) * 1000)}
