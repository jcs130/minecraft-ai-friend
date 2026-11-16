"""Safety hooks as a decorator over any BodyAdapter: anti-cheat warning stop + pace limits + veto hook.

The warning matcher is a port of agent-mc-world ``isMiningWarningText`` with ``MINING_LIMIT_DEFAULTS``
(packages/agent-mc-world/core/mining-limiter.ts). tests/test_safety.py parses that TypeScript file and fails
if the defaults drift.
"""
from __future__ import annotations

import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from ..models import MOTION_VERBS, ActionReceipt, BodyAction, BodyEvent, BodyHealth, SafetyCaps, SafetyState, utcnow
from .base import BodyAdapter, Listener

WARNING_KEYWORDS = ("反作弊", "自动挖矿", "挖矿外挂", "禁止挖", "自动化模组", "外挂")
WARNING_PATTERN = "反作弊|自动挖矿|挖矿外挂|禁止挖|自动化模组|外挂"
WARNING_CONFIRM_PATTERN = "你|检测|禁止|VL"
_COLOR = re.compile(r"§[0-9A-FK-ORX]", re.I)


def is_warning_text(text: str, keywords: tuple[str, ...] = WARNING_KEYWORDS, pattern: str = WARNING_PATTERN,
                    confirm: str = WARNING_CONFIRM_PATTERN) -> bool:
    """Same decision as agent-mc-world isMiningWarningText (player quotations `<name> ...` never count)."""
    if not text or re.match(r"^\s*<", _COLOR.sub("", text)):
        return False
    hit = any(k and k in text for k in keywords) or bool(pattern and re.search(pattern, text))
    return hit and (not confirm or bool(re.search(confirm, text, re.I)))


PACE_CATEGORY = {**{v: "motion" for v in ("move", "follow", "look", "flee", "recall", "interact", "use_item", "place", "collect")},
                 "mine": "dig", "attack": "combat", "cast": "combat", "chat": "chat"}
DEFAULT_PACE: dict[str, tuple[float, float]] = {"motion": (30, 6), "dig": (40, 8), "combat": (40, 8), "chat": (12, 3), "other": (120, 20)}


@dataclass
class TokenBucket:
    burst: float
    per_second: float
    clock: Callable[[], float] = time.monotonic
    tokens: float = field(init=False)
    at: float = field(init=False)

    def __post_init__(self) -> None:
        self.tokens, self.at = self.burst, self.clock()

    def take(self) -> float:
        """0 when admitted, else milliseconds until a token is available."""
        now = self.clock()
        self.tokens = min(self.burst, self.tokens + (now - self.at) * self.per_second)
        self.at = now
        if self.tokens >= 1:
            self.tokens -= 1
            return 0
        return (1 - self.tokens) / self.per_second * 1000


Veto = Callable[[BodyAction], Awaitable[str | None]]


class GuardedBody(BodyAdapter):
    """Delegates everything; adds the safety layer. Native guards of the body stay in force underneath."""

    def __init__(self, inner: BodyAdapter, *, pace: dict[str, tuple[float, float]] | None = None, halt_seconds: float | None = None,
                 before_action: Veto | None = None, warning: Callable[[str], bool] = is_warning_text,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.inner, self.kind = inner, inner.kind
        self.clock, self.warning, self.before_action, self.halt_seconds = clock, warning, before_action, halt_seconds
        self.buckets = {k: TokenBucket(b, r, clock) for k, (b, r) in {**DEFAULT_PACE, **(pace or {})}.items()}
        self.state = SafetyState()
        self._halt_until: float | None = None
        self._listeners: list[Listener] = []
        self._unsub = inner.subscribe(self._on_event)

    # ---- safety ------------------------------------------------------------------------------------
    def _on_event(self, event: BodyEvent) -> None:
        for listener in list(self._listeners):
            listener(event)
        if event.kind in ("system_message", "server_status") and self.warning(event.text):
            self.trip(event.text)

    def feed_server_text(self, text: str) -> bool:
        """Hosts whose body cannot see server chat (maid, hosted Numen) feed the owner connection's system text here."""
        if self.warning(text):
            self.trip(text)
            return True
        return False

    def trip(self, text: str) -> None:
        if self.halted():
            return
        self.state = SafetyState(halted=True, reason=text[:300], since=utcnow())
        self._halt_until = None if self.halt_seconds is None else self.clock() + self.halt_seconds
        event = BodyEvent(kind="safety", body_kind=self.kind, body_id=(i.body_id if (i := self.identity()) else None), severity=3,
                          text="anti-cheat warning: halted motion until cleared", data={"reason": self.state.reason})
        for listener in list(self._listeners):
            listener(event)
        import asyncio
        try:
            asyncio.get_running_loop().create_task(self.inner.stop("anti-cheat warning"))
        except RuntimeError:
            pass

    def halted(self) -> bool:
        if self.state.halted and self._halt_until is not None and self.clock() >= self._halt_until:
            self.clear_halt()
        return self.state.halted

    def clear_halt(self) -> None:
        self.state, self._halt_until = SafetyState(), None

    # ---- BodyAdapter -------------------------------------------------------------------------------
    def identity(self):
        return self.inner.identity()

    def capabilities(self):
        caps = self.inner.capabilities()
        return caps.model_copy(update={"safety": SafetyCaps(anti_cheat_stop=True, pace_limits=True, native_guards=caps.safety.native_guards)})

    def lifecycle(self):
        return self.inner.lifecycle()

    async def spawn(self) -> None:
        await self.inner.spawn()

    async def reconnect(self) -> None:
        await self.inner.reconnect()

    async def destroy(self) -> None:
        await self.inner.destroy()

    async def act(self, action: BodyAction) -> ActionReceipt:
        rid = action.request_id or ""
        native_write = action.verb == "native" and not any(n.name == action.name and n.read_only for n in self.inner.capabilities().native_actions)
        if self.halted() and (action.verb in MOTION_VERBS or native_write):
            return ActionReceipt(request_id=rid or "blocked", verb=action.verb, status="blocked_by_safety", terminal=True,
                                 text=f"safety halt: {self.state.reason}")
        if self.before_action and (reason := await self.before_action(action)):
            return ActionReceipt(request_id=rid or "blocked", verb=action.verb, status="blocked_by_safety", terminal=True, text=reason)
        bucket = self.buckets.get(PACE_CATEGORY.get(action.verb, "other"))
        if bucket and action.verb != "stop" and (wait_ms := bucket.take()):
            return ActionReceipt(request_id=rid or "paced", verb=action.verb, status="rejected", terminal=True,
                                 text="pace limit", retry_after_ms=int(wait_ms) + 1)
        return await self.inner.act(action)

    async def result(self, request_id: str) -> ActionReceipt:
        return await self.inner.result(request_id)

    async def stop(self, reason: str | None = None) -> ActionReceipt:
        return await self.inner.stop(reason)

    async def snapshot(self):
        return await self.inner.snapshot()

    def subscribe(self, listener: Listener):
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def health(self) -> BodyHealth:
        return self.inner.health().model_copy(update={"safety": self.state.model_copy()})

    def __getattr__(self, name: str) -> Any:  # expose adapter-specific helpers (feed_envelope, port ...)
        if name == "inner":
            raise AttributeError(name)
        return getattr(self.inner, name)


def guard_body(body: BodyAdapter, **options: Any) -> GuardedBody:
    return GuardedBody(body, **options)
