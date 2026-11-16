"""BodyAdapter interface and the shared base that enforces the protocol's semantics.

Every adapter keeps the same rules (checked by tests/test_contract.py):
  * refuse before sending: requestId format -> known verb -> earlier receipt (returned as-is) -> connected
    -> capability / native name -> argument shape; only then does the body see a write;
  * never replay: ``retry_allowed`` is always False; an uncertain write is ``unknown`` and is reconciled
    with ``result(request_id)`` through the body's own receipt query;
  * lifecycle never creates or deletes a persistent companion.
"""
from __future__ import annotations

import abc
import asyncio
import contextlib
import uuid
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime
from typing import Any

from ..models import (
    ACTION_VERBS,
    REQUEST_ID,
    TERMINAL_STATUSES,
    ActionReceipt,
    ActionStatus,
    BodyAction,
    BodyEvent,
    BodyHealth,
    BodyIdentity,
    BodyKind,
    BodySnapshot,
    Capabilities,
    Counters,
    LifecycleState,
    utcnow,
)

Listener = Callable[[BodyEvent], None]


class ArgumentError(ValueError):
    """Bad arguments for a supported verb: the action is rejected and nothing is sent."""


def new_request_id(prefix: str = "rq") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


class BodyAdapter(abc.ABC):
    """The unified surface every server-hosted body implements."""

    kind: BodyKind

    @abc.abstractmethod
    def identity(self) -> BodyIdentity | None: ...
    @abc.abstractmethod
    def capabilities(self) -> Capabilities: ...
    @abc.abstractmethod
    def lifecycle(self) -> LifecycleState: ...
    @abc.abstractmethod
    async def spawn(self) -> None:
        """Bring the body under control (attach / bind). Never creates a second body for the same identity."""
    @abc.abstractmethod
    async def reconnect(self) -> None: ...
    @abc.abstractmethod
    async def destroy(self) -> None:
        """Release control. Never deletes a persistent companion."""
    @abc.abstractmethod
    async def act(self, action: BodyAction) -> ActionReceipt: ...
    @abc.abstractmethod
    async def result(self, request_id: str) -> ActionReceipt:
        """Reconcile an earlier request without re-executing it."""
    @abc.abstractmethod
    async def stop(self, reason: str | None = None) -> ActionReceipt: ...
    @abc.abstractmethod
    async def snapshot(self) -> BodySnapshot: ...
    @abc.abstractmethod
    def subscribe(self, listener: Listener) -> Callable[[], None]: ...
    @abc.abstractmethod
    def health(self) -> BodyHealth: ...

    def events(self, maxsize: int = 256) -> tuple[asyncio.Queue[BodyEvent], Callable[[], None]]:
        """Convenience: an asyncio queue fed by subscribe(); oldest events are dropped when full."""
        queue: asyncio.Queue[BodyEvent] = asyncio.Queue(maxsize)

        def push(event: BodyEvent) -> None:
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(event)
        return queue, self.subscribe(push)


DEFAULT_SEVERITY: dict[str, int] = {"death": 3, "safety": 3, "respawn": 2, "lifecycle": 2, "connection": 2, "dimension": 2,
                                    "whisper": 2, "dialogue": 2, "combat": 2, "action_result": 2}


