"""JitRL action-selection hook with goal-conditioned reward shaping (default off: AGENT_HARNESS_PY_JITRL).

Ported from packages/agent-mc-world/core/jitrl.ts (paper arXiv:2601.18510 sec. 4 / app. A):
  V = mean retrieved return, Q(a) = mean return of neighbours with action a (unobserved -> neutral 0),
  A = Q - V, posterior = softmax(log prior + beta * A / max|A|), beta = 0.5; zero priors / not-ready stay excluded;
  no optimistic exploration, no model calls, no body dispatch (advisory only).
Retrieval is conservative and scoped exactly as the TS book: same scope key (realm/account/agent -> our group_id),
dimension, taskKey, phase and condition hash; |dpos| <= 16, |dhealth| <= 4, |dfood| <= 4; nearest 10.

Differences (documented in the design doc):
* short-term return = clipped, goal-weighted sum of single-step metric deltas (food, health, item counts, distance
  progress) minus a health-loss penalty. Weights come from ``GoalWeights`` (goal tags/keywords -> weights, default).
  The TS book uses ONE criterion; a single-metric weight table reproduces it exactly.
* mid-term = ``credit()``: on milestone (+1) / failure (-1) adds NEW samples to the last N receipt-verified steps of
  that goal, value = gamma^k * terminal, tagged ``credit_source``; existing samples and their criteria are never
  rewritten; samples are bound to the goal/stage version (``goal_version``).
* long-term (optional LLM step evaluator on key trajectories) is an interface only: ``StepEvaluator``.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections import deque
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field, field_validator, model_validator

METRICS = ("food", "health", "inventory", "distance")
KEY = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$")


# ------------------------------------------------------------------------------------------------ TS port
def reweight(candidates: list[dict[str, Any]], neighbours: list[dict[str, Any]], beta: float = 0.5) -> dict[str, Any]:
    """Exact port of reweightJitRl. candidates: {id, actionHash, prior, ready}; neighbours: {id, actionHash, value}."""
    if not math.isfinite(beta) or beta < 0 or beta > 2:
        raise ValueError("beta must be 0..2")
    if not candidates or any(not math.isfinite(c["prior"]) or c["prior"] < 0 or c["prior"] > 1 for c in candidates) \
            or len({c["id"] for c in candidates}) != len(candidates):
        raise ValueError("Invalid candidate distribution")
    ready = [c for c in candidates if c["ready"]]
    total = sum(c["prior"] for c in ready)
    if not ready or total <= 0:
        raise ValueError("No ready candidate with positive probability")
    hashes = {c["actionHash"] for c in ready}
    evidence = [n for n in {n["id"]: n for n in neighbours}.values()
                if isinstance(n["value"], int | float) and math.isfinite(n["value"]) and -1 <= n["value"] <= 1 and n["actionHash"] in hashes]
    baseline = sum(n["value"] for n in evidence) / len(evidence) if evidence else None
    rows = []
    for c in ready:
        matches = [n for n in evidence if n["actionHash"] == c["actionHash"]]
        q = sum(n["value"] for n in matches) / len(matches) if matches else None
        est = q if q is not None else 0.0
        rows.append({**c, "prior": c["prior"] / total, "samples": len(matches), "q": q, "estimatedQ": est,
                     "estimateSource": "unobserved-neutral" if q is None else "measured",
                     "advantage": 0.0 if baseline is None else est - baseline})
    scale = max([0.0, *(abs(r["advantage"]) for r in rows)])
    logits = [-math.inf if r["prior"] == 0 else math.log(r["prior"]) + beta * (r["advantage"] / scale if scale else 0) for r in rows]
    top = max(logits)
    weights = [math.exp(v - top) for v in logits]
    s = sum(weights)
    return {"baseline": baseline, "sampleSize": len(evidence), "candidates": [{**r, "posterior": w / s} for r, w in zip(rows, weights, strict=True)]}


# ------------------------------------------------------------------------------------------------ goal-conditioned weights
class MetricWeights(BaseModel):
    """Weights per metric and the expected delta (target) that maps to a return of 1."""
    model_config = {"extra": "forbid"}
    food: float = Field(default=0.0, ge=0, le=10)
    health: float = Field(default=0.0, ge=0, le=10)
    inventory: dict[str, float] = Field(default_factory=dict)  # item id -> weight ("*" = any item)
    distance: float = Field(default=0.0, ge=0, le=10)
    targets: dict[str, float] = Field(default_factory=lambda: {"food": 4.0, "health": 4.0, "inventory": 4.0, "distance": 8.0})
    harm_penalty: float = Field(default=1.0, ge=0, le=5)  # x relative health loss, subtracted (TS: 1 unless the criterion is health)

    @field_validator("inventory")
    @classmethod
    def _items(cls, value: dict[str, float]) -> dict[str, float]:
        for item, w in value.items():
            if not re.fullmatch(r"\*|\*?[a-z0-9_:]{1,100}", item) or not 0 <= w <= 10:
                raise ValueError(f"inventory weight {item!r} must be an item id (or *) with weight 0..10")
        return value

    @field_validator("targets")
    @classmethod
    def _targets(cls, value: dict[str, float]) -> dict[str, float]:
        if set(value) - set(METRICS) or any(not 0 < v <= 10000 for v in value.values()):
            raise ValueError("targets: positive deltas (<= 10000) for food/health/inventory/distance only")
        return value

    @model_validator(mode="after")
    def _nonzero(self) -> MetricWeights:
        if self.food + self.health + self.distance + sum(self.inventory.values()) <= 0:
            raise ValueError("at least one metric weight must be positive")
        return self


class GoalRule(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(pattern=KEY.pattern)
    match: list[str] = Field(min_length=1, max_length=32)  # goal tags or case-insensitive keywords (中文 ok)
    weights: MetricWeights


class GoalWeights(BaseModel):
    """Configurable table (JSON/YAML-able): first matching rule wins, else ``default``."""
    model_config = {"extra": "forbid"}
    version: str = "1"
    default: MetricWeights = Field(default_factory=lambda: MetricWeights(food=1, health=1, inventory={"*": 1}, distance=1))
    rules: list[GoalRule] = Field(default_factory=list, max_length=64)

    @classmethod
    def load(cls, path: str | Path) -> GoalWeights:
        text = Path(path).read_text(encoding="utf-8")
        if str(path).endswith((".yaml", ".yml")):
            import yaml  # optional dependency
            return cls.model_validate(yaml.safe_load(text))
        return cls.model_validate_json(text)

    def select(self, goal: str, tags: list[str] | None = None) -> tuple[str, MetricWeights]:
        low, tagset = goal.lower(), {t.lower() for t in tags or []}
        for rule in self.rules:
            if any(m.lower() in tagset or m.lower() in low for m in rule.match):
                return rule.name, rule.weights
        return "default", self.default


DEFAULT_WEIGHTS = GoalWeights(rules=[
    GoalRule(name="survive", match=["survive", "survival", "heal", "flee", "求生", "回血", "逃"],
             weights=MetricWeights(health=3, food=1, harm_penalty=0)),
    GoalRule(name="eat", match=["eat", "food", "hungry", "吃", "饿"], weights=MetricWeights(food=3, health=0.5)),
    GoalRule(name="gather_wood", match=["wood", "log", "tree", "木"], weights=MetricWeights(inventory={"*_log": 3, "*": 0.5}, health=0.2)),
    GoalRule(name="mine", match=["mine", "ore", "stone", "挖", "矿"], weights=MetricWeights(inventory={"*": 3}, health=0.2)),
    GoalRule(name="travel", match=["go to", "walk", "move", "travel", "去", "走"], weights=MetricWeights(distance=3, health=0.5)),
])


# ------------------------------------------------------------------------------------------------ observations / samples
class Observation(BaseModel):
    dimension: str
    health: float
    food: float
    position: tuple[float, float, float]
    inventory: dict[str, int] = Field(default_factory=dict)
    at: float = Field(default_factory=time.time)


def _item_weight(weights: MetricWeights, item: str) -> float:
    if item in weights.inventory:
        return weights.inventory[item]
    for pattern, w in weights.inventory.items():
        if pattern.startswith("*") and pattern != "*" and item.endswith(pattern[1:]):
            return w
    return weights.inventory.get("*", 0.0)


def shaped_return(before: Observation, after: Observation, weights: MetricWeights, destination: tuple[float, float, float] | None = None) -> tuple[float | None, str]:
    """Clipped weighted sum of per-metric normalised deltas minus health-loss penalty. Death = -1."""
    if before.dimension != after.dimension or after.at < before.at:
        return None, "missing-or-cross-dimension-observation"
    if after.health <= 0:
        return -1.0, "observed-death"
    t = weights.targets
    parts: list[tuple[float, float]] = []
    if weights.food:
        parts.append((weights.food, (after.food - before.food) / t.get("food", 4)))
    if weights.health:
        parts.append((weights.health, (after.health - before.health) / t.get("health", 4)))
    if weights.inventory:
        items = set(before.inventory) | set(after.inventory)
        gain = sum(_item_weight(weights, i) * (after.inventory.get(i, 0) - before.inventory.get(i, 0)) for i in items)
        scale = max(weights.inventory.values())
        parts.append((scale, gain / scale / t.get("inventory", 4) if scale else 0.0))
    if weights.distance and destination is not None:
        def dist(p: tuple[float, float, float]) -> float:
            return math.dist(p, destination)
        parts.append((weights.distance, (dist(before.position) - dist(after.position)) / t.get("distance", 8)))
    total = sum(w for w, _ in parts)
    if total <= 0:
        return None, "missing-measurement"
    value = max(-1.0, min(1.0, sum(w * d for w, d in parts) / total))
    harm = weights.harm_penalty * max(0.0, before.health - after.health) / max(1.0, before.health)
    return max(-1.0, min(1.0, value - harm)), "measured-step-delta"


class Sample(BaseModel):
    id: str
    scope: str
    dimension: str
    task_key: str
    phase: str
    condition_hash: str
    goal_version: str
    health: float
    food: float
    position: tuple[float, float, float]
    action_hash: str
    value: float = Field(ge=-1, le=1)
    reason: str
    credit_source: Literal["step", "milestone", "failure", "evaluator"] = "step"
    request_id: str | None = None
    at: float = Field(default_factory=time.time)


def action_hash(step: dict[str, Any]) -> str:
    """Exact tool + args (+ native name); empty/None fields ignored so host dicts and Step models hash alike."""
    norm = {k: step[k] for k in ("tool", "args", "name") if step.get(k) not in (None, {}, "")}
    return hashlib.sha256(json.dumps(norm, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:32]


def condition_hash(conditions: dict[str, Any] | None) -> str:
    c = conditions or {}
    if len(c) > 12 or any(not KEY.match(k) or not (v is None or isinstance(v, bool | int | float)) for k, v in c.items()):
        raise ValueError("conditions: at most 12 numeric/boolean/null metadata fields")
    return hashlib.sha256(json.dumps(c, sort_keys=True).encode()).hexdigest()[:16]


def similarity(a: Sample, scope: str, dimension: str, task_key: str, phase: str, cond: str, health: float, food: float,
               position: tuple[float, float, float]) -> float | None:
    if (a.scope, a.dimension, a.task_key, a.phase, a.condition_hash) != (scope, dimension, task_key, phase, cond):
        return None
    d = math.dist(a.position, position)
    if d > 16 or abs(a.health - health) > 4 or abs(a.food - food) > 4:
        return None
    return d / 16 + abs(a.health - health) / 4 + abs(a.food - food) / 4


class StepEvaluator(Protocol):
    """Long-term, optional: an LLM scores steps of KEY trajectories only; results are stored as
    credit_source='evaluator' samples and never replace measured ones."""

    async def __call__(self, trajectory: list[Sample], goal: str) -> list[float | None]: ...


# ------------------------------------------------------------------------------------------------ book
class JitRL:
    def __init__(self, weights: GoalWeights | None = None, *, path: str | Path | None = None, beta: float = 0.5, k: int = 10,
                 window: int = 5, gamma: float = 0.8, max_samples: int = 4096) -> None:
        if not 0 < gamma <= 1 or not 1 <= window <= 32:
            raise ValueError("gamma in (0,1], window 1..32")
        self.weights, self.beta, self.k, self.window, self.gamma = weights or DEFAULT_WEIGHTS, beta, k, window, gamma
        self.path = Path(path) if path else None
        self.samples: deque[Sample] = deque(maxlen=max_samples)
        self.trajectories: dict[str, list[Sample]] = {}  # goal key -> verified step samples awaiting credit
        self.counters = {"ranked": 0, "changed_choice": 0, "steps": 0, "skipped": 0, "credited": 0}
        if self.path and self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                self.samples.append(Sample.model_validate_json(line))

    def _persist(self, sample: Sample) -> None:
        self.samples.append(sample)
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as out:
                out.write(sample.model_dump_json() + "\n")

    def task(self, goal: str, tags: list[str] | None = None) -> tuple[str, MetricWeights, str]:
        name, w = self.weights.select(goal, tags)
        return name, w, f"{self.weights.version}:{name}"

    # -- action selection --------------------------------------------------------------------------
    def rank(self, *, scope: str, goal: str, obs: Observation, candidates: list[dict[str, Any]], phase: str = "act",
             tags: list[str] | None = None, conditions: dict[str, Any] | None = None) -> dict[str, Any]:
        """candidates: {id, step, prior?, ready?}. Advisory: returns base/suggested choice and posteriors."""
        if not 2 <= len(candidates) <= 12:
            raise ValueError("2..12 candidates")
        task_key, _, version = self.task(goal, tags)
        cond = condition_hash(conditions)
        uniform = 1 / len(candidates)
        rows = [{"id": c["id"], "actionHash": action_hash(c["step"]), "prior": float(c.get("prior", uniform)), "ready": bool(c.get("ready", True))}
                for c in candidates]
        near = sorted(((s, sim) for s in self.samples if s.goal_version == version
                       and (sim := similarity(s, scope, obs.dimension, task_key, phase, cond, obs.health, obs.food, obs.position)) is not None),
                      key=lambda x: (x[1], -x[0].at))[: self.k]
        out = reweight(rows, [{"id": s.id, "actionHash": s.action_hash, "value": s.value} for s, _ in near], self.beta)
        base = max(out["candidates"], key=lambda c: c["prior"])["id"]
        best = max(out["candidates"], key=lambda c: c["posterior"])
        self.counters["ranked"] += 1
        self.counters["changed_choice"] += int(best["id"] != base)
        return {**out, "taskKey": task_key, "goalVersion": version, "baseChoice": base, "suggestedChoice": best["id"],
                "suggestedPosterior": best["posterior"], "bodyDispatched": False, "goalVerified": False}

    # -- short-term: one verified step -------------------------------------------------------------
    def record_step(self, *, scope: str, goal: str, step: dict[str, Any], status: str, before: Observation | None, after: Observation | None,
                    request_id: str, phase: str = "act", tags: list[str] | None = None, conditions: dict[str, Any] | None = None,
                    destination: tuple[float, float, float] | None = None) -> Sample | None:
        """Only receipt-verified terminal steps (completed/failed) with fresh before/after observations count."""
        if status not in ("completed", "failed") or before is None or after is None:
            self.counters["skipped"] += 1
            return None
        task_key, weights, version = self.task(goal, tags)
        value, reason = shaped_return(before, after, weights, destination)
        if value is None:
            self.counters["skipped"] += 1
            return None
        sample = Sample(id=hashlib.sha256(f"{scope}|{request_id}|step".encode()).hexdigest()[:32], scope=scope, dimension=before.dimension,
                        task_key=task_key, phase=phase, condition_hash=condition_hash(conditions), goal_version=version, health=before.health,
                        food=before.food, position=before.position, action_hash=action_hash(step), value=value, reason=reason, request_id=request_id)
        if any(s.id == sample.id for s in self.samples):
            return None  # same receipt never credited twice
        self._persist(sample)
        self.trajectories.setdefault(f"{scope}|{goal}", []).append(sample)
        del self.trajectories[f"{scope}|{goal}"][: -self.window * 4]
        self.counters["steps"] += 1
        return sample

    # -- mid-term: discounted credit on milestone / failure ----------------------------------------
    def credit(self, *, scope: str, goal: str, outcome: Literal["milestone", "failure"]) -> list[Sample]:
        """Adds NEW samples (credit_source=outcome) for the last ``window`` verified steps of this goal:
        value = gamma^k * (+1 | -1), k = 0 for the most recent step. Originals are untouched."""
        steps = self.trajectories.pop(f"{scope}|{goal}", [])[-self.window:]
        terminal = 1.0 if outcome == "milestone" else -1.0
        out = []
        for k, s in enumerate(reversed(steps)):
            credited = s.model_copy(update={"id": hashlib.sha256(f"{s.id}|{outcome}".encode()).hexdigest()[:32],
                                            "value": round(terminal * self.gamma ** k, 6), "reason": f"discounted-{outcome}-credit k={k}",
                                            "credit_source": outcome, "at": time.time()})
            if not any(x.id == credited.id for x in self.samples):
                self._persist(credited)
                out.append(credited)
        self.counters["credited"] += len(out)
        return out

    def stats(self, scope: str | None = None) -> dict[str, Any]:
        rows = [s for s in self.samples if scope is None or s.scope == scope]
        by_source: dict[str, int] = {}
        for s in rows:
            by_source[s.credit_source] = by_source.get(s.credit_source, 0) + 1
        worst: dict[str, list[float]] = {}
        for s in rows:
            worst.setdefault(f"{s.task_key}/{s.action_hash[:8]}", []).append(s.value)
        low = sorted(((k, sum(v) / len(v), len(v)) for k, v in worst.items() if len(v) >= 2), key=lambda x: x[1])[:3]
        return {"samples": len(rows), "bySource": by_source, "counters": dict(self.counters),
                "lowestActions": [{"action": k, "meanReturn": round(m, 3), "n": n} for k, m, n in low]}
