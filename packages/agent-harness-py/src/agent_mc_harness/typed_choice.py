"""Async client for the typed-choice ``/systemone`` protocol (System 1).

Request ``{model, state, questions: {key: {type:'choice', instructions, criteria:{id: text}}}}`` ->
``{answers: {key: {choice, confidence, probabilities}}, model?, latency_ms?, usage?}``.
Port of cormy-private-bot runtime/providers/system-one/native.ts + runtime/typed-decision.ts ``parseTypedChoice``
(accepts top-probability and above-chance confidence conventions; callers threshold ``choice_probability``).
One request, no retries, no text coercion; the CALLER owns deadlines and stale-scene checks. The same service is
what world/survival/system_one.py, agent_mc_autonomy/fast.py, numen-hosting ``systemOne`` and the touhou-maids
MaidGuardDecision call (local ``http://127.0.0.1:<port>/v1/systemone`` or the official Jev endpoint).
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit


@dataclass(frozen=True)
class TypedChoice:
    choice: str
    confidence: float
    choice_probability: float
    probabilities: dict[str, float]


def _p(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def parse_typed_choice(value: Any, keys: list[str]) -> TypedChoice | None:
    if not isinstance(value, dict) or not isinstance(value.get("probabilities"), dict):
        return None
    probs = value["probabilities"]
    if (value.get("type", "choice") != "choice" or value.get("choice") not in keys or not _p(value.get("confidence"))
            or len(probs) != len(keys) or not all(k in probs and _p(probs[k]) for k in keys)):
        return None
    if abs(sum(probs[k] for k in keys) - 1) > 0.02:
        return None
    choice = value["choice"]
    top = probs[choice]
    if max(probs.values()) - top > 0.000001:
        return None
    above = 1.0 if len(keys) == 1 else max(0.0, (top - 1 / len(keys)) / (1 - 1 / len(keys)))
    if min(abs(value["confidence"] - top), abs(value["confidence"] - above)) > 0.01:
        return None
    return TypedChoice(choice, float(value["confidence"]), float(top), {k: float(probs[k]) for k in keys})


class SystemOneClient:
    """``endpoint`` must be loopback http ending in /systemone or an https URL. The key is read from the env var
    *named* ``api_key_env`` (or a file path) at request time and only sent to https or loopback endpoints."""

    def __init__(self, endpoint: str, model: str, *, api_key_env: str | None = None, api_key_file: str | None = None,
                 http: Any = None, timeout: float = 2.0) -> None:
        url = urlsplit(endpoint)
        if url.username or url.password or url.query or url.fragment or not url.path.rstrip("/").endswith("/systemone"):
            raise ValueError("system_one_endpoint_invalid")
        if url.scheme == "http" and url.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("system_one_remote_endpoint_requires_https")
        if url.scheme not in ("http", "https"):
            raise ValueError("system_one_endpoint_invalid")
        if not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,100}", model):
            raise ValueError("system_one_model_invalid")
        if api_key_env and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", api_key_env):
            raise ValueError("system_one_key_env_invalid")
        self.endpoint, self.model, self.api_key_env, self.api_key_file, self.timeout = endpoint, model, api_key_env, api_key_file, timeout
        self._http = http

    def _key(self) -> str | None:
        if self.api_key_env:
            return os.environ.get(self.api_key_env) or None
        if self.api_key_file:
            with open(self.api_key_file, encoding="ascii") as stream:
                return stream.read(1025).strip() or None
        return None

    async def request(self, state: dict[str, Any], questions: dict[str, dict[str, Any]]) -> dict[str, Any]:
        for q in questions.values():
            if q.get("type") != "choice" or not q.get("instructions") or len(q.get("criteria") or {}) < 2:
                raise ValueError("invalid choice question")
        body = {"model": self.model, "state": state, "questions": questions}
        if len(json.dumps(body, ensure_ascii=False).encode()) > 8192:
            raise ValueError("system_one_state_too_large")
        key = self._key()
        headers = {"Authorization": "Bearer " + key} if key else {}
        if self._http is None:
            import httpx
            self._http = httpx.AsyncClient(timeout=self.timeout, trust_env=False, follow_redirects=False)
        response = await self._http.post(self.endpoint, json=body, headers=headers)
        if response.status_code != 200:
            raise RuntimeError(f"decision_http_{response.status_code}")
        data = response.json()
        answers = {}
        for name, q in questions.items():
            parsed = parse_typed_choice((data.get("answers") or {}).get(name), list(q["criteria"]))
            if parsed is None:
                raise ValueError("invalid decision response")
            answers[name] = parsed
        return {"answers": answers, "model": data.get("model") if isinstance(data.get("model"), str) else None,
                "usage": data.get("usage") if isinstance(data.get("usage"), dict) else None}

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