class BaseBody(BodyAdapter):
    """Listeners, lifecycle state, a bounded receipt ledger, counters and the validation order."""

    LEDGER = 500

    def __init__(self) -> None:
        self._listeners: list[Listener] = []
        self._state: LifecycleState = "detached"
        self._since = utcnow()
        self._receipts: OrderedDict[str, ActionReceipt] = OrderedDict()
        self.counters = Counters()
        self.last_error: str | None = None
        self._last_event: datetime | None = None
        self._last_action: datetime | None = None

    # ---- hooks for subclasses -------------------------------------------------------------------
    @abc.abstractmethod
    async def _do_act(self, action: BodyAction, request_id: str) -> ActionReceipt: ...

    async def _do_result(self, request_id: str, previous: ActionReceipt) -> ActionReceipt:
        return previous

    def _connected(self) -> bool:
        return self._state == "ready" or self._state == "dead"

    # ---- shared ---------------------------------------------------------------------------------
    def lifecycle(self) -> LifecycleState:
        return self._state

    def _set_state(self, state: LifecycleState, text: str = "", **data: Any) -> None:
        if state == self._state:
            return
        previous, self._state, self._since = self._state, state, utcnow()
        self.emit("lifecycle", text or f"body {previous} -> {state}", data={"from": previous, "state": state, **data})

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        self._listeners.append(listener)

        def unsubscribe() -> None:
            with contextlib.suppress(ValueError):
                self._listeners.remove(listener)
        return unsubscribe

    def emit(self, kind: str, text: str = "", *, severity: int | None = None, data: dict[str, Any] | None = None,
             request_id: str | None = None, status: ActionStatus | None = None, raw: Any = None) -> BodyEvent:
        ident = self.identity()
        event = BodyEvent(kind=kind, body_kind=self.kind, body_id=ident.body_id if ident else None, text=text[:4000],
                          severity=severity or DEFAULT_SEVERITY.get(kind, 1), data=data or {}, request_id=request_id,
                          status=status, raw=raw)
        self.counters.events += 1
        self._last_event = event.at
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception as error:  # a broken listener never breaks the body
                self.counters.errors += 1
                self.last_error = f"listener: {type(error).__name__}"
        return event

    def _remember(self, receipt: ActionReceipt) -> ActionReceipt:
        self._receipts[receipt.request_id] = receipt
        self._receipts.move_to_end(receipt.request_id)
        while len(self._receipts) > self.LEDGER:
            self._receipts.popitem(last=False)
        return receipt

    def _count(self, receipt: ActionReceipt) -> None:
        c = self.counters
        if receipt.status == "completed":
            c.completed += 1
        elif receipt.status == "accepted":
            c.accepted += 1
        elif receipt.status in ("failed", "rejected"):
            c.failed += 1
        elif receipt.status == "unknown":
            c.unknown += 1
        elif receipt.status == "unsupported":
            c.unsupported += 1
        elif receipt.status == "blocked_by_safety":
            c.safety_blocked += 1

    @staticmethod
    def receipt(request_id: str, verb: str, status: ActionStatus, text: str = "", **extra: Any) -> ActionReceipt:
        return ActionReceipt(request_id=request_id, verb=verb, status=status, terminal=status in TERMINAL_STATUSES, text=text, **extra)

    async def act(self, action: BodyAction) -> ActionReceipt:
        rid = action.request_id or new_request_id()
        verb = action.verb
        if not REQUEST_ID.match(rid):
            return self.receipt(rid[:48] or "invalid", verb, "rejected", "requestId must match [A-Za-z0-9_-]{8,48}")
        if verb not in ACTION_VERBS:
            return self.receipt(rid, verb, "rejected", f"unknown verb {verb}")
        if rid in self._receipts:
            return self._receipts[rid]
        if not self._connected():
            return self.receipt(rid, verb, "rejected", f"body is {self._state}; spawn() first")
        caps = self.capabilities()
        if verb == "native" and not caps.supports("native", action.name):
            return self._finish(self.receipt(rid, verb, "unsupported", f"native operation {action.name!r} is not offered by this body"))
        if verb != "native" and not caps.supports(verb):
            return self._finish(self.receipt(rid, verb, "unsupported", f"{self.kind} body does not support verb {verb}"))
        if not isinstance(action.args, dict):
            return self._finish(self.receipt(rid, verb, "rejected", "args must be an object"))
        self.counters.actions += 1
        self._last_action = utcnow()
        try:
            receipt = await self._do_act(action, rid)
        except ArgumentError as error:
            receipt = self.receipt(rid, verb, "rejected", str(error))
        except asyncio.CancelledError:
            receipt = self.receipt(rid, verb, "unknown", "interrupted; delivery uncertain - query result(), do not replay")
            self._finish(receipt)
            raise
        except Exception as error:
            self.last_error = f"{type(error).__name__}"
            receipt = self.receipt(rid, verb, "unknown", f"delivery uncertain ({type(error).__name__}); query result(), do not replay")
        return self._finish(receipt)

    def _finish(self, receipt: ActionReceipt) -> ActionReceipt:
        self._count(receipt)
        return self._remember(receipt)

    def settle(self, request_id: str, status: ActionStatus, text: str = "", data: Any = None) -> ActionReceipt | None:
        """Turn an accepted/unknown receipt terminal and emit exactly one action_result."""
        previous = self._receipts.get(request_id)
        if previous is None or previous.terminal:
            return previous
        final = previous.model_copy(update={"status": status, "terminal": status in TERMINAL_STATUSES,
                                            "text": text or previous.text, "data": data if data is not None else previous.data})
        self._remember(final)
        self._count(final)
        self.emit("action_result", text or f"{previous.verb} {status}", request_id=request_id, status=status,
                  data={"verb": previous.verb, "executionId": previous.execution_id})
        return final

    async def result(self, request_id: str) -> ActionReceipt:
        previous = self._receipts.get(request_id)
        if previous is None:
            return self.receipt(request_id, "native", "unknown", "no receipt for this requestId in this adapter")
        if previous.terminal and previous.status != "unknown":
            return previous
        try:
            return await self._do_result(request_id, previous)
        except Exception as error:
            self.last_error = type(error).__name__
            return previous

    def health(self) -> BodyHealth:
        return BodyHealth(kind=self.kind, lifecycle=self._state, connected=self._connected(), since=self._since,
                          last_event_at=self._last_event, last_action_at=self._last_action,
                          counters=self.counters.model_copy(), last_error=self.last_error)


def obj(args: dict[str, Any], key: str, kind: type | tuple[type, ...], *, required: bool = True, default: Any = None) -> Any:
    value = args.get(key, default)
    if value is None:
        if required:
            raise ArgumentError(f"missing argument {key}")
        return default
    if isinstance(value, bool) and kind is not bool and bool not in (kind if isinstance(kind, tuple) else (kind,)):
        raise ArgumentError(f"{key} has the wrong type")
    if not isinstance(value, kind):
        raise ArgumentError(f"{key} has the wrong type")
    return value


def xyz(args: dict[str, Any]) -> tuple[float, float, float]:
    out = []
    for key in ("x", "y", "z"):
        value = obj(args, key, (int, float))
        if not -30_000_000 <= value <= 30_000_000:
            raise ArgumentError(f"{key} out of range")
        out.append(float(value))
    return out[0], out[1], out[2]
