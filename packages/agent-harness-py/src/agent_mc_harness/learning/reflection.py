"""Resident reflection loop (always on when the harness is enabled).

Triggers: ``failure`` (intent failed, or paused by death / safety), ``milestone`` (intent completed) and ``periodic``
(time; reviews the recent window, like cormy sleep-review). Each reflection becomes one ``reflection`` episode in
memory - Graphiti when available, the local store always (MemoryRouter dual-write) - carrying provenance (intent id,
receipt request ids, trigger, signature, reflector). Lessons also enter the versioned StrategyStore as trials the
planner reads; repeated failures of the same method signature queue a Harness² optimization target.

Reflector = System 2 LLM via a configurable OpenAI-compatible endpoint (key read from the env var NAMED by
``api_key_env`` - never stored), with the deterministic reflector as fallback (offline, tests, no key, or error).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from collections import Counter, deque
from collections.abc import Callable, Coroutine
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from ..memory.base import MemoryEpisode
from .strategies import StrategyStore

log = logging.getLogger("agent_mc_harness.reflection")
Trigger = Literal["failure", "milestone", "periodic"]


class ReflectionInput(BaseModel):
    trigger: Trigger
    goal: str
    intent_id: str | None = None
    state: str | None = None
    reason: str | None = None
    receipts: list[dict[str, Any]] = Field(default_factory=list)  # {requestId, verb, status, text}
    events: list[str] = Field(default_factory=list)
    lessons: list[str] = Field(default_factory=list)  # lessons already active (so the reflector can refine, not repeat)
    jitrl: dict[str, Any] | None = None  # JitRL stats for this scope (lowest-return actions etc.), read-only


class Reflection(BaseModel):
    trigger: Trigger
    cue: str = Field(max_length=300)
    lesson: str = Field(max_length=1200)
    confidence: float = Field(ge=0, le=1)
    signature: str
    method_key: str | None = None
    reflector: str
    provenance: dict[str, Any] = Field(default_factory=dict)


class Reflector(Protocol):
    name: str

    async def __call__(self, item: ReflectionInput) -> dict[str, Any] | None: ...


def method_key(item: ReflectionInput) -> str | None:
    """The method a goal exercises: the last attempted unified verb (+ native name / failing tool)."""
    for r in reversed(item.receipts):
        if r.get("verb"):
            return f"method:{r['verb']}"
    return None


def signature(item: ReflectionInput) -> str:
    """Dedupe key: same trigger, goal shape, failing verb/status and normalised error (digits/ids stripped)."""
    last = next((r for r in reversed(item.receipts) if r.get("status") != "completed"), item.receipts[-1] if item.receipts else {})
    err = re.sub(r"[0-9a-f]{8,}|\d+(\.\d+)?", "#", str(last.get("text") or item.reason or "").lower())[:120]
    goal = re.sub(r"\d+(\.\d+)?", "#", item.goal.lower())[:120]
    raw = json.dumps([item.trigger, goal, last.get("verb"), last.get("status"), err], ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class DeterministicReflector:
    """No model: a structured, evidence-only conclusion from receipts. Never invents causes."""
    name = "deterministic"

    async def __call__(self, item: ReflectionInput) -> dict[str, Any] | None:
        bad = [r for r in item.receipts if r.get("status") not in ("completed",)]
        if item.trigger == "failure":
            last = bad[-1] if bad else {}
            what = f"{last.get('verb', 'step')} -> {last.get('status', item.state or 'failed')}"
            why = (last.get("text") or item.reason or "no detail").strip()[:300]
            lesson = (f"When pursuing '{item.goal[:120]}', {what} ({why}). Before retrying, re-observe the body and check the "
                      f"precondition of {last.get('verb', 'that step')}; do not replay an unsettled action.")
            low = (item.jitrl or {}).get("lowestActions") or []
            if low:
                lesson += f" JitRL lowest measured returns here: {low[0]['action']} (mean {low[0]['meanReturn']}, n={low[0]['n']})."
            return {"cue": f"goal like '{item.goal[:80]}' using {last.get('verb', '?')}", "lesson": lesson, "confidence": 0.4}
        if item.trigger == "milestone":
            verbs = " -> ".join(str(r.get("verb")) for r in item.receipts if r.get("status") == "completed")[:300]
            return {"cue": f"goal like '{item.goal[:80]}'", "lesson": f"Completed '{item.goal[:120]}' with {verbs or 'host steps'}; reuse this sequence.",
                    "confidence": 0.5}
        failures = Counter(e.split(":")[0] for e in item.events)
        if not failures:
            return None
        top = ", ".join(f"{k}x{v}" for k, v in failures.most_common(3))
        return {"cue": "periodic review", "lesson": f"Recent notable events: {top}. Prioritise the most frequent failure.", "confidence": 0.3}


class LLMReflector:
    """System 2 reflector over an OpenAI-compatible /chat/completions endpoint (e.g. DeepSeek). JSON-only reply."""
    name = "llm"

    def __init__(self, base_url: str, model: str, api_key_env: str, *, http: Any = None, timeout: float = 30.0) -> None:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", api_key_env):
            raise ValueError("api_key_env must be an environment variable NAME")
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model, self.api_key_env, self.timeout, self._http = model, api_key_env, timeout, http

    @property
    def available(self) -> bool:
        return bool(os.environ.get(self.api_key_env))

    async def __call__(self, item: ReflectionInput) -> dict[str, Any] | None:
        key = os.environ.get(self.api_key_env)
        if not key:
            raise RuntimeError("reflector key not set")
        if self._http is None:
            import httpx
            self._http = httpx.AsyncClient(timeout=self.timeout, trust_env=False)
        prompt = ("You review one Minecraft body task. Using ONLY the evidence, write a reusable lesson. Reply JSON "
                  '{"cue": "<when it applies, <=200 chars>", "lesson": "<what to do differently, <=600 chars>", "confidence": 0..1}. '
                  "Never suggest replaying an action whose result is unknown.\n" + item.model_dump_json()[:8000])
        response = await self._http.post(self.url, headers={"Authorization": f"Bearer {key}"}, json={
            "model": self.model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2,
            "response_format": {"type": "json_object"}, "max_tokens": 400})
        if response.status_code != 200:
            raise RuntimeError(f"reflector HTTP {response.status_code}")
        text = response.json()["choices"][0]["message"]["content"]
        value = json.loads(text[text.find("{"): text.rfind("}") + 1])
        return {"cue": str(value["cue"])[:300], "lesson": str(value["lesson"])[:1200], "confidence": float(value.get("confidence", 0.5))}


class ReflectionLoop:
    def __init__(self, *, memory: Any = None, group_id: Callable[[], str | None] = lambda: None, strategies: StrategyStore | None = None,
                 reflector: Reflector | None = None, fallback: Reflector | None = None, cooldown: float = 600.0,
                 optimize_after: int = 3, on_optimize: Callable[[dict[str, Any]], Coroutine[Any, Any, Any]] | None = None,
                 clock: Callable[[], float] = time.time) -> None:
        self.memory, self.group_id, self.strategies = memory, group_id, strategies
        self.reflector, self.fallback = reflector, fallback or DeterministicReflector()
        self.cooldown, self.optimize_after, self.on_optimize, self.clock = cooldown, optimize_after, on_optimize, clock
        self._seen: dict[str, float] = {}
        self.failures: Counter[str] = Counter()  # method_key -> failure reflections
        self.queue: deque[dict[str, Any]] = deque(maxlen=32)  # Harness² optimization targets
        self.stats: Counter[str] = Counter()
        self.recent: deque[Reflection] = deque(maxlen=50)
        self._tasks: set[asyncio.Task[Any]] = set()

    async def reflect(self, item: ReflectionInput) -> Reflection | None:
        sig = signature(item)
        now = self.clock()
        key = method_key(item)
        if item.trigger == "failure" and key:
            self.failures[key] += 1
            await self._maybe_queue(key, item)
        if now - self._seen.get(sig, -1e18) < self.cooldown:
            self.stats["deduped"] += 1
            return None
        self._seen[sig] = now
        value, used = None, None
        for reflector in (self.reflector, self.fallback):
            if reflector is None:
                continue
            try:
                value = await reflector(item)
                used = reflector.name
                break
            except Exception as error:  # LLM down / no key / bad JSON -> deterministic fallback
                self.stats[f"reflector_error_{reflector.name}"] += 1
                log.info("reflector %s failed: %s", reflector.name, type(error).__name__)
        if not value:
            self.stats["empty"] += 1
            return None
        provenance = {"trigger": item.trigger, "intentId": item.intent_id, "requestIds": [r.get("requestId") for r in item.receipts if r.get("requestId")],
                      "signature": sig, "reflector": used}
        reflection = Reflection(trigger=item.trigger, cue=value["cue"], lesson=value["lesson"], confidence=max(0.0, min(1.0, value["confidence"])),
                                signature=sig, method_key=key, reflector=str(used), provenance={k: v for k, v in provenance.items() if v})
        await self._write(reflection, item)
        self.stats[item.trigger] += 1
        self.recent.append(reflection)
        return reflection

    async def _write(self, reflection: Reflection, item: ReflectionInput) -> None:
        group = self.group_id()
        if self.memory is not None and group:
            body = f"[{reflection.trigger}] cue: {reflection.cue}\nlesson: {reflection.lesson}\nconfidence: {reflection.confidence:.2f}"
            episode = MemoryEpisode(id=f"reflect-{reflection.signature}-{int(self.clock())}", kind="reflection",
                                    name=f"reflection: {item.goal[:60]}", body=body, source_description="harness reflection",
                                    provenance=reflection.provenance)
            out = await self.memory.add(group, episode)
            self.stats["written_graphiti" if isinstance(out.get("graphiti"), dict) and "error" not in out["graphiti"] else "written_local_only"] += 1
        if self.strategies is not None and group and reflection.trigger in ("failure", "milestone") and reflection.method_key:
            self.strategies.propose(f"{group}:lesson:{reflection.method_key}", "lesson",
                                    {"cue": reflection.cue, "lesson": reflection.lesson, "confidence": reflection.confidence},
                                    provenance=reflection.provenance)

    async def _maybe_queue(self, key: str, item: ReflectionInput) -> None:
        if self.failures[key] != self.optimize_after:
            return
        target = {"methodKey": key, "goal": item.goal, "failures": self.failures[key], "queuedAt": self.clock(), "intentId": item.intent_id}
        self.queue.append(target)
        self.stats["optimization_queued"] += 1
        if self.on_optimize is not None:
            task = asyncio.get_running_loop().create_task(self.on_optimize(target))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def periodic(self, events: list[str]) -> Reflection | None:
        return await self.reflect(ReflectionInput(trigger="periodic", goal="periodic review", events=events[-40:]))
