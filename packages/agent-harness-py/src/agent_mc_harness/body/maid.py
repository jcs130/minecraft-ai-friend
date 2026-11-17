"""Touhou Little Maid (qiandengji-maids/v1) adapter.

The owner-connection transport drives the maid through its OWNER's authenticated connection. From Python
that connection is an agent-mc-world runtime whose host registered touhou-maids ``MAID_TOOL`` (``mc_maids``,
agent/maid-port.mjs) as an extra tool; we reach it with an agent-mc-autonomy ``MinecraftBridge`` (or the numen-hosting
core RPC). Everything protocol-specific stays in maid-port: command building/validation (``maidCommand``), transport
negotiation (plugin message vs. rate-limited ``/qdmaid``), reply matching, pacing and the 8-pending limit. This adapter
only maps unified verbs to ``mc_maids`` actions, keeps requestIds, reconciles with ``receipt`` and turns
``inbox``/``context``/lifecycle envelopes into body events. The action list and schema are read from the live tool,
not copied.

NativeMaidBridge binds the same private companion through the local server executor. Its server-side
generation fences writes even while the owner is offline. This transport does not register a public resident.
"""
from __future__ import annotations

import asyncio
import contextlib
import copy
import json
import math
import re
from collections import OrderedDict
from typing import Any

from ..bridges import MAID_READS, ControlChanged, EventCursor, MaidRequestRejected, NativeMaidBridge, ToolBridge, json_text, maid_read_only
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
    NativeAction,
    SafetyCaps,
    Scope,
    WorldRef,
)
from .base import ArgumentError, BaseBody, new_request_id, obj, xyz
from .numen import classify_envelope

