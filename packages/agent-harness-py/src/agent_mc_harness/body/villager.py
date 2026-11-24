"""Existing managed villager body (``qiandengji-villager-body/v1``).

Java owns entity lifecycle, world guards and delivery. This adapter binds the original UUID, exposes only
observe/chat/move/stop, advances the native inbox cursor and reconciles writes with their original receipts.
It never creates, deletes or transfers a villager and never treats a voice submission as a delivered reply.
"""
from __future__ import annotations

import asyncio
import contextlib
import math
import re
import time
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from ..bridges import ControlChanged, NativeVillagerBridge, VillagerRequestRejected, json_text
from ..models import (
    ActionReceipt,
    ActionStatus,
    ActionSupport,
    BodyAction,
    BodyEventKind,
    BodyIdentity,
    BodySnapshot,
    Capabilities,
    LifecycleCaps,
    SafetyCaps,
    Scope,
    WorldRef,
)
from .base import ArgumentError, BaseBody, new_request_id, obj, xyz

UUID_TEXT = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z")
REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,48}\Z")
DIALOGUE_TTL_MS = 120_000
CONTEXT_TTL_MS = 30_000
MAX_INBOX = 64

VERBS: dict[str, tuple[str, tuple[str, ...], bool]] = {
    "observe": ("context", (), False),
    "chat": ("speak", ("text", "eventId", "listenerId"), False),
    "move": ("walk", ("x", "y", "z"), True),
    "stop": ("stop", (), False),
}
PENDING = {"accepted", "queued", "pending", "running"}
FAILED = {"rejected", "failed", "blocked", "cancelled", "expired", "unavailable"}


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value) else None


def _position(value: Any) -> dict[str, float] | None:
    if isinstance(value, dict) and all(_number(value.get(key)) is not None for key in "xyz"):
        return {key: float(value[key]) for key in "xyz"}
    return None


def _millis(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float) and math.isfinite(value):
        return float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            return None
    return None


def _fresh(at_ms: float, now_ms: float) -> bool:
    return -30_000 <= now_ms - at_ms <= DIALOGUE_TTL_MS


def receipt_status(value: Any) -> ActionStatus:
    """The native statuses are explicit; an unstructured success is not proof of completion."""
    if not isinstance(value, dict):
        return "unknown"
    status = value.get("status")
    if status in ("accepted", "queued", "pending", "running"):
        return "accepted"
    if status in ("rejected", "failed", "blocked", "cancelled", "expired", "unavailable"):
        return "failed" if status in ("failed", "unavailable") else "rejected"
    if status == "completed":
        return "completed"
    if status == "unknown" or value.get("ok") is not True:
        return "unknown"
    return "unknown"


