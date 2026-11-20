"""Lightweight harness runtime: intents, planning hook, memory access point, reflection hook, asyncio scheduling.

The runtime is the ONLY caller of ``body.act`` while it executes (exclusive body control); hosts talk to it with
small messages (``protocol.handle``) - submit_intent / update_intent / control / get_summary / pull_events / get_body.
"""
from __future__ import annotations

import asyncio
import contextlib
import itertools
import re
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import datetime
from functools import partial
from typing import Any, Literal

from pydantic import BaseModel, Field

from .body.base import BodyAdapter, new_request_id
from .fastslow import Candidate, Decision, FastSlow
from .learning.reflection import ReflectionLoop
from .learning.strategies import StrategyStore
from .memory.base import Fact, MemoryEpisode
from .memory.router import MemoryRouter
from .models import ACTION_VERBS, ActionReceipt, BodyAction, BodyEvent, BodySnapshot, Capabilities, utcnow
from .journal import ActionJournal
from .scheduler import BodyLease, BrainMetrics, WorkerPool

IntentState = Literal["queued", "active", "paused", "completed", "failed", "cancelled"]
EventKind = Literal["intent_state", "task_completed", "task_failed", "interaction", "death", "safety", "body", "reflection", "player_presence"]
STEP_TOOL = re.compile(r"^body:(?:native:[A-Za-z0-9_:.-]{1,64}|[a-z_]{2,16})$")
PRIORITY = {"low": 25, "normal": 50, "high": 75, "urgent": 100}


class Step(BaseModel):
    tool: str = Field(pattern=STEP_TOOL.pattern)
    args: dict[str, Any] = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=200)

    def action(self, request_id: str) -> BodyAction:
        rest = self.tool[len("body:"):]
        if rest.startswith("native:"):
            return BodyAction(verb="native", name=rest[len("native:"):], args=self.args, request_id=request_id)
        return BodyAction(verb=rest, args=self.args, request_id=request_id)


class Intent(BaseModel):
    id: str
    agent: str
    goal: str = Field(max_length=500)
    priority: int = 50
    steps: list[Step] = Field(default_factory=list, max_length=20)
    state: IntentState = "queued"
    reason: str | None = None
    needs_host: bool = False
    step_index: int = 0
    candidates: list[Candidate] = Field(default_factory=list, max_length=8)  # System 1 options (2-8)
    decision: Decision | None = None  # who decided (host/reflex/system1/system2), route, thinking tier, profile
    verified: bool | None = None  # goal verified by environment evidence (verifier hook), not by step receipts
    defer_until: float = 0.0
    defers: int = 0
    strategy_refs: list[tuple[str, int]] = Field(default_factory=list)  # (key, version) of lessons the planner was given
    receipts: list[ActionReceipt] = Field(default_factory=list)
    source_events: list[str] = Field(default_factory=list, max_length=32)  # host-observed inbox IDs, never model-generated
    desktop_request_id: str | None = None  # From the role-scoped worker's check endpoint.
    remember_wait_purpose: bool = False
    recall_query: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class HarnessEvent(BaseModel):
    seq: int
    kind: EventKind
    severity: Literal[1, 2, 3] = 1
    text: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    at: datetime = Field(default_factory=utcnow)


class PlanContext(BaseModel):
    capabilities: Capabilities | None = None
    memories: list[Fact] = Field(default_factory=list)  # warm (Graphiti) then cold (local) recall
    hot: list[MemoryEpisode] = Field(default_factory=list)  # hot tier: latest episodes of this body's group
    recent: list[HarnessEvent] = Field(default_factory=list)
    dialogue: list[BodyEvent] = Field(default_factory=list, max_length=32)  # current host-selected input, including ordinary chat
    social_relationship: dict[str, Any] | None = None
    decision: Decision | None = None  # route level, requested/effective thinking tier, output budget profile
    snapshot: BodySnapshot | None = None
    body_results: list[dict[str, Any]] = Field(default_factory=list, max_length=6)
    communication_receipts: list[dict[str, Any]] = Field(default_factory=list, max_length=4)
    recent_companion_speech: list[str] = Field(default_factory=list, max_length=8)
    party_context: dict[str, Any] | None = None
    companion_adventure: dict[str, Any] | None = None
    activity_review: dict[str, Any] | None = None
    agenda: dict[str, Any] | None = None
    proposed_agenda: list[dict[str, Any]] | None = None
    lessons: list[str] = Field(default_factory=list)  # active versioned lessons (self-iteration store), trial or adopted