UUID = re.compile(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
READS = MAID_READS
# unified verb -> (mc_maids action, argument names passed through, async?)
VERBS: dict[str, tuple[str, tuple[str, ...], bool]] = {
    "move": ("walk", ("x", "y", "z"), True),
    "follow": ("follow", (), False), "stay": ("stay", (), False), "sit": ("sit", (), False), "recall": ("recall", (), True),
    "chat": ("speak", ("text",), False), "equip": ("equip", ("slot", "hand"), False),
    "transfer": ("transfer", ("direction", "slot", "count", "playerSlot"), False),
    "craft": ("make", ("workshopId", "recipeId", "quantity", "inventory"), True), "cast": ("cast", ("spellId",), True),
    "pickup": ("pickup", ("enabled",), False), "observe": ("context", (), False), "inventory": ("inventory", (), False),
    "stop": ("stay", (), False),
}
PENDING = {"pending", "reserved", "accepted", "queued", "running", "dispatched", "sent"}
FAILED = {"rejected", "failed", "refused", "blocked", "cancelled", "expired"}


def native_argument_schema(schema: dict[str, Any], action: str) -> dict[str, Any]:
    """Expose only this action's arguments; identity and request routing belong to the host."""
    routing = {"action", "maidId", "requestId"}
    props = schema.get("properties", {})
    branch = next((row for row in schema.get("oneOf", [])
                   if row.get("properties", {}).get("action", {}).get("const") == action), None)
    if branch is not None and isinstance(branch.get("propertyNames", {}).get("enum"), list):
        allowed = set(branch["propertyNames"]["enum"]) - routing
        return {"type": "object", "properties": {k: copy.deepcopy(v) for k, v in props.items() if k in allowed},
                "required": [k for k in branch.get("required", []) if k in allowed], "additionalProperties": False}
    # Owner-connection transports can advertise a shared schema without branches.
    return {"type": "object", "properties": {k: copy.deepcopy(v) for k, v in props.items() if k not in routing},
            "required": [k for k in schema.get("required", []) if k not in routing]}


def reply_status(reply: Any, is_error: bool) -> ActionStatus:
    """Map a maid-port reply ({ok, status, reason, data}) to a unified status."""
    if not isinstance(reply, dict):
        return "unknown"
    data = reply.get("data")
    if not isinstance(data, dict):
        data = {}
    status = str(reply.get("status") or data.get("status") or "")
    if status == "not_dispatched":
        return "rejected"
    if status == "unknown":
        return "unknown"
    if reply.get("ok") is False or is_error:
        return "failed" if status in FAILED or status in ("unavailable", "") else "failed"
    if status in PENDING:
        return "accepted"
    if status in FAILED:
        return "failed"
    if status in ("completed", "applied", "replied", "closed") or (not status and reply.get("ok") is True):
        return "completed"
    return "unknown"


class MaidBody(BaseBody):
    kind = "maid"

    def __init__(self, bridge: ToolBridge, *, scope: Scope, owner_id: str, maid_id: str | None = None, server_id: str | None = None,
                 world_key: str | None = None, open_bridge: bool = True, poll_seconds: float = 3.0, result_poll_seconds: float = 3.0,
                 context_poll_seconds: float = 10.0) -> None:
        super().__init__()
        if not UUID.match(owner_id):
            raise ValueError("owner_id must be the owner's UUID")
        if maid_id is not None and not UUID.match(maid_id):
            raise ValueError("maid_id must be the original maid UUID")
        self.bridge, self.scope, self.owner_id = bridge, scope, owner_id.lower()
        self.maid_id = maid_id.lower() if maid_id else None
        self._native = isinstance(bridge, NativeMaidBridge)
        if isinstance(bridge, NativeMaidBridge):
            if self.owner_id != bridge.owner_id or self.maid_id != bridge.maid_id:
                raise ValueError("native bridge and body identities must match")
        self.server_id, self.world_key, self.open_bridge = server_id, world_key, open_bridge
        self.poll_seconds, self.result_poll_seconds, self.context_poll_seconds = poll_seconds, result_poll_seconds, context_poll_seconds
        self.cursor = EventCursor(bridge)
        self._identity: BodyIdentity | None = None
        self._schema: dict[str, Any] = {}
        self._actions: list[str] = []
        self._tasks: list[asyncio.Task[None]] = []
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._life = "unknown"
        self._context: dict[str, Any] = {}
        self._generation = 0
        self.workshop = False
        self._act_lock = asyncio.Lock()
        self._inputs: OrderedDict[str, BodyAction] = OrderedDict()

    # ---- discovery --------------------------------------------------------------------------------
    def identity(self) -> BodyIdentity | None:
        return self._identity

    def capabilities(self) -> Capabilities:
        actions = set(self._actions)
        acts: dict[str, ActionSupport] = {}
        for verb, (native, args, is_async) in VERBS.items():
            if native in actions and (native != "make" or self.workshop):
                acts[verb] = ActionSupport(native=f"mc_maids {native}", args=list(args), async_=is_async,
                                           notes="mode setting, not arrival/completion" if verb in ("follow", "stay", "sit") else None)
        props = self._schema.get("properties", {})
        native_actions = [NativeAction(name=a, read_only=a in READS and (a != "brain" or "choice" not in props),
                                       input_schema=native_argument_schema(self._schema, a)) for a in self._actions]
        events: list[BodyEventKind] = ["death", "respawn", "lifecycle", "dimension", "action_result"]
        if not self._native:
            events += ["dialogue", "position", "system_message", "chat", "safety", "other"]
        elif "inbox" in actions:
            events.append("dialogue")
        return Capabilities(
            kind="maid", transport=NativeMaidBridge.transport if self._native else "mc_maids (maid-port via owner connection)",
            actions=acts, native_actions=native_actions,
            events=events,
            snapshot=["life_state", "dimension", "position", "health", "inventory", "text"],
            lifecycle=LifecycleCaps(spawn="bind-existing", reconnect=True, destroy="detach"), perception="poll",
            safety=SafetyCaps(native_guards=["server controller generation" if self._native else "maid-port pacing and max 8 pending", "TLM ownership",
                                             "no automatic retry or recreate", "owner-only shared inference"]),
            limits=["movement only through advertised native actions; tasks use the original native AI",
                    "stop = stay", "craft only via workshop make (after the workshop handshake)",
                    "health and life state are sampled from context; hunger is not available"],
        )

    # ---- tool calls -------------------------------------------------------------------------------
    async def _maids(self, args: dict[str, Any], request_id: str | None = None) -> tuple[Any, dict[str, Any]]:
        try:
            result = await self.bridge.call("mc_maids", args, request_id=request_id)
        except ControlChanged:
            self._set_state("error", "server control changed; explicit handoff required")
            raise
        except MaidRequestRejected as error:
            status = "unknown" if error.original_request else "not_dispatched"
            return {"ok": False, "status": status, "reason": str(error)}, {"isError": True}
        if self._native:
            text = "\n".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")
            try:
                reply = json.loads(text)
            except ValueError:
                reply = None
        else:
            reply = json_text(result)
        if reply is None:
            reply = {"ok": False, "status": "unknown", "reason": "unstructured_reply_query_original_request"}
        return reply, result

    # ---- lifecycle --------------------------------------------------------------------------------
    async def spawn(self) -> None:
        if self._state in ("ready", "spawning"):
            return
        self._set_state("spawning")
        try:
            if self.open_bridge and not self.bridge.tools:
                await self.bridge.open()
            tool = next((t for t in self.bridge.tools if t.get("name") == "mc_maids"), None)
            if tool is None:
                raise RuntimeError("transport does not expose mc_maids; check the configured server or owner bridge")
            self._schema = tool.get("inputSchema") or tool.get("parameters") or {}
            self._actions = list(self._schema.get("properties", {}).get("action", {}).get("enum", []))
            listed, _ = await self._maids({"action": "list"})
            maids = [m for m in ((listed.get("data") or {}).get("maids") or []) if isinstance(m, dict)] if isinstance(listed, dict) else []
            ids = [str(m.get("maidId") or m.get("id") or "").lower() for m in maids]
            if self.maid_id is None:
                if len(ids) != 1:
                    raise RuntimeError(f"bind needs exactly one owned maid or an explicit maid_id (found {len(ids)}); never creating one")
                self.maid_id = ids[0]
            elif (ids or self._native) and self.maid_id not in ids:
                raise RuntimeError("configured maid is not owned by this connection")
            entry = next((m for m in maids if str(m.get("maidId") or m.get("id") or "").lower() == self.maid_id), {})
            if entry.get("ownerId", self.owner_id) != self.owner_id:
                raise RuntimeError("listed maid owner does not match configured identity")
            await self._read_context(emit=False)
            with contextlib.suppress(Exception):
                shop, _ = await self._maids({"action": "workshop", "maidId": self.maid_id})
                self.workshop = isinstance(shop, dict) and shop.get("ok") is True
        except Exception as error:
            self.last_error = type(error).__name__
            self._set_state("error", f"bind failed: {error}"[:300])
            if self._native and self.open_bridge:
                try:
                    await self.bridge.close()
                except Exception as release_error:
                    raise RuntimeError("bind_failed_control_release_unconfirmed") from release_error
            raise
        self._generation += 1
        self._identity = BodyIdentity(kind="maid", body_id=self.maid_id, name=entry.get("name"), owner_id=self.owner_id,
                                      world=WorldRef(server_id=self.server_id, world_key=self.world_key, dimension=self._context.get("dimension")),
                                      scope=self.scope, generation=self.bridge.generation if isinstance(self.bridge, NativeMaidBridge) else f"bind-{self._generation}")
        self._set_state("dead" if self._life == "dead" else "ready", "maid bound (existing entity)")
        self._tasks = []
        if self.poll_seconds > 0:
            self._tasks.append(asyncio.create_task(self._loop(self.poll_seconds, self.poll_once), name="maid-events"))
        if self.result_poll_seconds > 0:
            self._tasks.append(asyncio.create_task(self._loop(self.result_poll_seconds, self.reconcile), name="maid-results"))
        if self.context_poll_seconds > 0:
            self._tasks.append(asyncio.create_task(self._loop(self.context_poll_seconds, self._read_context), name="maid-context"))

    async def reconnect(self) -> None:
        await self._halt_tasks()
        self._state = "detached"
        await self.spawn()

    async def destroy(self) -> None:
        await self._halt_tasks()
        if self.open_bridge:
            if self._native:
                try:
                    await self.bridge.close()
                except Exception:
                    self._set_state("error", "control release unconfirmed; inspect the original controller")
                    raise
            else:
                with contextlib.suppress(Exception):
                    await self.bridge.close()
        self._set_state("destroyed", "detached; the maid keeps its native AI and data")

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

    # ---- actions ----------------------------------------------------------------------------------
    def _remember_input(self, action: BodyAction) -> None:
        rid = action.request_id
        if rid is None:
            raise ValueError("original_request_id_required")
        original = self._inputs.get(rid)
        if original is not None and original != action:
            raise ValueError("request_id_conflict; query the original request")
        self._inputs[rid] = action.model_copy(deep=True)
        self._inputs.move_to_end(rid)
        while len(self._inputs) > self.LEDGER:
            self._inputs.popitem(last=False)

    def restore_request(self, action: BodyAction) -> None:
        # Keep the durable verb/arguments so restart recovery cannot mistake a
        # read for a write, or brain(choice=...) for its read-only variant.
        self._remember_input(action)
        super().restore_request(action)

    def _failed_read(self, request_id: str, verb: str, name: str) -> ActionReceipt:
        return self.receipt(request_id, verb, "failed", "read_result_unavailable; obtain a fresh observation",
                            data={"maidAction": name, "readOnly": True, "effectsApplied": False})

    async def act(self, action: BodyAction) -> ActionReceipt:
        action = action.model_copy(deep=True)
        action.request_id = action.request_id or new_request_id()
        rid = action.request_id
        async with self._act_lock:
            original = self._inputs.get(rid)
            if original is not None and original != action:
                return self.receipt(rid, action.verb, "rejected", "request_id_conflict; query the original request")
            self._remember_input(action)
            return await super().act(action)

    async def _do_act(self, action: BodyAction, request_id: str) -> ActionReceipt:
        if action.verb == "native":
            name = str(action.name)
            args = {**action.args, "action": name}
            if "maidId" in args and args["maidId"] != self.maid_id:
                raise ArgumentError("action maidId must match the bound original body")
            if "ownerId" in args and args["ownerId"] != self.owner_id:
                raise ArgumentError("action ownerId must match the bound owner")
            if {"controllerId", "generation", "operation"}.intersection(args):
                raise ArgumentError("controller fields belong to the transport")
            if self.maid_id and name not in ("list", "nearby", "resources", "resource-pack") and "maidId" not in args:
                args["maidId"] = self.maid_id
        else:
            native, names, _ = VERBS[action.verb]
            args = {"action": native, "maidId": self.maid_id}
            for key in names:
                if key in action.args:
                    args[key] = action.args[key]
            if action.verb == "chat":
                text = obj(action.args, "text", str)
                if not 1 <= len(text) <= 140:
                    raise ArgumentError("text must be 1..140 characters (maid speak limit)")
            if action.verb == "cast":
                obj(action.args, "spellId", str)
            if action.verb == "move":
                args["x"], args["y"], args["z"] = xyz(action.args)
            if action.verb == "craft":
                obj(action.args, "workshopId", str)
                obj(action.args, "recipeId", str)
            if action.verb in ("equip",):
                obj(action.args, "slot", int)
                obj(action.args, "hand", str)
            if action.verb == "transfer":
                obj(action.args, "direction", str)
                obj(action.args, "slot", int)
        write = not maid_read_only(args)
        if write:
            args["requestId"] = request_id
        try:
            reply, result = await self._maids(args, request_id if write else None)
        except ControlChanged:
            raise  # A failed read never grants a new controller generation.
        except Exception:
            if write:
                raise
            return self._failed_read(request_id, action.verb, args["action"])
        if self._native and write and isinstance(reply, dict) and reply.get("ok") is True:
            data = reply.get("data")
            if (not isinstance(data, dict) or data.get("operationId") != request_id or data.get("action") != args["action"]
                    or data.get("maidId", self.maid_id) != self.maid_id or data.get("ownerId", self.owner_id) != self.owner_id):
                reply = {"ok": False, "status": "unknown", "reason": "action_reply_mismatch_query_original_request"}
        status = reply_status(reply, bool(result.get("isError")))
        if self._native and args["action"] == "walk" and status == "completed":
            data = reply.get("data") or {}
            if data.get("status") != "completed" or data.get("goalCompleted") is not True:
                status = "accepted"
        if not write and status == "accepted":
            status = "completed"
        if not write and status == "unknown":
            return self._failed_read(request_id, action.verb, args["action"])
        text = str((reply or {}).get("reason") or (reply or {}).get("error") or (reply or {}).get("text") or f"{args['action']} {status}")
        if args["action"] == "context" and isinstance(reply, dict) and reply.get("ok"):
            self._apply_context(reply.get("data") or {}, emit=True)
        operation = (reply or {}).get("operationId") if isinstance(reply, dict) else None
        receipt = self.receipt(request_id, action.verb, status, text[:2000], execution_id=operation or (request_id if write else None),
                               data={"maidAction": args["action"], "reply": reply})
        if receipt.terminal and write:
            self.emit("action_result", text[:300], request_id=request_id, status=status, data={"verb": action.verb, "maidAction": args["action"]})
        return receipt

    async def stop(self, reason: str | None = None) -> ActionReceipt:
        if "stop" not in self.capabilities().actions:
            return self.receipt("stop_unsupported", "stop", "unsupported", "mc_maids has no stay action")
        return await self.act(BodyAction(verb="stop", request_id=new_request_id("stop")))

    async def result(self, request_id: str) -> ActionReceipt:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,48}", request_id):
            return self.receipt(request_id[:48] or "invalid", "native", "rejected", "invalid original requestId")
        if self._native and request_id not in self._receipts:
            self._remember(self.receipt(request_id, "native", "unknown", "querying the original server receipt"))
        return await super().result(request_id)

    async def _do_result(self, request_id: str, previous: ActionReceipt) -> ActionReceipt:
        maid_action = (previous.data or {}).get("maidAction") if isinstance(previous.data, dict) else None
        original = self._inputs.get(request_id)
        if maid_action is None and original is not None:
            maid_action = original.name if original.verb == "native" else VERBS.get(original.verb, (None, (), False))[0]
        if original is not None and maid_read_only({**original.args, "action": maid_action}):
            # Reads have no server-side operation receipt. A lost observation is
            # a failed read, never a completed action and never a reason to replay.
            # Settle the original ID locally; the host may then plan a fresh read.
            return self._remember(self._failed_read(request_id, original.verb, str(maid_action)))
        args: dict[str, Any] = {"action": "receipt", "maidId": self.maid_id, "operationId": previous.execution_id or request_id}
        if maid_action and maid_action not in READS:
            args["operationAction"] = maid_action
        reply, result = await self._maids(args)
        data = reply.get("data") if isinstance(reply, dict) and reply.get("ok") is True else None
        if not isinstance(data, dict):
            return previous
        if data.get("operationId") != args["operationId"]:
            return previous
        if data.get("maidId", self.maid_id) != self.maid_id or data.get("ownerId", self.owner_id) != self.owner_id:
            return previous
        if maid_action and data.get("action", maid_action) != maid_action:
            return previous
        if self._native and (not isinstance(data.get("action"), str) or not data.get("action")):
            return previous
        status = reply_status(data, bool(result.get("isError")))
        if self._native and data.get("action") == "walk" and status == "completed":
            if data.get("status") != "completed" or data.get("goalCompleted") is not True:
                return previous
        if status in ("accepted",) or (status == "unknown" and previous.status == "unknown"):
            return previous
        return self.settle(request_id, status, f"receipt: {status}", reply) or previous

    async def reconcile(self) -> None:
        for rid, receipt in list(self._receipts.items()):
            if receipt.status == "accepted":
                with contextlib.suppress(Exception):
                    await self._do_result(rid, receipt)

    # ---- perception -------------------------------------------------------------------------------
    async def _read_context(self, emit: bool = True) -> None:
        if not self.maid_id:
            return
        reply, _ = await self._maids({"action": "context", "maidId": self.maid_id})
        if isinstance(reply, dict) and reply.get("ok"):
            data = reply.get("data") or {}
            if data.get("maidId", self.maid_id) != self.maid_id or data.get("ownerId", self.owner_id) != self.owner_id:
                raise RuntimeError("context_identity_mismatch")
            self._apply_context(data, emit=emit)
        elif self._native:
            self._apply_context({"lifeState": "unknown"}, emit=emit)
            raise RuntimeError("maid_context_unavailable")

    def _apply_context(self, data: dict[str, Any], emit: bool) -> None:
        previous = dict(self._context)
        life = data.get("lifeState")
        self._context = {"lifeState": life, "dimension": data.get("dimension"),
                         "position": data.get("position"), "raw": data}
        if life == "dead":
            new_life = "dead"
        elif life == "alive":
            new_life = "alive"
        else:
            new_life = "unloaded" if life == "unloaded_or_unavailable" else "unknown"
        if emit and new_life != self._life:
            if new_life == "dead":
                self.emit("death", "maid died", data={"death": data.get("death")})
            elif self._life == "dead" and new_life == "alive":
                self.emit("respawn", "maid alive again", data={"recovery": data.get("recovery")})
        if emit and previous.get("dimension") and previous.get("dimension") != self._context["dimension"]:
            self.emit("dimension", f"dimension {self._context['dimension']}", data={"dimension": self._context["dimension"]})
        self._life = new_life
        if new_life == "dead" and self._state == "ready":
            self._state = "dead"
        elif new_life != "dead" and self._state == "dead":
            self._state = "ready"

    async def snapshot(self) -> BodySnapshot:
        await self._read_context(emit=True)
        inv, _ = await self._maids({"action": "inventory", "maidId": self.maid_id})
        pos = self._context.get("position")
        if isinstance(pos, list) and len(pos) == 3:
            pos = dict(zip("xyz", pos, strict=True))
        position = {k: float(pos[k]) for k in "xyz"} if isinstance(pos, dict) and all(_number(pos.get(k)) is not None for k in "xyz") else None
        raw = self._context.get("raw") or {}
        return BodySnapshot(life_state=self._life, position=position, dimension=self._context.get("dimension"),
                            health=_number(raw.get("health")), max_health=_number(raw.get("maxHealth")),
                            inventory=(inv or {}).get("data") if isinstance(inv, dict) else None,
                            text=f"maid {self.maid_id} lifeState={self._context.get('lifeState')}", raw=self._context.get("raw"))

    def _fresh(self, key: str) -> bool:
        if key in self._seen:
            return False
        self._seen[key] = None
        while len(self._seen) > 2048:
            self._seen.popitem(last=False)
        return True

    async def poll_once(self) -> int:
        """Inbox (attributed, untrusted human dialogue) + owner-connection events (system text for anti-cheat)."""
        count = 0
        if "inbox" in self._actions:
            reply, _ = await self._maids({"action": "inbox", "maidId": self.maid_id})
            data = (reply.get("data") or {}) if isinstance(reply, dict) else {}
            # The original DialogueInbox uses messages with senderUuid/senderName/receivedAt.
            rows: list[Any] = next((data[k] for k in ("events", "items", "pending", "messages") if isinstance(data.get(k), list)), [])
            for row in rows:
                if isinstance(row, dict) and row.get("eventId") and self._fresh("inbox:" + str(row["eventId"])):
                    context = self._context.get("raw") or {}
                    speaker = row.get("speakerId") or row.get("senderUuid")
                    prefix = "qdvoice:" + str(speaker) + ":"
                    relay = str(row["eventId"])[len(prefix):] if str(row["eventId"]).startswith(prefix) else ""
                    channel = ("voice" if relay.startswith("voice_") else "npc_chat" if relay.startswith("npc_") else "chat")
                    self.emit("dialogue", str(row.get("text") or "")[:1000], severity=2,
                              data={"eventId": row["eventId"], "maidId": self.maid_id, "ownerId": self.owner_id,
                                    "speaker": row.get("speaker") or row.get("senderName"),
                                    "speakerId": row.get("speakerId") or row.get("senderUuid"),
                                    "channel": channel, "listenerId": self.maid_id,
                                    **({"deliveryScope": "nearby"} if relay else {}),
                                    "receivedAt": row.get("receivedAt"), "source": row.get("source") or "untrusted_game_dialogue",
                                    "trusted": False,
                                    "memoryNamespace": row.get("memoryNamespace") or data.get("memoryNamespace") or context.get("memoryNamespace"),
                                    "sessionKey": row.get("sessionKey") or data.get("sessionKey") or context.get("sessionKey")}, raw=row)
                    count += 1
        for e in await self.cursor.read():
            kind = classify_envelope(str(e.get("type") or ""))
            if kind in ("system_message", "server_status", "chat", "whisper"):
                self.emit(kind, str(e.get("text") or "")[:2000], data={"type": e.get("type")}, raw=e)
                count += 1
        return count

    async def ack(self, event_id: str) -> ActionReceipt:
        """Acknowledge an inbox event after the host has handled it (maid-port contract: speak, then ack)."""
        return await self.act(BodyAction(verb="native", name="ack", args={"eventId": event_id}, request_id=new_request_id("ack")))

    def feed_envelope(self, envelope: dict[str, Any]) -> bool:
        """For hosts that receive qiandengji-maids/v1 envelopes directly (maid-port onDialogue/onLifecycle/onChatResult)."""
        if not isinstance(envelope, dict) or envelope.get("protocol") != "qiandengji-maids/v1" or envelope.get("schema") != 1 or not envelope.get("ok"):
            return False
        if str(envelope.get("recipientUuid", "")).lower() != self.owner_id:
            return False
        data = envelope.get("data") or {}
        if self.maid_id and str(data.get("maidId", self.maid_id)).lower() != self.maid_id:
            return False
        action, key = envelope.get("action"), str(data.get("eventId") or envelope.get("requestId"))
        if not self._fresh(f"{action}:{key}"):
            return False
        if action == "dialogue":
            self.emit("dialogue", str(data.get("text") or "")[:1000], severity=2, data={k: data.get(k) for k in ("eventId", "sessionKey", "speaker")}, raw=envelope)
        elif action == "lifecycle":
            dead = bool(data.get("death")) and not data.get("recovery")
            self.emit("death" if dead else "respawn", "maid death" if dead else "maid recovered", data={"eventId": data.get("eventId")}, raw=envelope)
            self._life = "dead" if dead else "alive"
            self._state = "dead" if dead and self._state == "ready" else ("ready" if not dead and self._state == "dead" else self._state)
        elif action == "chat-result":
            rid = str(data.get("requestId") or envelope.get("requestId"))
            status: ActionStatus = "completed" if data.get("status") in ("replied", "completed", None) else reply_status(data, False)
            if self.settle(rid, status, str(data.get("text") or "chat result")[:500], data) is None:
                self.emit("other", "chat-result", data=data, raw=envelope)
        else:
            return False
        return True

    def health(self):
        h = super().health()
        h.extra = {"maidId": self.maid_id, "lifeState": self._life, "workshop": self.workshop}
        return h


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value) else None