class VillagerBody(BaseBody):
    kind = "villager"

    def __init__(self, bridge: NativeVillagerBridge, *, scope: Scope, resident_id: str | None = None,
                 body_id: str | None = None, controller_id: str | None = None, server_id: str | None = None,
                 open_bridge: bool = True, poll_seconds: float = 2.0, result_poll_seconds: float = 2.0) -> None:
        super().__init__()
        self.bridge = bridge
        self.scope = scope
        self.resident_id = resident_id or bridge.resident_id
        self.body_id = (body_id or bridge.body_id).lower()
        self.controller_id = (controller_id or bridge.controller_id).lower()
        self.server_id = server_id
        self.open_bridge = open_bridge
        self.poll_seconds, self.result_poll_seconds = poll_seconds, result_poll_seconds
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", self.resident_id):
            raise ValueError("resident_id must be a stable registered resident ID")
        if UUID_TEXT.fullmatch(self.body_id) is None or UUID_TEXT.fullmatch(self.controller_id) is None:
            raise ValueError("body_id and controller_id must be UUIDs")
        if (self.resident_id, self.body_id, self.controller_id) != (bridge.resident_id, bridge.body_id, bridge.controller_id):
            raise ValueError("villager bridge and body identities must match")
        # This is a server namespace, NOT ownership by a nearby player or by the entity itself.
        self.owner_id = str(uuid5(NAMESPACE_URL, f"villager-body/{scope.realm}/{self.resident_id}/{self.body_id}"))
        self.cursor: int | None = None
        self._identity: BodyIdentity | None = None
        self._actions: list[str] = []
        self._schema: dict[str, Any] = {}
        self._tasks: list[asyncio.Task[None]] = []
        self._context: dict[str, Any] = {}
        self._context_at = 0.0
        self._life = "unknown"
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._speech_targets: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self._act_lock = asyncio.Lock()

    # ---- discovery/lifecycle ----------------------------------------------------------------------
    def identity(self) -> BodyIdentity | None:
        return self._identity

    def capabilities(self) -> Capabilities:
        offered = set(self._actions)
        actions = {verb: ActionSupport(native=f"mc_villager {native}", args=list(args), async_=async_)
                   for verb, (native, args, async_) in VERBS.items() if native in offered}
        events: list[BodyEventKind] = ["dialogue", "action_result", "lifecycle"]
        return Capabilities(
            kind="villager", transport=self.bridge.transport, actions=actions,
            events=events, snapshot=["life_state", "position", "dimension", "health", "text"],
            lifecycle=LifecycleCaps(spawn="bind-existing", reconnect=False, destroy="release"), perception="poll",
            safety=SafetyCaps(native_guards=["authenticated loopback endpoint", "resident/body/controller identity",
                                             "server controller generation", "main-thread native game guards",
                                             "no automatic write replay or entity replacement"]),
            limits=["bind-existing; destroy releases control without deleting the entity",
                    "walk is accepted until the server measures arrival or times out",
                    "replies require the original fresh event and listener; otherwise speech is proactive",
                    "text caption delivery and voice submission are separate observations"],
        )

    async def spawn(self) -> None:
        if self._state in ("ready", "spawning"):
            return
        self._set_state("spawning")
        try:
            if self.open_bridge and not self.bridge.tools:
                await self.bridge.open()
            if self.bridge.generation is None:
                raise RuntimeError("villager bridge must be bound by its transport")
            tool = next((row for row in self.bridge.tools if row.get("name") == "mc_villager"), None)
            if tool is None:
                raise RuntimeError("transport does not expose mc_villager")
            self._schema = tool.get("inputSchema") or {}
            self._actions = list(self._schema.get("properties", {}).get("action", {}).get("enum", []))
            await self._read_context(emit=False)
        except Exception as error:
            self.last_error = type(error).__name__
            self._set_state("error", f"bind failed: {error}"[:300])
            if self.open_bridge:
                try:
                    await self.bridge.close()
                except Exception as release_error:
                    raise RuntimeError("bind_failed_control_release_unconfirmed") from release_error
            raise
        self._identity = BodyIdentity(
            kind="villager", body_id=self.body_id, name=self._context.get("name"), owner_id=self.owner_id,
            world=WorldRef(server_id=self.server_id, dimension=self._context.get("dimension")), scope=self.scope,
            generation=self.bridge.generation,
        )
        self._set_state("ready", "villager bound (existing entity)")
        self._tasks = []
        if self.poll_seconds > 0:
            self._tasks.append(asyncio.create_task(self._loop(self.poll_seconds, self.poll_once), name="villager-events"))
        if self.result_poll_seconds > 0:
            self._tasks.append(asyncio.create_task(self._loop(self.result_poll_seconds, self.reconcile), name="villager-results"))

    async def reconnect(self) -> None:
        # A stale generation is a fence, not permission to silently acquire a new controller.
        raise RuntimeError("villager_reconnect_requires_explicit_new_binding")

    async def destroy(self) -> None:
        await self._halt_tasks()
        try:
            if self.open_bridge:
                await self.bridge.close()
        except Exception:
            self._set_state("error", "control release unconfirmed; inspect the original controller")
            raise
        self._set_state("destroyed", "released; the original villager and its native AI remain")

    async def _halt_tasks(self) -> None:
        tasks, self._tasks = self._tasks, []
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _loop(self, seconds: float, fn: Any) -> None:
        while True:
            await asyncio.sleep(seconds)
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except ControlChanged:
                return
            except Exception as error:
                self.last_error = type(error).__name__

    # ---- transport/results ------------------------------------------------------------------------
    async def _villager(self, args: dict[str, Any], request_id: str | None = None) -> tuple[Any, dict[str, Any]]:
        try:
            result = await self.bridge.call("mc_villager", args, request_id=request_id)
        except ControlChanged:
            self._set_state("error", "server control changed; explicit handoff required")
            raise
        except VillagerRequestRejected as error:
            status = "unknown" if error.original_request else "rejected"
            return {"ok": False, "status": status, "reason": str(error)}, {"isError": True}
        return json_text(result), result

    def _failed_read(self, request_id: str, verb: str, action: str) -> ActionReceipt:
        return self.receipt(request_id, verb, "failed", "read_result_unavailable; obtain a fresh observation",
                            data={"villagerAction": action, "readOnly": True, "effectsApplied": False})

    def _verify(self, reply: Any, action: str, request_id: str | None = None) -> bool:
        if not isinstance(reply, dict) or reply.get("ok") is not True or not isinstance(reply.get("data"), dict):
            return False
        data = reply["data"]
        return (data.get("residentId", self.resident_id) == self.resident_id
                and data.get("bodyId", self.body_id) == self.body_id
                and data.get("action", action) == action
                and (request_id is None or data.get("operationId", request_id) == request_id))

    def _valid_receipt(self, value: Any, request_id: str, action: str) -> bool:
        if not isinstance(value, dict):
            return False
        terminal = value.get("terminal")
        status = value.get("status")
        return (value.get("schemaVersion") == 1 and value.get("residentId") == self.resident_id
                and value.get("bodyId") == self.body_id and value.get("operationId") == request_id
                and value.get("action") == action and value.get("retryAllowed") is False
                and status in {"accepted", "completed", "failed", "rejected", "unknown"}
                and type(terminal) is bool
                and (terminal is (status not in {"accepted", "unknown"}) or status == "unknown"))

    async def act(self, action: BodyAction) -> ActionReceipt:
        action = action.model_copy(deep=True)
        action.request_id = action.request_id or new_request_id()
        # Reserve the signature before yielding so concurrent equal requests cannot both cross the network.
        async with self._act_lock:
            previous = self._dispatching.get(action.request_id) or self._receipts.get(action.request_id)
            if previous is not None:
                return await super().act(action)
            try:
                from .base import _request_signature
                self._request_signatures[action.request_id] = _request_signature(action)
            except (TypeError, ValueError):
                return self.receipt(action.request_id, action.verb, "rejected", "args must contain JSON values")
            return await super().act(action)

    async def _do_act(self, action: BodyAction, request_id: str) -> ActionReceipt:
        if action.verb == "native":
            if action.name != "mc_villager":
                return self.receipt(request_id, action.verb, "unsupported", "only the bound mc_villager tool is available")
            return await self._native_act(action, request_id)
        native, names, _ = VERBS[action.verb]
        args = {"action": native}
        for key in names:
            if key in action.args:
                args[key] = action.args[key]
        if set(action.args) - set(names):
            raise ArgumentError("unexpected villager action arguments")
        if native == "speak":
            text = obj(action.args, "text", str)
            if not 1 <= len(text) <= 140 or not text.isprintable() or text.startswith("/") or "§" in text:
                raise ArgumentError("text must be 1..140 printable characters without commands or formatting")
            await self._bind_speech(args, action)
        elif native == "walk":
            args["x"], args["y"], args["z"] = xyz(action.args)
        args["requestId"] = request_id
        try:
            reply, result = await self._villager(args, request_id)
        except ControlChanged:
            raise
        except Exception:
            # The send may have committed. Only the original receipt can settle this request.
            return self.receipt(request_id, action.verb, "unknown",
                                "delivery uncertain; query the original server receipt, do not replay",
                                execution_id=request_id, data={"villagerAction": native})
        status = "unknown"
        operation = request_id
        entry = None
        if self._verify(reply, native, request_id):
            entry = reply["data"]
            operation = entry.get("operationId", request_id)
            status = receipt_status(entry)
            payload = entry.get("data") if isinstance(entry.get("data"), dict) else {}
            if native == "walk" and status == "completed" and payload.get(
                    "goalCompleted", payload.get("measuredArrival", entry.get("goalCompleted"))) is not True:
                status = "accepted"
        elif isinstance(reply, dict) and reply.get("status") in ("rejected", "unknown"):
            status = "rejected" if reply["status"] == "rejected" else "unknown"
        text = str((reply or {}).get("reason") or (reply or {}).get("error") or f"{native} {status}") if isinstance(reply, dict) else f"{native} {status}"
        reply_data = reply
        if entry is not None:
            payload = entry.get("data") if isinstance(entry.get("data"), dict) else {}
            reply_data = {"ok": True, "data": payload, "receipt": entry}
        receipt = self.receipt(request_id, action.verb, status, text[:2000], execution_id=operation,
                               data={"villagerAction": native, "reply": reply_data})
        if receipt.terminal:
            self.emit("action_result", text[:300], request_id=request_id, status=status,
                      data={"verb": action.verb, "villagerAction": native})
        return receipt

    async def _native_act(self, action: BodyAction, request_id: str) -> ActionReceipt:
        if not action.name or action.name != "mc_villager":
            return self.receipt(request_id, "native", "unsupported", "unknown native villager action")
        native = action.args.get("action")
        if native not in {row[0] for row in VERBS.values()}:
            raise ArgumentError("unknown mc_villager action")
        # Native calls cannot smuggle a different verb or bypass unified argument validation.
        verb = next((key for key, value in VERBS.items() if value[0] == native), None)
        if verb is None:
            raise ArgumentError("native action is not in the bounded villager catalogue")
        return await self._do_act(BodyAction(verb=verb, args={k: v for k, v in action.args.items() if k != "action"},
                                             request_id=request_id), request_id)

    async def stop(self, reason: str | None = None) -> ActionReceipt:
        if "stop" not in self.capabilities().actions:
            return self.receipt("stop_unsupported", "stop", "unsupported", "villager stop is not offered")
        return await self.act(BodyAction(verb="stop", request_id=new_request_id("stop")))

    def restore_request(self, action: BodyAction) -> None:
        """Restore an uncertain original write after restart without sending it again."""
        if not action.request_id or REQUEST_ID.fullmatch(action.request_id) is None:
            raise ValueError("original_request_id_required")
        if action.verb in VERBS:
            native = VERBS[action.verb][0]
        elif action.verb == "native" and action.name == "mc_villager":
            native = action.args.get("action")
        else:
            raise ValueError("unsupported_villager_original_request")
        if native not in {"walk", "speak", "stop"}:
            raise ValueError("unsupported_villager_original_request")
        from .base import _request_signature
        rid = action.request_id
        signature = _request_signature(action)
        if self._request_signatures.setdefault(rid, signature) != signature:
            raise ValueError("request_id_conflict; query the original request")
        if rid not in self._dispatching and rid not in self._receipts:
            self._remember(self.receipt(rid, action.verb, "unknown", "restored_dispatch_query_original_receipt",
                                        data={"villagerAction": native}))
        if native == "speak":
            event_id, listener = action.args.get("eventId"), action.args.get("listenerId")
            if isinstance(event_id, str) and isinstance(listener, str) and UUID_TEXT.fullmatch(listener):
                self._speech_targets[rid] = (event_id, listener.lower())

    async def result(self, request_id: str) -> ActionReceipt:
        if REQUEST_ID.fullmatch(request_id) is None:
            return self.receipt(request_id[:48] or "invalid", "native", "rejected", "invalid original requestId")
        previous = self._receipts.get(request_id)
        if (previous is not None and previous.terminal and previous.status == "completed"
                and (previous.data or {}).get("villagerAction") == "speak"):
            return await self._do_result(request_id, previous)
        return await super().result(request_id)

    async def _do_result(self, request_id: str, previous: ActionReceipt) -> ActionReceipt:
        data = previous.data if isinstance(previous.data, dict) else {}
        action = data.get("villagerAction")
        if action not in {"walk", "speak", "stop"}:
            return previous
        reply, _ = await self._villager({"action": "receipt", "operationId": request_id, "operationAction": action})
        if not self._verify(reply, action, request_id) or not self._valid_receipt(reply["data"], request_id, action):
            return previous
        value = reply["data"]
        status = receipt_status(value)
        payload = dict(value.get("data")) if isinstance(value.get("data"), dict) else {}
        if isinstance(value.get("voiceStatus"), dict):
            payload["voiceStatus"] = value["voiceStatus"]
        if action == "walk" and status == "completed" and payload.get(
                "goalCompleted", payload.get("measuredArrival", value.get("goalCompleted"))) is not True:
            return previous
        if action == "speak" and previous.terminal:
            if isinstance(value.get("voiceStatus"), dict):
                payload["voiceStatus"] = value["voiceStatus"]
                data = dict(previous.data or {})
                data["reply"] = {**(data.get("reply") or {}), "data": payload, "receipt": value}
                refreshed = previous.model_copy(update={"data": data})
                self._remember(refreshed)
                return refreshed
            return previous
        if status == "accepted" or status == "unknown":
            return previous
        data = {"villagerAction": action, "reply": {"ok": True, "data": payload, "receipt": value}}
        settled = self.settle(request_id, status, f"receipt: {status}", data)
        return settled or previous

    async def reconcile(self) -> None:
        for request_id, receipt in list(self._receipts.items())[-32:]:
            action = (receipt.data or {}).get("villagerAction")
            if ((receipt.status in {"accepted", "unknown"} and action in {"walk", "speak", "stop"})
                    or receipt.status == "completed" and action == "speak"):
                with contextlib.suppress(Exception):
                    await self._do_result(request_id, receipt)

    # ---- perception/dialogue -----------------------------------------------------------------------
    async def _read_context(self, emit: bool = True) -> None:
        reply, _ = await self._villager({"action": "context"})
        if not self._verify(reply, "context"):
            raise RuntimeError("villager_context_unavailable_or_identity_mismatch")
        data = reply["data"]
        observed = _millis(data.get("observedAt"))
        if observed is None:
            raise RuntimeError("villager_context_missing_observation_time")
        previous = self._context
        self._context = data
        self._context_at = observed
        if data.get("health") == 0:
            self._life = "dead"
        elif data.get("loaded") is False:
            self._life = "unloaded"
        elif _number(data.get("health")) is not None:
            self._life = "alive"
        else:
            self._life = "unknown"
        if emit and previous.get("dimension") and previous.get("dimension") != data.get("dimension"):
            self.emit("dimension", f"dimension {data.get('dimension')}", data={"dimension": data.get("dimension")})
        if self._life == "dead" and self._state == "ready":
            self._state = "dead"
        elif self._life == "alive" and self._state == "dead":
            self._state = "ready"

    async def snapshot(self) -> BodySnapshot:
        await self._read_context(emit=True)
        data = self._context
        return BodySnapshot(
            sampled_at=datetime.fromtimestamp(self._context_at / 1000, UTC), life_state=self._life,
            position=_position(data.get("position")), dimension=data.get("dimension"),
            health=_number(data.get("health")), max_health=_number(data.get("maxHealth")),
            text=f"villager {self.resident_id}/{self.body_id} profession={data.get('profession')}", raw=data,
        )

    def _fresh_event(self, event_id: str) -> bool:
        if event_id in self._seen:
            return False
        self._seen[event_id] = None
        while len(self._seen) > 2048:
            self._seen.popitem(last=False)
        return True

    async def poll_once(self) -> int:
        if "inbox" not in self._actions:
            return 0
        args = {"action": "inbox", "limit": MAX_INBOX}
        if self.cursor is not None:
            args["cursor"] = self.cursor
        reply, _ = await self._villager(args)
        if not self._verify(reply, "inbox"):
            return 0
        data = reply["data"]
        rows = data.get("events")
        next_cursor = data.get("nextCursor")
        if (not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows)
                or type(next_cursor) is not int or next_cursor < 0
                or self.cursor is not None and next_cursor < self.cursor):
            raise RuntimeError("villager_inbox_invalid_page")
        count = 0
        for row in rows:
            event_id = row.get("eventId")
            if not isinstance(event_id, str) or not event_id or not self._fresh_event(event_id):
                continue
            self.emit("dialogue", str(row.get("text") or "")[:1000], severity=2,
                      data={"eventId": event_id, "residentId": self.resident_id, "bodyId": self.body_id,
                            "listenerId": row.get("listenerId"), "speakerId": row.get("speakerId"), "speaker": row.get("speaker"),
                            "channel": row.get("channel"), "deliveryScope": row.get("deliveryScope"),
                            "occurredAt": row.get("occurredAt"), "world": row.get("world"),
                            "source": "server_attributed_villager_dialogue", "serverAttributed": True, "trusted": False},
                      raw=row)
            count += 1
        # A malformed page never advances the cursor and cannot make an event disappear.
        self.cursor = next_cursor
        return count

    async def _bind_speech(self, args: dict[str, Any], action: BodyAction) -> None:
        explicit_event, explicit_listener = action.args.get("eventId"), action.args.get("listenerId")
        if explicit_event is not None and not isinstance(explicit_event, str):
            raise ArgumentError("eventId must be a string")
        if explicit_listener is not None and (not isinstance(explicit_listener, str) or UUID_TEXT.fullmatch(explicit_listener) is None):
            raise ArgumentError("listenerId must be a player UUID")
        if (explicit_event is None) != (explicit_listener is None):
            raise ArgumentError("eventId and listenerId must be supplied together")
        if explicit_event is not None:
            event_id, listener = explicit_event, explicit_listener.lower()
        else:
            now = time.time() * 1000
            candidates = []
            if not self._context or now - self._context_at > CONTEXT_TTL_MS:
                await self._read_context(emit=False)
            reply, _ = await self._villager({"action": "inbox", "limit": MAX_INBOX,
                                             **({"cursor": self.cursor} if self.cursor is not None else {})})
            if self._verify(reply, "inbox") and isinstance(reply["data"].get("events"), list):
                for row in reply["data"]["events"]:
                    if (not isinstance(row, dict) or row.get("bodyId", self.body_id) != self.body_id
                            or row.get("listenerId", self.body_id) != self.body_id
                            or row.get("residentId", self.resident_id) != self.resident_id):
                        continue
                    event_id, listener = row.get("eventId"), row.get("speakerId")
                    occurred = _millis(row.get("occurredAt"))
                    if (isinstance(event_id, str) and event_id and isinstance(listener, str)
                            and UUID_TEXT.fullmatch(listener) is not None and occurred is not None and _fresh(occurred, now)):
                        candidates.append((occurred, event_id, listener.lower()))
            if candidates:
                # Prefer the newest event for each listener, never an arbitrary stale recipient.
                latest: dict[str, tuple[float, str]] = {}
                for occurred, candidate_id, candidate_listener in candidates:
                    if candidate_listener not in latest or occurred > latest[candidate_listener][0]:
                        latest[candidate_listener] = (occurred, candidate_id)
                listener = max(latest, key=latest.get)
                _, event_id = latest[listener]
            else:
                # No fresh original event/listener means proactive nearby speech; never invent a recipient.
                return
        if action.request_id in self._speech_targets:
            prior = self._speech_targets[action.request_id]
            if prior != (event_id, listener):
                raise ArgumentError("original requestId has a different event/listener binding")
            args.update(eventId=event_id, listenerId=listener)
            return
        args.update(eventId=event_id, listenerId=listener)
        self._speech_targets[action.request_id] = (event_id, listener)
        while len(self._speech_targets) > 512:
            self._speech_targets.popitem(last=False)

    def health(self):
        health = super().health()
        health.extra = {"residentId": self.resident_id, "bodyId": self.body_id, "controllerId": self.controller_id,
                        "generation": self.bridge.generation, "cursor": self.cursor, "lifeState": self._life}
        return health
