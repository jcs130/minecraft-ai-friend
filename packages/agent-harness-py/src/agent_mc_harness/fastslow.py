"""Scheduler tiers: native reflexes/rules -> System 1 (Jev typed choice, optional) -> System 2 LLM planner.

Everything decision-related is REUSED; this module only adapts body data to the existing functions:

* tier 0, reflexes/rules - ``agent_mc_autonomy.fast``: ``focus_state`` + ``FastPolicy`` (``rule_focus``; optional typed
  focus over /v1/systemone). ``survival``/``wait`` mean the native body owns the moment (low HP/hunger, native work
  running): the harness does not decide or act this tick.
* routing - ``world/survival/adaptive_router.route``: L0 SKIP / L1 FAST / L2 THINK / L3 PLAN.
* tier 1, System 1 - ``world/survival/system_one.SystemOne.choose`` (2-8 candidates with exact tool/args, <=2 KB
  context, validated against ``numen_gateway.TOOLS``, confidence >= 0.75) run on ``policy_worker.PolicyWorker`` (one
  thread, one in-flight request); result re-verified with ``policy_worker.same_body`` against a fresh snapshot; 5 s
  deadline, otherwise escalate to System 2.
* tier 2, System 2 - the harness ``Planner`` hook, with the budget profile from
  ``agent_mc_autonomy.decision_profiles.DecisionSettings.select`` (routine vs complex).
* learning hooks (interface only this round) - JitRL step re-scoring (agent-mc-world core/jitrl.ts ``reweightJitRl``)
  and Harness2 method episodes (agent-mc-world bridges/harness2/worker.py).
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from ._reuse import autonomy, survival
from .models import ActionReceipt, BodySnapshot

Tier = Literal["host", "reflex", "system1", "system2"]
ThinkingTier = Literal["no_think", "normal", "complex"]
REASONING = {"immediate": "no_think", "routine": "normal", "deliberate": "complex"}  # cormy ATTENTION.md answers.reasoning
LEVEL_TIER = {0: "no_think", 1: "no_think", 2: "normal", 3: "complex"}

# Unified verb -> survivor numen_gateway.TOOLS name (System 1 candidates must name an exact gateway tool).
VERB_TO_GATEWAY_TOOL = {"move": "goto", "mine": "mine", "craft": "craft", "eat": "eat", "equip": "equip_item", "cast": "game_cast",
                        "place": "place_block", "transfer": "transfer_items", "interact": "interact_at"}


class Candidate(BaseModel):
    """A System 1 option: an exact harness step plus a short criterion for the typed choice."""
    id: str = Field(pattern=r"^[A-Za-z0-9_]{1,32}$")
    description: str = Field(min_length=1, max_length=300)
    step: dict[str, Any]  # {"tool": "body:<verb>", "args": {...}}
    prior: float = Field(default=0.0, ge=0, le=1)  # optional host prior; uniform when any is 0


class Route(BaseModel):
    level: int
    level_name: str
    reason: str
    score: float
    should_call_llm: bool
    signals: dict[str, float] = Field(default_factory=dict)


class Decision(BaseModel):
    tier: Tier
    steps: list[dict[str, Any]] | None = None
    defer: str | None = None  # native owns the moment: don't decide now
    route: Route | None = None
    focus: dict[str, Any] | None = None
    profile: dict[str, Any] | None = None
    system1: dict[str, Any] | None = None
    requested_tier: ThinkingTier | None = None
    effective_tier: ThinkingTier | None = None


def body_view(snapshot: BodySnapshot, body_id: str | None, *, busy: bool = False) -> dict[str, Any]:
    """BodySnapshot -> the survivor body dict that system_one.compact_state / policy_worker.same_body read."""
    return {"ok": True, "observedAt": snapshot.sampled_at.timestamp() * 1000, "bodyUuid": body_id, "dimension": snapshot.dimension,
            "hp": snapshot.health, "maxHp": snapshot.max_health, "hunger": snapshot.food, "position": snapshot.position,
            "task": {"busy": busy, "state": "busy" if busy else "idle"},
            "counts": snapshot.inventory if isinstance(snapshot.inventory, dict) and all(isinstance(v, int) for v in snapshot.inventory.values()) else None}


def perception_view(snapshot: BodySnapshot, *, hostiles: int = 0, under_attack: bool = False, pending_message: bool = False) -> dict[str, Any]:
    """BodySnapshot -> the perception dict adaptive_router.route reads."""
    dim = (snapshot.dimension or "minecraft:overworld").split(":")[-1]
    return {"hp": snapshot.health if snapshot.health is not None else 20, "dimension": dim, "nearby_hostiles": hostiles,
            "under_attack": under_attack, "party_message_pending": pending_message}


def facts_view(snapshot: BodySnapshot, last_receipt: ActionReceipt | None, native_busy: bool) -> dict[str, Any]:
    """BodySnapshot -> the facts {parts:[{key,text}]} shape agent_mc_autonomy.fast.focus_state reads."""
    body = f"health={snapshot.health} food={snapshot.food} dimension={snapshot.dimension}" if snapshot.health is not None else (snapshot.text or "")
    parts = [{"key": "body", "text": body[:320]}]
    if last_receipt is not None:
        parts.append({"key": "lastTask", "text": f"{last_receipt.verb} {last_receipt.status}"})
    if native_busy:
        parts.append({"key": "nativeWork", "text": "running"})
    return {"parts": parts}


def observation(snap: BodySnapshot) -> Any:
    """BodySnapshot -> JitRL Observation (None when position/health/food/dimension are not all measured)."""
    from .learning.jitrl import Observation
    p = snap.position
    if p is None or snap.health is None or snap.food is None or not snap.dimension:
        return None
    inv = snap.inventory if isinstance(snap.inventory, dict) and all(isinstance(v, int) for v in snap.inventory.values()) else {}
    return Observation(dimension=snap.dimension, health=snap.health, food=snap.food, position=(p["x"], p["y"], p["z"]), inventory=inv,
                       at=snap.sampled_at.timestamp())


class LearningHooks(Protocol):
    """Experience sink (Harness2 method lessons etc.)."""

    async def record(self, intent_id: str, decision: Decision, receipts: list[ActionReceipt]) -> None:
        """Experience for JitRL books / Harness2 method lessons (bridges/harness2/worker.py)."""


@dataclass
class FastSlowConfig:
    use_router: bool = True
    focus: dict[str, Any] = field(default_factory=lambda: {"mode": "rules"})  # agent_mc_autonomy FastSettings
    system_one: dict[str, Any] | None = None  # {"endpoint": "http://127.0.0.1:8090/v1/systemone", "model": "jev-...", "api_key_file": path}
    decision: dict[str, Any] | None = None  # agent_mc_autonomy DecisionSettings raw (enabled, budgets)
    max_output_tokens: int = 1024
    system_one_deadline: float = 5.0
    min_confidence: float = 0.75
    jitrl_min_posterior: float = 0.7  # with beta=0.5 and 2 uniform candidates the posterior ceiling is ~0.731
    jitrl_min_samples: int = 2


class FastSlow:
    def __init__(self, config: FastSlowConfig | None = None, *, system_one_factory: Callable[[], Any] | None = None,
                 focus_selector: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None,
                 learning: LearningHooks | None = None, typed: Any = None, jitrl: Any = None, clock: Callable[[], float] = time.time) -> None:
        self.config = config or FastSlowConfig()
        self.jitrl = jitrl  # learning.jitrl.JitRL (AGENT_HARNESS_PY_JITRL), action-selection hook
        self.typed = typed  # typed_choice.SystemOneClient: generic candidates (non-gateway bodies) + thinking-tier judge
        fast = autonomy("fast")
        self._fast = fast
        settings = fast.FastSettings.parse(self.config.focus)
        self.focus_policy = fast.FastPolicy(settings, focus_selector)
        profiles = autonomy("decision_profiles")
        self.decisions = profiles.DecisionSettings.parse(self.config.decision, self.config.max_output_tokens) if self.config.decision else None
        self.router = survival("adaptive_router") if self.config.use_router else None
        self.learning, self.clock = learning, clock
        self.worker = None
        if system_one_factory is not None or self.config.system_one:
            pw = survival("policy_worker")
            if system_one_factory is None:
                so = survival("system_one")
                cfg = self.config.system_one or {}

                def system_one_factory() -> Any:
                    return so.SystemOne(endpoint=cfg.get("endpoint"), model=cfg.get("model"), api_key_file=cfg.get("api_key_file"))
            self.worker = pw.PolicyWorker(system_one_factory)
            self._same_body = pw.same_body
        self.history: dict[str, Any] = {"recent_receipts": [], "last_perception": {}}
        self.last_plan_at = 0.0

    def close(self) -> None:
        if self.worker is not None:
            self.worker.close()

    def note(self, receipt: ActionReceipt) -> None:
        rows = self.history["recent_receipts"]
        rows.append({"status": receipt.status})
        del rows[:-10]

    def route(self, snapshot: BodySnapshot, goal: str, **perception: Any) -> Route | None:
        if self.router is None:
            return None
        view = perception_view(snapshot, **perception)
        out = self.router.route(view, self.history, {"current_target": goal}, [], self.last_plan_at, self.clock())
        self.history["last_perception"] = view
        return Route(**{k: out[k] for k in ("level", "level_name", "reason", "score", "should_call_llm")}, signals=out.get("signals", {}))

    async def focus(self, goal: str, snapshot: BodySnapshot, last: ActionReceipt | None, native_busy: bool) -> dict[str, Any]:
        state = self._fast.focus_state(goal, facts_view(snapshot, last, native_busy), [])
        return dict(await self.focus_policy.choose(state))

    def profile(self, focus: str | None, *, failure: bool = False, death: bool = False, feedback: bool = False) -> dict[str, Any] | None:
        return None if self.decisions is None else self.decisions.select(focus=focus, failure=failure, feedback=feedback, death=death)

    def jitrl_rank(self, candidates: list[Candidate], goal: str, snap: BodySnapshot, scope: str | None) -> dict[str, Any] | None:
        """JitRL action-selection hook: reorder by posterior; advisory only."""
        if self.jitrl is None or scope is None or (obs := observation(snap)) is None:
            return None
        try:
            return dict(self.jitrl.rank(scope=scope, goal=goal, obs=obs,
                                        candidates=[{"id": c.id, "step": c.step, "prior": c.prior} for c in candidates] if all(c.prior for c in candidates)
                                        else [{"id": c.id, "step": c.step} for c in candidates]))
        except ValueError:
            return None

    async def system1(self, candidates: list[Candidate], goal: str, before: BodySnapshot, body_id: str | None,
                      fresh: Callable[[], Awaitable[BodySnapshot]], question: str = "Choose the next action for the current goal.",
                      scope: str | None = None) -> dict[str, Any]:
        """One typed choice. ok=False means escalate to System 2 (never a retry loop). JitRL (if on) reorders the
        candidates first; when no typed-choice service answers, a JitRL suggestion with >= 2 retrieved samples and
        posterior >= jitrl_min_posterior may decide instead (same premise re-check)."""
        if not 2 <= len(candidates) <= 8:
            return {"ok": False, "code": "system_one_needs_2_to_8_candidates"}
        ranked = self.jitrl_rank(candidates, goal, before, scope)
        if ranked is not None:
            post = {c["id"]: c["posterior"] for c in ranked["candidates"]}
            candidates = sorted(candidates, key=lambda c: -post.get(c.id, 0))
        result = await self._system1(candidates, goal, before, body_id, fresh, question)
        if ranked is not None:
            result["jitrl"] = {k: ranked[k] for k in ("baseChoice", "suggestedChoice", "suggestedPosterior", "sampleSize", "taskKey")}
            if not result.get("ok") and result.get("code") in ("system_one_not_configured", "policy_unavailable", "policy_timeout", "policy_busy") \
                    and ranked["sampleSize"] >= self.config.jitrl_min_samples and ranked["suggestedPosterior"] >= self.config.jitrl_min_posterior:
                if self._premise_same(body_view(before, body_id), body_view(await fresh(), body_id)):
                    chosen = next(c for c in candidates if c.id == ranked["suggestedChoice"])
                    return {**result, "ok": True, "provider": "jitrl", "choice": chosen.id, "step": chosen.step, "confidence": ranked["suggestedPosterior"]}
                return {**result, "code": "policy_premise_changed"}
        return result

    async def _system1(self, candidates: list[Candidate], goal: str, before: BodySnapshot, body_id: str | None,
                       fresh: Callable[[], Awaitable[BodySnapshot]], question: str) -> dict[str, Any]:
        gateway = all(str(c.step.get("tool", "")).removeprefix("body:") in VERB_TO_GATEWAY_TOOL for c in candidates)
        if self.worker is None or not gateway:
            return await self._typed_choice(candidates, goal, before, body_id, fresh, question)
        proposal = {"question": question[:500], "candidates": [
            {"id": c.id, "description": c.description,
             "action": ({"tool": VERB_TO_GATEWAY_TOOL[verb], "args": c.step.get("args", {})}
                        if (verb := str(c.step.get("tool", "")).removeprefix("body:")) in VERB_TO_GATEWAY_TOOL else None)}
            for c in candidates]}
        view = body_view(before, body_id)
        token = self.worker.submit(proposal, view, goal, None)
        if token is None:
            return {"ok": False, "code": "policy_busy"}
        deadline = time.monotonic() + self.config.system_one_deadline
        result = None
        while time.monotonic() < deadline:
            result = self.worker.poll(token)
            if result is not None:
                break
            await asyncio.sleep(0.05)
        if result is None:
            return {"ok": False, "code": "policy_timeout"}
        if not result.get("ok"):
            return result
        after = body_view(await fresh(), body_id)
        if not self._same_body(view, after, self.clock()):
            return {"ok": False, "code": "policy_premise_changed", "choice": result.get("choice")}
        chosen = next(c for c in candidates if c.id == result["choice"])
        return {**{k: result.get(k) for k in ("choice", "confidence", "model", "provider", "latencyMs")}, "ok": True, "step": chosen.step}

    async def _typed_choice(self, candidates: list[Candidate], goal: str, before: BodySnapshot, body_id: str | None,
                            fresh: Callable[[], Awaitable[BodySnapshot]], question: str) -> dict[str, Any]:
        """System 1 for bodies whose verbs are not survivor gateway tools (e.g. maid): same /systemone protocol,
        same rules as system_one.choose - fresh snapshot, >= min_confidence, premise re-check, no retry."""
        if self.typed is None:
            return {"ok": False, "code": "system_one_not_configured"}
        view = body_view(before, body_id)
        state = {"body": {k: view[k] for k in ("bodyUuid", "dimension", "hp", "hunger", "position")}, "goal": goal[:600],
                 "actions": {c.id: c.step for c in candidates}}
        question_ = {"type": "choice", "instructions": question[:500], "criteria": {c.id: c.description for c in candidates}}
        started = time.monotonic()
        try:
            reply = await asyncio.wait_for(self.typed.request(state, {"action": question_}), self.config.system_one_deadline)
        except Exception as error:
            return {"ok": False, "code": "policy_unavailable", "errorType": type(error).__name__}
        answer = reply["answers"]["action"]
        meta = {"choice": answer.choice, "confidence": answer.confidence, "model": reply.get("model"), "provider": "systemone",
                "latencyMs": round((time.monotonic() - started) * 1000, 2)}
        if answer.choice_probability < self.config.min_confidence:
            return {"ok": False, "code": "policy_escalated", **meta}
        after = body_view(await fresh(), body_id)
        if not self._premise_same(view, after):
            return {"ok": False, "code": "policy_premise_changed", **meta}
        return {"ok": True, "step": next(c for c in candidates if c.id == answer.choice).step, **meta}

    def _premise_same(self, before: dict[str, Any], after: dict[str, Any]) -> bool:
        if self.worker is not None:
            return bool(self._same_body(before, after, self.clock()))
        if after.get("dimension") != before.get("dimension") or after.get("hp") != before.get("hp"):
            return False
        a, b = before.get("position"), after.get("position")
        return a is None or b is None or sum((a[k] - b[k]) ** 2 for k in "xyz") <= 0.25

    async def thinking_tier(self, route: Route | None, profile: dict[str, Any] | None, scene: dict[str, Any]) -> tuple[ThinkingTier, ThinkingTier]:
        """(requested, effective). Requested = the typed judge's choice (cormy per-turn thinking-tier judge,
        answers.reasoning immediate/routine/deliberate) when confident; effective falls back to the router level /
        decision profile. Danger, failure or a complex profile can raise but never lower the tier."""
        base: ThinkingTier = LEVEL_TIER.get(route.level, "normal") if route else "normal"  # type: ignore[assignment]
        if profile and profile.get("profile") == "complex":
            base = "complex"
        requested: ThinkingTier = base
        if self.typed is not None:
            q = {"type": "choice", "instructions": "How much reasoning does the next planning request need?",
                 "criteria": {"immediate": "Urgent or obvious; answer without extended thinking.",
                              "routine": "Normal planning for the current goal.",
                              "deliberate": "Novel, failing or multi-step; plan carefully."}}
            try:
                reply = await asyncio.wait_for(self.typed.request(scene, {"reasoning": q}), 1.0)
                answer = reply["answers"]["reasoning"]
                if answer.choice_probability >= self.config.min_confidence:
                    requested = REASONING[answer.choice]  # type: ignore[assignment]
            except Exception:
                pass  # inherit the provider tier, as cormy's foreground judge does
        order = ["no_think", "normal", "complex"]
        effective = requested if order.index(requested) >= order.index(base) or (route and route.level <= 1) else base
        return requested, effective