Planner = Callable[[Intent, PlanContext], Awaitable[list[Step] | None]]
Reflector = Callable[[Intent, PlanContext], Awaitable[str | None]]
Verifier = Callable[[Intent, BodySnapshot], Awaitable[bool | None]]


async def explicit_steps(intent: Intent, context: PlanContext) -> list[Step] | None:
    """Default planner: the host supplies steps; a bare goal pauses with needs_host (no hidden model loop)."""
    return intent.steps or None


def step_support(step: Step, caps: Capabilities | None) -> str | None:
    if caps is None:
        return None
    action = step.action("check_00000")
    if action.verb not in ACTION_VERBS:
        return f"unknown verb {action.verb}"
    if not caps.supports(action.verb, action.name):
        return f"Step not supported by this body: {step.tool}"
    return None


class HarnessRuntime:
    RING = 500

    def __init__(self, *, body: BodyAdapter | None = None, planner: Planner = explicit_steps, reflection: ReflectionLoop | None = None,
                 memory: MemoryRouter | None = None, execute: bool = False, step_timeout: float = 120.0,
                 fastslow: FastSlow | None = None, verifier: Verifier | None = None, strategies: StrategyStore | None = None,
                 review_interval: float = 1800.0, max_workers: int = 2, defer_seconds: float = 5.0, max_defers: int = 12,
                 journal: ActionJournal | None = None, private_mailbox: bool = False) -> None:
        self.body, self.planner, self.reflection, self.memory = body, planner, reflection, memory
        self.execute, self.step_timeout = execute, step_timeout
        self.journal = journal
        self.private_mailbox = private_mailbox
        self.fastslow, self.verifier, self.strategies, self.review_interval = fastslow, verifier, strategies, review_interval
        self.defer_seconds, self.max_defers = defer_seconds, max_defers
        self.lease, self.metrics, self.pool = BodyLease(), BrainMetrics(), WorkerPool(max_workers)
        self._last_receipt: ActionReceipt | None = None
        self._reviewer_task: asyncio.Task[None] | None = None
        self.intents: dict[str, Intent] = {}
        self.events: deque[HarnessEvent] = deque(maxlen=self.RING)
        self._seq = itertools.count(1)
        self._ids = itertools.count(1)
        self._wake = asyncio.Event()
        self._worker: asyncio.Task[None] | None = None
        self._results: dict[str, asyncio.Future[BodyEvent]] = {}
        self._active: Intent | None = None
        self._unsub: Callable[[], None] | None = None
        self._memory_tasks: set[asyncio.Task[Any]] = set()
        if body is not None:
            self.attach_body(body, execute=execute)

    # ---- body wiring -------------------------------------------------------------------------------
    def attach_body(self, body: BodyAdapter, *, execute: bool | None = None) -> None:
        if self._unsub:
            self._unsub()
        self.body = body
        if execute is not None:
            self.execute = execute
        self._unsub = body.subscribe(self._on_body_event)

    def _on_body_event(self, event: BodyEvent) -> None:
        if self.private_mailbox and (event.kind == "whisper" or event.data.get("channel") == "private"):
            return  # Resident whispers use the pair-scoped mailbox and must never enter public recall.
        if event.kind == "action_result" and event.request_id and (future := self._results.pop(event.request_id, None)) and not future.done():
            future.set_result(event)
        if event.kind == "safety":
            self.lease.preempt("safety")  # reflex bypasses the queue; the holder's late results are discarded
            self.emit("safety", event.text, 3, event.data)
            if self._active and self._active.state == "active":
                self._transition(self._active, "paused", f"safety halt: {event.text}", needs_host=True)
        elif event.kind == "death":
            self.emit("death", event.text or "body died", 3, event.data)
            if self._active and self._active.state == "active":
                self._transition(self._active, "paused", "body died", needs_host=True)
        elif event.kind in ("lifecycle", "connection") and event.severity >= 2:
            self.emit("body", event.text, 2, event.data)
        elif event.kind in ("chat", "whisper", "dialogue"):
            self.emit("interaction", event.text, 2 if event.kind != "chat" else 1, {"kind": event.kind, **event.data})
        elif event.kind in ("player_join", "player_leave"):
            self.emit("player_presence", event.text, 1, event.data)
        if self.memory is not None and self.body is not None and (identity := self.body.identity()) is not None:
            with contextlib.suppress(RuntimeError):
                task = asyncio.get_running_loop().create_task(self.memory.observe(event, identity))
                self._memory_tasks.add(task)
                task.add_done_callback(self._memory_tasks.discard)

    # ---- events -----------------------------------------------------------------------------------
    def emit(self, kind: EventKind, text: str, severity: int = 1, data: dict[str, Any] | None = None) -> HarnessEvent:
        event = HarnessEvent(seq=next(self._seq), kind=kind, severity=severity, text=text[:1000], data=data or {})
        self.events.append(event)
        return event

    def pull_events(self, after: int = 0, limit: int = 100, min_severity: int = 1, kinds: list[str] | None = None) -> dict[str, Any]:
        rows = [e for e in self.events if e.seq > after and e.severity >= min_severity and (not kinds or e.kind in kinds)]
        oldest = self.events[0].seq if self.events else 0
        page = rows[:limit]
        return {"events": page, "cursor": page[-1].seq if page else after, "latest": self.events[-1].seq if self.events else 0,
                "dropped": after + 1 < oldest, "hasMore": len(rows) > limit}

    # ---- intents ----------------------------------------------------------------------------------
    def _transition(self, intent: Intent, state: IntentState, reason: str | None = None, needs_host: bool = False) -> None:
        previous = intent.state
        intent.state, intent.reason, intent.needs_host, intent.updated_at = state, reason, needs_host, utcnow()
        severity = 3 if needs_host else (2 if state in ("completed", "failed") else 1)
        self.emit("intent_state", f"{intent.goal}: {previous} -> {state}" + (f" ({reason})" if reason else ""), severity,
                  {"intentId": intent.id, "from": previous, "state": state, "needsHost": needs_host, "reason": reason})
        if state == "completed":
            self.emit("task_completed", intent.goal, 2, {"intentId": intent.id})
        elif state == "failed":
            self.emit("task_failed", f"{intent.goal}: {reason}", 2, {"intentId": intent.id})

    def submit_intent(self, goal: str, *, agent: str = "host", priority: int | str = 50, steps: list[dict[str, Any]] | None = None,
                      candidates: list[dict[str, Any]] | None = None) -> Intent:
        level = PRIORITY.get(priority, 50) if isinstance(priority, str) else max(0, min(100, int(priority)))
        intent = Intent(id=f"in_{next(self._ids)}_{new_request_id('')[1:9]}", agent=agent, goal=goal, priority=level,
                        steps=[Step(**s) for s in steps or []], candidates=[Candidate(**c) for c in candidates or []])
        caps = self.body.capabilities() if self.body else None
        for step in [*intent.steps, *(Step(**c.step) for c in intent.candidates)]:
            if (reason := step_support(step, caps)) is not None:
                raise ValueError(reason + "; read get_body for what this body supports")
        self.intents[intent.id] = intent
        self.emit("intent_state", f"{goal}: queued", 1, {"intentId": intent.id, "state": "queued", "needsHost": False})
        self._wake.set()
        return intent

    def update_intent(self, intent_id: str, *, goal: str | None = None, priority: int | None = None, steps: list[dict[str, Any]] | None = None) -> Intent:
        intent = self.intents[intent_id]
        if intent.state in ("completed", "failed", "cancelled"):
            raise ValueError("intent already finished")
        if goal is not None:
            intent.goal = goal
        if priority is not None:
            intent.priority = max(0, min(100, priority))
        if steps is not None:
            new = [Step(**s) for s in steps]
            caps = self.body.capabilities() if self.body else None
            for step in new:
                if (reason := step_support(step, caps)) is not None:
                    raise ValueError(reason)
            intent.steps, intent.step_index = new, 0
            if intent.state == "paused" and intent.needs_host:
                self._transition(intent, "queued", "new steps from host")
        intent.updated_at = utcnow()
        self._wake.set()
        return intent

    async def control(self, action: str, intent_id: str | None = None, reason: str | None = None) -> Any:
        if action == "list":
            return list(self.intents.values())
        intent = self.intents[str(intent_id)]
        if action == "get":
            return intent
        if action == "pause" and intent.state in ("queued", "active"):
            if intent is self._active and self.body:
                await self.body.stop("paused by host")
            self._transition(intent, "paused", reason or "paused by host")
        elif action == "resume" and intent.state == "paused":
            self._transition(intent, "queued", reason or "resumed")
        elif action == "cancel" and intent.state not in ("completed", "failed", "cancelled"):
            if intent is self._active and self.body:
                await self.body.stop("cancelled by host")
            self._transition(intent, "cancelled", reason or "cancelled by host")
        self._wake.set()
        return intent

    # ---- memory access point ---------------------------------------------------------------------
    async def recall(self, query: str, limit: int = 8) -> list[Fact]:
        if self.memory is None or self.body is None or (identity := self.body.identity()) is None:
            return []
        return await self.memory.search(identity.group_id(), query, limit)

    # ---- summary ----------------------------------------------------------------------------------
    async def get_summary(self, topic: str | None = None, max_chars: int = 1200) -> dict[str, Any]:
        lines = []
        if self.body is not None:
            ident, health = self.body.identity(), self.body.health()
            halted = "｜安全停止中" if health.safety and health.safety.halted else ""
            lines.append(f"身体：{self.body.kind}「{ident.name if ident and ident.name else (ident.body_id if ident else '?')}」｜{health.lifecycle}{halted}")
        if self._active and self._active.state == "active":
            lines.append(f"当前意图：{self._active.goal}（第{self._active.step_index + 1}/{len(self._active.steps)}步）")
        waiting = [i for i in self.intents.values() if i.state in ("queued", "paused")]
        if waiting:
            lines.append("待办：" + "；".join(f"{i.goal}[{i.state}{'·需宿主' if i.needs_host else ''}]" for i in waiting[:5]))
        important = [e for e in self.events if e.severity >= 2][-6:]
        lines += [f"- {e.kind}: {e.text}" for e in important]
        if topic:
            lines += [f"* 记忆: {f.fact[:160]}" for f in await self.recall(topic, 4)]
        text, truncated = "\n".join(lines), False
        if len(text) > max_chars:
            text, truncated = text[: max_chars - 1] + "…", True
        return {"text": text, "truncated": truncated, "generatedAt": utcnow().isoformat(), "brain": self.metrics.view()}

    # ---- scheduling -------------------------------------------------------------------------------
    def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name="agent-mc-harness")
        if self.reflection is not None and (self._reviewer_task is None or self._reviewer_task.done()):
            self._reviewer_task = asyncio.create_task(self._review_loop(), name="agent-mc-harness-review")

    async def close(self) -> None:
        for task in (self._worker, self._reviewer_task):
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        await self.pool.close()
        if self.fastslow is not None:
            self.fastslow.close()
        if self._unsub:
            self._unsub()
        await asyncio.gather(*self._memory_tasks, return_exceptions=True)

    def _next(self) -> Intent | None:
        now = asyncio.get_running_loop().time()
        queued = [i for i in self.intents.values() if i.state == "queued" and i.defer_until <= now]
        return max(queued, key=lambda i: (i.priority, -i.created_at.timestamp())) if queued else None

    async def _run(self) -> None:
        while True:
            intent = self._next() if self.execute and self.body is not None else None
            if intent is None:
                self._wake.clear()
                deferred = [i.defer_until for i in self.intents.values() if i.state == "queued" and i.defer_until]
                timeout = max(0.05, min(deferred) - asyncio.get_running_loop().time()) if deferred else None
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), timeout)
                continue
            await self.run_intent(intent)

    async def _review_loop(self) -> None:
        """Time trigger (cormy sleep-review: read-only background review, default every 30 min) in the worker pool."""
        assert self.reflection is not None
        while True:
            await asyncio.sleep(self.review_interval)
            events = [f"{e.kind}: {e.text[:120]}" for e in self.events if e.severity >= 2][-40:]
            reflection = await self.pool.submit("review", partial(self.reflection.periodic, events))
            if reflection is not None:
                self.emit("reflection", reflection.lesson, 1, {"trigger": "periodic", "provenance": reflection.provenance})

    async def _context(self, intent: Intent) -> PlanContext:
        identity = self.body.identity() if self.body else None
        hot = self.memory.hot(identity.group_id(), 8) if self.memory is not None and identity is not None else []
        lessons = self.active_lessons()
        intent.strategy_refs = [(k, v) for k, v, _ in lessons]
        return PlanContext(capabilities=self.body.capabilities() if self.body else None,
                           memories=await self.recall(intent.recall_query or intent.goal, 5), hot=hot,
                           lessons=[t for _, _, t in lessons],
                           recent=[e for e in self.events if e.severity >= 2][-10:])

    async def _snapshot(self) -> BodySnapshot | None:
        assert self.body is not None
        try:
            return await asyncio.wait_for(self.body.snapshot(), 10)
        except Exception:
            return None

    async def decide(self, intent: Intent, context: PlanContext) -> tuple[Decision, list[Step] | None]:
        """reflexes/rules -> System 1 (optional) -> System 2 planner. Host-supplied steps skip deciding."""
        if intent.steps and intent.step_index == 0 and intent.decision is None:
            return Decision(tier="host"), intent.steps
        fs, snap = self.fastslow, context.snapshot
        if fs is None or snap is None:
            steps = await self.planner(intent, context)
            return Decision(tier="system2"), steps
        assert self.body is not None
        native_busy = isinstance(snap.raw, dict) and bool(snap.raw.get("native_busy"))  # adapters may flag native work
        focus = await fs.focus(intent.goal, snap, self._last_receipt, native_busy)
        if focus.get("choice") in ("survival", "wait"):
            return Decision(tier="reflex", defer=f"native owns the moment ({focus.get('choice')})", focus=focus), None
        route = fs.route(snap, intent.goal)
        profile = fs.profile(focus.get("choice"), failure=bool(self._last_receipt and self._last_receipt.status in ("failed", "unknown")))
        if intent.candidates and (route is None or route.level <= 1 or not route.should_call_llm or fs.typed or fs.worker):
            ident = self.body.identity()
            result = await fs.system1(intent.candidates, intent.goal, snap, ident.body_id if ident else None, self.body.snapshot,
                                      scope=ident.group_id() if ident else None)
            self.metrics.system_one(result)
            if result.get("ok"):
                return Decision(tier="system1", route=route, focus=focus, profile=profile, system1=result), [Step(**result["step"])]
            system1 = result
        else:
            system1 = None
        scene = {"goal": intent.goal[:300], "hp": snap.health, "dimension": snap.dimension,
                 "lastResult": self._last_receipt.status if self._last_receipt else None, "routeLevel": route.level if route else None}
        requested, effective = await fs.thinking_tier(route, profile, scene)
        decision = Decision(tier="system2", route=route, focus=focus, profile=profile, system1=system1,
                            requested_tier=requested, effective_tier=effective)
        fs.last_plan_at = fs.clock()
        steps = await self.planner(intent, context.model_copy(update={"decision": decision}))
        return decision, steps

    async def run_intent(self, intent: Intent) -> None:
        assert self.body is not None
        self._active = intent
        try:
            self._transition(intent, "active")
            context = await self._context(intent)
            if self.fastslow is not None or not intent.steps:
                context.snapshot = await self._snapshot()
            decision, steps = await self.decide(intent, context)
            intent.decision = decision
            self.metrics.decision(decision.tier, decision.requested_tier, decision.effective_tier)
            if decision.defer and intent.defers >= self.max_defers:
                self._transition(intent, "paused", f"native kept the body ({decision.defer}); host decides", needs_host=True)
                return
            if decision.defer:
                intent.defers += 1
                self.metrics.deferred[decision.defer] += 1
                intent.state, intent.defer_until = "queued", asyncio.get_running_loop().time() + self.defer_seconds
                self.emit("body", f"{intent.goal}: deferred, {decision.defer}", 1, {"intentId": intent.id})
                return
            if steps is None:
                self._transition(intent, "paused", "no steps: host must supply constraints.steps", needs_host=True)
                return
            intent.steps = steps
            caps = context.capabilities
            async with self.lease.hold(intent.id) as epoch:
                await self._run_steps(intent, caps, epoch)
            if intent.state == "active":
                if self.verifier is not None and (snap := await self._snapshot()) is not None:
                    intent.verified = await self.verifier(intent, snap)
                self.metrics.goals["completed_verified" if intent.verified else "completed_unverified"] += 1
                self._transition(intent, "completed")
            else:
                self.metrics.goals[intent.state] += 1
        except Exception as error:
            identity = self.body.identity()
            uncertain = bool(self.journal and identity and self.journal.unresolved(identity.body_id))
            self._transition(intent, "paused" if uncertain else "failed", "execution_or_planning_unavailable:" + type(error).__name__, needs_host=uncertain)
        finally:
            self._active = None
            self._settle_strategies(intent)
            trigger = self._trigger(intent)
            if trigger is not None and (jit := self._jitrl()) is not None and (scope := self._scope()) is not None:
                jit.credit(scope=scope, goal=intent.goal, outcome=trigger)  # mid-term discounted credit, new samples only
            if self.reflection is not None and trigger is not None:
                self.pool.submit("reflection", partial(self._reflect, intent, trigger))
            learning = self.fastslow.learning if self.fastslow else None
            if learning is not None and intent.decision is not None:
                self.pool.submit("learning", lambda: learning.record(intent.id, intent.decision, intent.receipts))  # type: ignore[arg-type]

    async def _run_steps(self, intent: Intent, caps: Capabilities | None, epoch: int) -> None:
        while intent.step_index < len(intent.steps) and intent.state == "active":
            step = intent.steps[intent.step_index]
            if (reason := step_support(step, caps)) is not None:
                self._transition(intent, "paused", reason, needs_host=True)
                return
            jit = self._jitrl()
            before = await self._snapshot() if jit is not None else None
            receipt = await self._execute(step, intent)
            intent.receipts.append(receipt)
            if jit is not None and before is not None and (scope := self._scope()) is not None:
                from .fastslow import observation
                after = await self._snapshot()
                jit.record_step(scope=scope, goal=intent.goal, step=step.model_dump(), status=receipt.status, before=observation(before),
                                after=observation(after) if after else None, request_id=receipt.request_id)
            self._last_receipt = receipt
            if self.fastslow is not None:
                self.fastslow.note(receipt)
            if intent.state != "active":
                return  # paused/cancelled by safety or host meanwhile
            if not self.lease.valid(epoch):
                self._transition(intent, "paused", "body lease preempted by a reflex", needs_host=True)
                return
            if receipt.status == "completed":
                intent.step_index += 1
                continue
            if receipt.status == "blocked_by_safety":
                self._transition(intent, "paused", f"safety halt: {receipt.text}", needs_host=True)
            elif receipt.status in ("unknown", "accepted"):
                self._transition(intent, "paused", f"outcome unknown for {step.tool}; reconcile result({receipt.request_id}), do not replay",
                                 needs_host=True)
            else:
                self._transition(intent, "failed", f"{step.tool}: {receipt.status} {receipt.text[:200]}")
            return

    async def _execute(self, step: Step, intent: Intent) -> ActionReceipt:
        assert self.body is not None
        rid = new_request_id("hs")
        identity = self.body.identity()
        body_key = identity.body_id if identity else ""
        action = step.action(rid)
        if self.journal is not None:
            if not body_key or self.journal.unresolved(body_key):
                return ActionReceipt(request_id=rid, verb=action.verb, status="unknown", terminal=False,
                                     text="unresolved_original_request_requires_reconciliation")
            # This commit must succeed before any body write is dispatched.
            self.journal.begin(body_key, action, intent.source_events, note=step.note if intent.remember_wait_purpose else None)
        future: asyncio.Future[BodyEvent] = asyncio.get_running_loop().create_future()
        self._results[rid] = future
        def record(receipt: ActionReceipt) -> ActionReceipt:
            if self.journal is not None:
                self.journal.settle(body_key, receipt)
            return receipt
        try:
            receipt = await self.body.act(action)
            if receipt.status != "accepted":
                return record(receipt)
            deadline = asyncio.get_running_loop().time() + self.step_timeout
            while not future.done() and intent.state == "active" and asyncio.get_running_loop().time() < deadline:
                await asyncio.wait({future}, timeout=0.25)
            if future.done():
                event = future.result()
                final = await self.body.result(rid)
                if final.terminal and final.request_id == rid:
                    return record(final)
                return record(receipt.model_copy(update={"status": event.status or "unknown", "terminal": event.status not in (None, "accepted", "unknown"), "text": event.text}))
            return record(await self.body.result(rid))
        finally:
            self._results.pop(rid, None)

    def _jitrl(self) -> Any:
        return self.fastslow.jitrl if self.fastslow is not None else None

    def _scope(self) -> str | None:
        identity = self.body.identity() if self.body is not None else None
        return identity.group_id() if identity is not None else None

    @staticmethod
    def _trigger(intent: Intent) -> Literal["failure", "milestone"] | None:
        if intent.state == "completed":
            return "milestone"
        if intent.state == "failed" or (intent.state == "paused" and intent.reason and
                                        any(k in intent.reason for k in ("safety", "died", "lease preempted"))):
            return "failure"
        return None  # unsettled ("outcome unknown") pauses are reconciled, not reflected on

    def outcome_evidence(self, intent: Intent) -> bool | None:
        """Environment-verified outcome: the verifier's answer, or a receipt where the body itself reported failure.
        Unverified completions and unknown effects are None (never evidence)."""
        if intent.state == "completed":
            return intent.verified
        if intent.state == "failed" and any(r.status == "failed" for r in intent.receipts):
            return False
        return None

    def _settle_strategies(self, intent: Intent) -> None:
        if self.strategies is None:
            return
        verified = self.outcome_evidence(intent)
        for key, version in intent.strategy_refs:
            self.strategies.record(key, version, verified)

    def active_lessons(self, limit: int = 5) -> list[tuple[str, int, str]]:
        if self.strategies is None or self.body is None or (identity := self.body.identity()) is None:
            return []
        rows = self.strategies.active_all(f"{identity.group_id()}:lesson:", "lesson")[-limit:]
        return [(v.key, v.version, f"{v.content.get('cue')}: {v.content.get('lesson')}") for v in rows]

    async def _reflect(self, intent: Intent, trigger: Literal["failure", "milestone"]) -> None:
        assert self.reflection is not None
        from .learning.reflection import ReflectionInput
        item = ReflectionInput(trigger=trigger, goal=intent.goal, intent_id=intent.id, state=intent.state, reason=intent.reason,
                               receipts=[{"requestId": r.request_id, "verb": r.verb, "status": r.status, "text": r.text[:300]} for r in intent.receipts],
                               events=[f"{e.kind}: {e.text[:120]}" for e in self.events if e.severity >= 2][-10:],
                               lessons=[t for _, _, t in self.active_lessons()],
                               jitrl=jit.stats(self._scope()) if (jit := self._jitrl()) is not None else None)
        try:
            reflection = await self.reflection.reflect(item)
        except Exception as error:
            self.emit("reflection", f"reflection failed ({type(error).__name__})", 1, {"intentId": intent.id})
            return
        if reflection is not None:
            self.emit("reflection", reflection.lesson, 1, {"intentId": intent.id, "trigger": trigger, "provenance": reflection.provenance})
