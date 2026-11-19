"""Numen (server-hosted Numen body) adapter.

Two ports, one adapter:

* ``NativeNumenPort`` - Numen's own MCP (``/numen token create brain <name> 30``) through the EXISTING QwenPaw driver
  ``numen-paper/qwenpaw/numen_controller.py``: its ``Controller`` keeps the brain lease, the upstream reconnect loop,
  ``get_events`` polling + dedupe journal, unattended-consent denial, the persistent action-receipt ledger
  (``thisCallDispatched=false`` for repeats of unknown actions) and ``command`` -> ``numen.mc.run``. We only wrap it.
  Works on python ``mcp`` 1.x and 2.x (the controller carries the compat shim).
* ``HostedNumenPort`` - numen-hosting: the ``mc_numen`` tool of the agent-mc-world core, reached through
  numen-hosting's loopback ``/core`` RPC (``bridges.core_rpc_bridge``) or any agent-mc-autonomy ``MinecraftBridge``.

Unified verbs that Numen has no dedicated tool for are expressed in Numen Lua. Two dialects (``LUA_DIALECTS``):

* ``numen-0.1.5`` (default for the native port) - upstream Numen 0.1.5, verified live against
  ``numen-neoforge-1.21.1-0.1.5.jar``: ``numen.move.walk(pos)``, ``numen.task.stop()``, ``numen.status.self()``,
  ``numen.inv.items()``, ``numen.scan.entities``/``numen.fight.attack``/``numen.inv.drop``. 0.1.5 has no
  ``numen.move.to`` and rejects extra arguments, so ``numen.move.walk(0,0,0)`` is a bad_argument error there.
* ``numen-paper`` (the hosted port, and the native port with ``lua_dialect="numen-paper"``) - the numen-paper fork
  calls documented in this repository (``numen.move.to`` @Examples in numen-paper/patches/ordinary-entity-vision.patch,
  ``/mycli`` status/inventory through ``numen.mc.run``, ``numen.move.walk(0,0,0)`` as numen-hosting's handoff halt).

Numen 0.1.5 runs ONE program per companion: a second ``lua`` call while one runs is refused ("a call is already
running"), and cancelling the MCP request does not stop the body job, so ``stop`` can only land between programs.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .._reuse import numen_controller
from ..bridges import ToolBridge, json_text, outcome, text_content
from ..models import (
    ActionReceipt,
    ActionStatus,
    ActionSupport,
    BodyAction,
    BodyIdentity,
    BodySnapshot,
    Capabilities,
    LifecycleCaps,
    NativeAction,
    SafetyCaps,
    Scope,
    WorldRef,
)
from . import adventure
from .base import ArgumentError, BaseBody, obj, xyz
from .native_tasks import NativeTasks, background_task, finished_tasks

STATUS_LINE = "/mycli status --json"
INVENTORY_LINE = "/mycli inventory status"
# numen.task.stop fails with not_found when the body is idle; that is a successful stop for us.
STOP_LUA = ("local ok,e=pcall(numen.task.stop) if ok then print('stopped') "
            "else print('idle: '..tostring(type(e)=='table' and e.kind or e)) end")
STATUS_LUA = ("local me=numen.status.self() "
              "print('NUMEN_SELF {\"health\":'..me.hp..',\"maxHealth\":'..me.max_hp..',\"food\":'..me.hunger.."
              "',\"position\":{\"x\":'..me.pos.x..',\"y\":'..me.pos.y..',\"z\":'..me.pos.z..'},\"dimension\":\"'..me.dimension.."
              "'\",\"gameMode\":\"'..me.game_mode..'\"}') "
              "local nearby=numen.scan.entities(\"hostile\",{radius=12}) "
              "for _,e in ipairs(nearby) do print('NUMEN_ENTITY {\"id\":'..string.format('%q',e.id).."
              "',\"hostile\":true,\"health\":'..(e.hp or 0)..',\"maxHealth\":'..(e.max_hp or 0).."
              "',\"distance\":'..(e.distance or 0)..'}') end "
              "return {nearby=nearby,inventory=numen.inv.items()}")
INVENTORY_LUA = "return numen.inv.items()"
HOSTED_INVENTORY_LUA = (
    "local n=numen_hosted; local me=n.status.self(); "
    "for _,s in ipairs(n.inv.items()) do print('QD_NUMEN_ITEM '..s.item..' '..s.count) end; "
    "for _,hand in ipairs({'mainhand','offhand'}) do local s=me.hands[hand]; "
    "if s then print('QD_NUMEN_HAND '..hand..' '..s.item..' '..s.count) end end; "
    "print('QD_NUMEN_INVENTORY_END');"
)
LUA_DIALECTS: dict[str, dict[str, str]] = {
    "numen-0.1.5": {"move": "numen.move.walk({{x={x},y={y},z={z}}})", "stop": STOP_LUA, "observe": STATUS_LUA, "inventory": INVENTORY_LUA},
    "numen-paper": {"move": "numen.move.to({{x={x},y={y},z={z}}})", "stop": "numen.move.walk(0,0,0)", "observe": STATUS_LINE,
                    "inventory": INVENTORY_LINE},
}
LUA_DIALECTS["numen-hosted-0.1.5"] = {key: source.replace("numen.", "numen_hosted.")
                                      for key, source in LUA_DIALECTS["numen-0.1.5"].items()}


def namespace(port) -> str:
    return "numen_hosted" if port.dialect == "numen-hosted-0.1.5" else "numen"


def command_lua(line: str, root: str) -> str:
    if root not in ("numen", "numen_hosted") or not isinstance(line, str) or not line.strip() or any(ord(c) < 32 for c in line):
        raise ValueError("invalid_scoped_command")
    return "local r=" + root + ".mc.run(" + json.dumps(line.strip(), ensure_ascii=False) + "); for _,line in ipairs(r.output) do print(line) end; return {numen_command_receipt=r}"
# Numen 0.1.5 replies: the program was refused before it ran / was cut while the driving seat flipped (it may still run).
BUSY = re.compile(r"a call is already running for this companion|another program is already running", re.I)
CUT_OFF = re.compile(r"this turn was cut off", re.I)
ITEM = re.compile(r"^[a-z0-9_.-]+(?::[a-z0-9_./-]+)?$")
SCAN_KINDS = ("hostile", "passive", "player", "all", "item")
NPC_MEAL_FOODS = (
    "minecraft:cooked_beef", "minecraft:cooked_porkchop", "minecraft:cooked_mutton",
    "minecraft:cooked_salmon", "minecraft:cooked_chicken", "minecraft:cooked_cod",
    "minecraft:bread", "minecraft:baked_potato", "minecraft:apple", "minecraft:carrot",
)
# The native job holds use until a real item is consumed. Measurements bracket it.
NPC_MEAL_LUA = (
    "local n = numen_hosted; local before = n.status.self().hunger; "
    "if before > 14 then print('QD_NPC_MEAL already_fed'); return end; "
    "for _, id in ipairs({" + ",".join(json.dumps(item) for item in NPC_MEAL_FOODS) + "}) do "
    "local count = n.inv.count(id); if count > 0 then n.inv.eat(id); "
    "print('QD_NPC_MEAL '..id..' '..count..' '..n.inv.count(id)..' '..before..' '..n.status.self().hunger); "
    "return end end; print('QD_NPC_MEAL no_ordinary_food')"
)


def _field(model: Any, camel: str, snake: str) -> Any:
    """mcp 1.x exposes camelCase result/tool fields, mcp 2.x snake_case (isError -> is_error ...)."""
    return getattr(model, camel) if hasattr(model, camel) else getattr(model, snake, None)


@dataclass
class PortResult:
    status: ActionStatus
    text: str = ""
    data: Any = None
    execution_id: str | None = None


def measured_inventory(result: PortResult) -> PortResult:
    if result.status == "unknown":
        return PortResult("failed", "Native backpack read unavailable. Query inventory again when the body is ready.",
                          result.data, result.execution_id)
    if result.status != "completed":
        return result
    lines = result.text.splitlines()
    if "QD_NUMEN_INVENTORY_END" not in lines:
        return PortResult("failed", "Native backpack sample incomplete. Query inventory again.",
                          result.data, result.execution_id)
    inventory, hands = [], {}
    for line in lines:
        parts = line.split()
        if len(parts) == 3 and parts[0] == "QD_NUMEN_ITEM" and ITEM.fullmatch(parts[1]) and parts[2].isdigit():
            inventory.append({"itemId": parts[1], "count": int(parts[2])})
        if (len(parts) == 4 and parts[0] == "QD_NUMEN_HAND" and parts[1] in {"mainhand", "offhand"}
                and ITEM.fullmatch(parts[2]) and parts[3].isdigit()):
            hands[parts[1]] = {"itemId": parts[2], "count": int(parts[3])}
    return PortResult("completed", "Read the native backpack and hands", {"inventory": inventory, "hands": hands}, result.execution_id)


def measured_attack(result: PortResult) -> PortResult:
    if result.status == "completed" and "QD_NUMEN_ATTACK no_target" in result.text.splitlines():
        return PortResult("failed", "No matching enemy in the current scan", {"effectsApplied": False}, result.execution_id)
    return result


def item_use_lua(item: str) -> str:
    return (
        f"local n=numen_hosted; local id={lua_str(item)}; local held=n.status.self().hands.mainhand; "
        "if not held or held.item~=id then print('QD_NUMEN_USE wrong_mainhand'); return end; "
        "local before=n.inv.count(id); local click=n.use.item({item=id}); "
        "print('QD_NUMEN_USE '..id..' '..before..' '..n.inv.count(id)..' '..#(click.changes or {}));"
    )


def measured_item_use(result: PortResult, item: str) -> PortResult:
    if result.status != "completed":
        return result
    lines = result.text.splitlines()
    if "QD_NUMEN_USE wrong_mainhand" in lines:
        return PortResult("failed", "Equip the requested item in the main hand first", {"effectsApplied": False}, result.execution_id)
    sample = re.search(r"^QD_NUMEN_USE " + re.escape(item) + r" (\d+) (\d+) (\d+)$", "\n".join(lines), re.MULTILINE)
    if sample:
        before, after, changes = map(int, sample.groups())
        observed = {"itemId": item, "countBefore": before, "countAfter": after, "nativeChangeCount": changes}
        if before != after or changes:
            return PortResult("completed", "Native click produced an observed change", {"itemUse": observed}, result.execution_id)
        return PortResult("failed", "Native click had no observed effect", {"itemUse": observed}, result.execution_id)
    return PortResult("unknown", "native item outcome unverified; query the original request", result.data, result.execution_id)


def measured_meal(result: PortResult) -> PortResult:
    if result.status != "completed":
        return result
    sample = re.search(r"QD_NPC_MEAL (\S+) (\d+) (\d+) (\d+) (\d+)\b", result.text)
    data = result.data if isinstance(result.data, dict) else {}
    if sample and sample[1] in NPC_MEAL_FOODS:
        count_before, count_after, food_before, food_after = map(int, sample.groups()[1:])
        if count_before == count_after + 1 and 0 <= food_before < food_after <= 20:
            facts = {"itemId": sample[1], "countBefore": count_before, "countAfter": count_after,
                     "hungerBefore": food_before, "hungerAfter": food_after, "effectsApplied": True}
            return PortResult("completed", "native meal consumed one item and restored hunger",
                              {**data, "meal": facts}, result.execution_id)
    absence = re.search(r"QD_NPC_MEAL (already_fed|no_ordinary_food)\b", result.text)
    if absence:
        return PortResult("failed", absence[1], {**data, "effectsApplied": False}, result.execution_id)
    return PortResult("unknown", "meal outcome unverified; query the original request", result.data, result.execution_id)


@dataclass
class RawEvent:
    id: str
    text: str
    kind_hint: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


class NumenPort(Protocol):
    transport: str
    dialect: str

    async def open(self) -> dict[str, Any]: ...
    async def close(self) -> None: ...
    def catalog(self) -> list[NativeAction]: ...
    async def call(self, tool: str, args: dict[str, Any], request_id: str) -> PortResult: ...
    async def command(self, line: str, request_id: str) -> PortResult: ...
    async def observe(self) -> PortResult: ...
    async def events(self) -> list[RawEvent]: ...
    async def result(self, request_id: str) -> PortResult | None: ...
    async def halt(self, request_id: str) -> PortResult: ...
    def generation(self) -> str | None: ...


# ------------------------------------------------------------------------------------------------ native
class NativeNumenPort:
    """Thin wrapper over numen_controller.Controller (one controller = one companion body)."""

    transport = "numen-mcp"

    def __init__(self, config: dict[str, Any], *, controller: Any = None) -> None:
        self.dialect = str(config.get("lua_dialect", "numen-0.1.5"))
        if self.dialect not in LUA_DIALECTS:
            raise ValueError(f"lua_dialect must be one of {sorted(LUA_DIALECTS)}")
        self.lua = LUA_DIALECTS[self.dialect]
        # Read-only Lua the controller may repeat without an action receipt (status / inventory reads).
        config = {**config, "read_only_lua": sorted({*config.get("read_only_lua", []), self.lua["observe"], self.lua["inventory"]})}
        # Controller(cfg) needs: upstream_url (loopback), token_file (path only - never the token), companion_uuid,
        # journal_dir. The QwenPaw console delivery is not used: event_transport=channel, auto_wake=False.
        self.cfg = {"qwenpaw_url": "http://127.0.0.1:9", "agent_id": "agent-mc-harness", **config,
                    "event_transport": "channel", "auto_wake": False}
        self.nc = numen_controller()
        self.controller = controller
        self._stack: contextlib.AsyncExitStack | None = None
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._native_tasks: NativeTasks | None = None
        self._finishes: OrderedDict[tuple[str, str], tuple[str, str]] = OrderedDict()

    async def open(self) -> dict[str, Any]:
        if self.controller is None:
            self.controller = self.nc.Controller(self.cfg)
        self._native_tasks = NativeTasks(Path(self.cfg['journal_dir']) / 'native-tasks.sqlite3', self.controller.companion)
        self._stack = contextlib.AsyncExitStack()
        await self._stack.enter_async_context(self.controller.connected())
        # connected() is ready as soon as a cached tool list exists, before the upstream session; give the real
        # session a moment so the first action is not refused as "body connection unavailable" (it is still safe if not).
        deadline = asyncio.get_running_loop().time() + float(self.cfg.get("connect_wait_seconds", 10))
        # The reused Controller exposes no event for "session set", only the attribute, hence the short poll.
        while getattr(self.controller, "session", None) is None and asyncio.get_running_loop().time() < deadline:  # noqa: ASYNC110
            await asyncio.sleep(0.05)
        return {"uuid": self.controller.companion, "server": None, "name": self.cfg.get("name"),
                "session": getattr(self.controller, "session", None) is not None}

    async def close(self) -> None:
        stack, self._stack = self._stack, None
        if stack:
            await stack.aclose()
        if self._native_tasks:
            self._native_tasks.close()
            self._native_tasks = None

    def generation(self) -> str | None:
        return getattr(self.controller, "controller_epoch", None)

    def catalog(self) -> list[NativeAction]:
        out: list[NativeAction] = []
        for tool in getattr(self.controller, "tools", []) or []:
            if tool.name == "events":
                continue
            out.append(NativeAction(name=tool.name, description=(tool.description or "")[:300], read_only=tool.name == "list_companions",
                                    input_schema=_field(tool, "inputSchema", "input_schema")))
        return out

    def _map(self, result: Any) -> PortResult:
        text = self.nc.result_text(result)
        structured = _field(result, "structuredContent", "structured_content") or {}
        if structured.get("status") == "blocked" or structured.get("thisCallDispatched") is False:
            return PortResult("rejected", text, structured)
        if text.startswith("身体连接暂不可用"):
            return PortResult("rejected", text)
        if BUSY.search(text):  # refused before running: nothing happened, the caller may try again later
            return PortResult("rejected", text, {"reason": "body_busy", "thisCallDispatched": False})
        if task := background_task(text):
            return PortResult("accepted", text, {"background": True}, task)
        if structured.get("status") == "unknown" or "结果未知" in text or CUT_OFF.search(text):
            return PortResult("unknown", text, structured)
        if re.search(r'; t\d+ keeps running\.', text):
            return PortResult("unknown", text, {"reason": "background_correlation_unavailable"})
        if _field(result, "isError", "is_error"):
            return PortResult("failed", text, structured)
        return PortResult("completed", text, structured or None)

    async def call(self, tool: str, args: dict[str, Any], request_id: str) -> PortResult:
        # The controller binds `companion`, journals, guards repeats and never replays (request_id is ours only).
        read = tool not in {'lua', 'say', 'command'} or (tool == 'lua' and args.get('code') in self.controller.read_only_lua)
        epoch = getattr(self.controller, 'connection_epoch', None)
        ledger = self._native_tasks if not read else None
        if ledger:
            previous = ledger.get(request_id, epoch)
            if previous:
                return PortResult(**previous)
            fingerprint = self.nc.action_key(tool, self.nc.bound_arguments(args, self.controller.companion))
            ledger.begin(request_id, fingerprint, epoch)
        mapped = self._map(await self.controller.call(tool, args))
        if ledger:
            ledger.save(request_id, mapped.status, mapped.text, mapped.execution_id)
            if isinstance(epoch, str) and mapped.execution_id and (epoch, mapped.execution_id) in self._finishes:
                status, text = self._finishes[(epoch, mapped.execution_id)]
                for key in ledger.finish(epoch, mapped.execution_id, status, text):
                    self.controller.save_action(key, None)
                return PortResult(**ledger.get(request_id, epoch))
        return mapped

    async def command(self, line: str, request_id: str) -> PortResult:
        if namespace(self) == "numen_hosted":
            return await self.call("lua", {"code": command_lua(line, namespace(self))}, request_id)
        return await self.call("command", {"line": line}, request_id)

    async def observe(self) -> PortResult:
        source = self.lua["observe"]
        if source.startswith("/"):
            return await self.command(source, "observe")
        lock = getattr(self.controller, "action_lock", None)
        if lock is not None and lock.locked():  # one program per companion: do not queue a read behind a long job
            return PortResult("rejected", "body busy: a program is running; snapshot unavailable until it ends",
                              {"reason": "body_busy", "thisCallDispatched": False})
        return await self.call("lua", {"code": source}, "observe")

    async def events(self) -> list[RawEvent]:
        result = await self.controller.call("events", {})
        try:
            snapshot = json.loads(self.nc.result_text(result))
        except ValueError:
            return []
        fresh = []
        for row in snapshot.get("events", []):
            if row.get("id") in self._seen:
                continue
            self._seen[row["id"]] = None
            epoch = row.get('connectionEpoch')
            if epoch and epoch == getattr(self.controller, 'connection_epoch', None):
                for task, status, text in finished_tasks(row.get('text', '')):
                    self._finishes[(epoch, task)] = (status, text)
                    if self._native_tasks:
                        for key in self._native_tasks.finish(epoch, task, status, text):
                            self.controller.save_action(key, None)
                while len(self._finishes) > 64:
                    self._finishes.popitem(last=False)
            fresh.append(RawEvent(id=row["id"], text=row.get("text", ""), data={"wake": bool(row.get("wake"))}))
        while len(self._seen) > 1024:
            self._seen.popitem(last=False)
        return fresh

    async def result(self, request_id: str) -> PortResult | None:
        saved = self._native_tasks.get(request_id, getattr(self.controller, 'connection_epoch', None)) if self._native_tasks else None
        return PortResult(**saved) if saved else None

    async def halt(self, request_id: str) -> PortResult:
        # Bypass the controller's single-flight lock: a halt must not queue behind the long Lua it interrupts.
        session = getattr(self.controller, "session", None)
        if session is None:
            return PortResult("rejected", "body connection unavailable")
        args = self.nc.bound_arguments({"code": self.lua["stop"]}, self.controller.companion)
        self.controller.journal.write("tool_started", tool="lua", arguments=args, origin="agent-mc-harness stop")
        result = await session.call_tool("lua", args)
        mapped = self._map(result)
        self.controller.journal.write("tool_result", tool="lua", origin="agent-mc-harness stop", status=mapped.status)
        return mapped


# ------------------------------------------------------------------------------------------------ hosted
HOSTED_STATE: dict[str, ActionStatus] = {"completed": "completed", "done": "completed", "partial": "accepted", "accepted": "accepted",
                                          "queued": "accepted", "running": "accepted", "pending": "accepted", "blocked": "failed",
                                          "cancelled": "failed", "failed": "failed", "unknown": "unknown"}


class HostedNumenPort:
    """numen-hosting body through the agent-mc-world ``mc_numen`` tool (catalog / observe / call / result)."""

    transport = "numen-hosted"
    dialect = "numen-hosted-0.1.5"

    def __init__(self, bridge: ToolBridge, *, epoch: str | None = None, open_bridge: bool = True) -> None:
        from ..bridges import EventCursor
        self.bridge, self.epoch, self.open_bridge = bridge, epoch, open_bridge
        self.cursor = EventCursor(bridge)
        self._catalog: list[NativeAction] = []

    async def open(self) -> dict[str, Any]:
        if self.open_bridge and not self.bridge.tools:
            await self.bridge.open()
        if not any(t.get("name") == "mc_numen" for t in self.bridge.tools):
            raise RuntimeError("selected_core_does_not_advertise_numen")  # same check as hosted_harness.py
        listed = json_text(await self.bridge.call("mc_numen", {"op": "catalog"}))
        rows = listed.get("tools", []) if isinstance(listed, dict) else listed or []
        self._catalog = [NativeAction(name=r["name"], description=(r.get("description") or "")[:300], read_only=r["name"] == "guide",
                                      input_schema=r.get("parameters") or r.get("inputSchema")) for r in rows if isinstance(r, dict) and r.get("name")]
        seen = await self.observe()
        match = re.search(r"server=([^;\s]+); uuid=([0-9a-fA-F-]{36})", seen.text)
        return {"server": match[1] if match else None, "uuid": match[2] if match else None}

    async def close(self) -> None:
        if self.open_bridge:
            await self.bridge.close()

    def generation(self) -> str | None:
        return self.epoch

    def catalog(self) -> list[NativeAction]:
        return list(self._catalog)

    @staticmethod
    def _map(result: dict[str, Any]) -> PortResult:
        o = outcome(result)
        meta: dict[str, Any] = o.get("meta") or {}
        execution: dict[str, Any] = o.get("execution") or {}
        data: dict[str, Any] = o["data"] if isinstance(o.get("data"), dict) else {}
        state = meta.get("state") or data.get("state") or execution.get("phase")
        rid = meta.get("requestId") or data.get("id") or execution.get("id")
        status: ActionStatus
        if state in HOSTED_STATE:
            status = HOSTED_STATE[state]
        elif o.get("failed"):
            status = "failed"
        elif execution and execution.get("terminal") is False:
            status = "accepted"
        else:
            status = "completed"
        return PortResult(status, o.get("text") or text_content(result), o, rid)

    async def call(self, tool: str, args: dict[str, Any], request_id: str) -> PortResult:
        return self._map(await self.bridge.call("mc_numen", {"op": "call", "tool": tool, "args": args}, request_id=request_id))

    async def command(self, line: str, request_id: str) -> PortResult:
        return await self.call("lua", {"code": command_lua(line, namespace(self))}, request_id)

    async def observe(self) -> PortResult:
        result = await self.bridge.call("mc_numen", {"op": "observe"})
        return PortResult("failed" if result.get("isError") else "completed", text_content(result))

    async def events(self) -> list[RawEvent]:
        out: list[RawEvent] = []
        for e in await self.cursor.read():
            out.append(RawEvent(id=str(e.get("cursor") or e.get("id") or len(out)), text=str(e.get("text") or ""),
                                kind_hint=str(e.get("type") or ""), data={"execution": e.get("execution")} if e.get("execution") else {}))
        return out

    async def result(self, request_id: str) -> PortResult | None:
        return self._map(await self.bridge.call("mc_numen", {"op": "result", "requestId": request_id}))

    async def halt(self, request_id: str) -> PortResult:
        return await self.call("lua", {"code": LUA_DIALECTS[self.dialect]["stop"]}, request_id)


# ------------------------------------------------------------------------------------------------ events
NATIVE_EVENT_KIND = {"talk": "chat", "server_message": "system_message", "death": "death", "removed": "lifecycle", "hungry": "hunger",
                     "inventory_full": "inventory", "owner_hurt": "combat", "timer": "other", "woke": "lifecycle",
                     "dimension_change": "dimension", "task_finished": "status", "respawn": "respawn", "hurt": "combat",
                     "companion_hurt": "combat", "targeted": "combat"}
_EVENT = re.compile(r'<event\s+([^>]*)>(.*?)</event>', re.S)
_ATTR = re.compile(r'([a-z_]+)="([^"]*)"')
_QUERY = re.compile(r"<query>(.*?)</query>", re.S)


def classify_native(text: str) -> list[tuple[str, str, dict[str, str]]]:
    """Split one Numen get_events text block into (unified kind, text, attributes)."""
    rows: list[tuple[str, str, dict[str, str]]] = []
    for attrs, body in _EVENT.findall(text):
        a = dict(_ATTR.findall(attrs))
        rows.append((NATIVE_EVENT_KIND.get(a.get("kind", ""), "other"), body.strip(), a))
    for body in _QUERY.findall(text):
        rows.append(("dialogue", body.strip(), {"kind": "query"}))
    if not rows and text.strip():
        rows.append(("other", text.strip(), {}))
    return rows


def classify_envelope(kind_hint: str) -> str:
    t = kind_hint.lower()
    for needle, kind in (("whisper", "whisper"), ("chat", "chat"), ("death", "death"), ("respawn", "respawn"), ("enter", "player_join"),
                         ("join", "player_join"), ("leave", "player_leave"), ("task", "action_progress"), ("system", "system_message"),
                         ("server", "server_status"), ("damage", "combat"), ("combat", "combat"), ("dimension", "dimension")):
        if needle in t:
            return kind
    return "other"


def parse_status(text: str) -> dict[str, Any]:
    """Best-effort read of `/mycli status --json` / mc_numen observe text (MC_STATUS / MC_RPG prefixes are tolerated)."""
    out: dict[str, Any] = {}
    entities = []
    for match in re.finditer(r'(?:^|\n)NUMEN_ENTITY (\{[^\n]+\})', text):
        with contextlib.suppress(ValueError):
            row = json.loads(match[1])
            if isinstance(row, dict):
                entities.append(row)
    out['entities'] = entities[:32]
    marker = text.find("NUMEN_SELF {")  # numen-0.1.5 STATUS_LUA output; the receipt may hold other Lua tables
    start = marker + len("NUMEN_SELF ") if marker >= 0 else text.find("{")
    if start >= 0:
        with contextlib.suppress(ValueError):
            value, _ = json.JSONDecoder().raw_decode(text[start:])
            if isinstance(value, dict):
                status = value.get("status")
                flat = {**value, **(status if isinstance(status, dict) else {})}
                pos = flat.get("position") or flat.get("pos")
                if isinstance(pos, dict) and all(isinstance(pos.get(k), int | float) for k in "xyz"):
                    out["position"] = {k: float(pos[k]) for k in "xyz"}
                elif all(isinstance(flat.get(k), int | float) for k in "xyz"):
                    out["position"] = {k: float(flat[k]) for k in "xyz"}
                for src, dst in (("health", "health"), ("hp", "health"), ("maxHealth", "max_health"), ("max_health", "max_health"),
                                 ("food", "food"), ("hunger", "food")):
                    if isinstance(flat.get(src), int | float) and dst not in out:
                        out[dst] = float(flat[src])
                for key in ("dimension", "world"):
                    if isinstance(flat.get(key), str):
                        out["dimension"] = flat[key]
                        break
    return out


def lua_str(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def lua_num(value: float) -> str:
    return repr(int(value)) if float(value).is_integer() else repr(float(value))


# ------------------------------------------------------------------------------------------------ adapter
class NumenBody(BaseBody):
    kind = "numen"

    def __init__(self, port: NumenPort, *, scope: Scope, server_id: str | None = None, world_key: str | None = None,
                 name: str | None = None, owner_id: str | None = None, poll_seconds: float = 2.0,
                 result_poll_seconds: float = 3.0, item_use_ids: tuple[str, ...] = (), adventure_partner: str | None = None) -> None:
        super().__init__()
        self.port, self.scope, self.server_id, self.world_key = port, scope, server_id, world_key
        self.name, self.owner_id = name, owner_id
        self.poll_seconds, self.result_poll_seconds = poll_seconds, result_poll_seconds
        self._identity: BodyIdentity | None = None
        self._tasks: list[asyncio.Task[None]] = []
        self._life = "unknown"
        self._last: dict[str, Any] = {}
        self._meals: OrderedDict[str, None] = OrderedDict()
        self._item_uses: OrderedDict[str, str] = OrderedDict()
        self.adventure_partner = adventure_partner
        self._adventures: OrderedDict[str, BodyAction] = OrderedDict()
        self.item_use_ids = tuple(dict.fromkeys(item_use_ids))
        if any(not ITEM.fullmatch(item) or ":" not in item for item in self.item_use_ids):
            raise ValueError("item_use_ids must be namespaced item IDs")

    # ---- identity / capabilities -----------------------------------------------------------------
    def identity(self) -> BodyIdentity | None:
        return self._identity

    def _tools(self) -> set[str]:
        return {n.name for n in self.port.catalog()}

    def capabilities(self) -> Capabilities:
        tools = self._tools()
        lua, native = "lua" in tools, self.port.transport == "numen-mcp"
        hosted = self.port.transport == "numen-hosted-mcp"
        dialect = LUA_DIALECTS[getattr(self.port, "dialect", "numen-paper")]

        def via(source: str) -> str:
            return f"command {source}" if source.startswith("/") else f"lua {source[:60]}"
        acts: dict[str, ActionSupport] = {"observe": ActionSupport(native="mc_numen observe" if not native else via(dialect["observe"]))}
        if "say" in tools:
            acts["chat"] = ActionSupport(native="say", args=["text"])
        if lua:
            if self.port.dialect.endswith("0.1.5"):
                acts["equip"] = ActionSupport(native="lua numen.gear.hold/wear", args=["item", "hand"],
                                               notes="Existing item ID; hand is main|off|head|chest|legs|feet."
                                               + (" Use auto for the native wardrobe to choose a wearable slot." if hosted else ""))
            acts["move"] = ActionSupport(native="lua " + dialect["move"].split("(")[0], args=["x", "y", "z"], async_=not native)
            acts["stop"] = ActionSupport(native="lua " + ("numen.task.stop" if dialect["stop"] == STOP_LUA else dialect["stop"]),
                                         notes="lands between programs: Numen runs one program per companion" if native else
                                         "halt used by numen-hosting on handoff")
            acts["attack"] = ActionSupport(native="lua numen.scan.entities + numen.fight.attack", args=["target", "radius"], async_=True,
                                           notes="target: hostile|passive|player|all; radius: number 1..32; first visible match; wait for original task result")
            acts["drop"] = ActionSupport(native="lua numen.inv.drop", args=["item", "count"], async_=not native)
            acts["command"] = ActionSupport(native="command (numen.mc.run)" if native else "lua numen.mc.run", args=["line"],
                                            notes="the body's own /mycli commands; normal player permissions")
            acts["inventory"] = ActionSupport(native=via(dialect["inventory"]))
            if hosted and self.item_use_ids:
                acts["use_item"] = ActionSupport(native="numen_hosted.use.item", args=["item"],
                    notes="Short right-click with the reviewed item already in the main hand. Allowed item IDs: "
                    + ", ".join(self.item_use_ids) + ". Check the actual effect after the original receipt.")
        native_actions = self.port.catalog()
        if hosted and lua:
            native_actions = [*native_actions, NativeAction(name="nourish",
                description="Eat one ordinary food carried in your backpack when hunger is at most 14. Observe the actual consumed item and hunger.",
                input_schema={"type": "object", "properties": {}, "additionalProperties": False})]
            if self.adventure_partner:
                native_actions.extend(adventure.catalogue(self.adventure_partner))
        return Capabilities(
            kind="numen", transport=self.port.transport, actions=acts,
            native_actions=native_actions,
            events=["chat", "system_message", "death", "respawn", "hunger", "inventory", "combat", "dimension", "status", "lifecycle",
                    "dialogue", "action_result", "connection", "other", "safety"] if native else
                   ["chat", "whisper", "system_message", "player_join", "player_leave", "death", "respawn", "combat", "action_progress",
                    "action_result", "server_status", "lifecycle", "other", "safety"],
            snapshot=["text", "position", "dimension", "health", "food", "life_state"],
            lifecycle=LifecycleCaps(spawn="attach", reconnect=True, destroy="detach"),
            perception="poll",
            safety=SafetyCaps(native_guards=["Numen permission rules / owner consent (denied when unattended)",
                                             "numen_controller action-receipt ledger (no replay of unknown actions)" if native else
                                             "numen-hosting fence + epoch (CONTROL_CHANGED)"]),
            limits=(["Only advertised typed actions are enabled for the NPC model; native scripting is operator-only.",
                    "The server lease fences one controller. Unknown requests are queried only by their original ID.",
                    "Native inbox events and persisted task receipts supply observation and completion."] if hosted else ["no look/mine/place/craft verbs: use native lua/skill",
                    "Lua calls block until done (native MCP, up to 150 s); stop bypasses the controller lock" if native else
                    "lua/say return 'partial' -> accepted; reconciled through mc_numen result",
                    "result() on native MCP has no per-request query: unknown stays unknown (controller blocks repeats)" if native else
                    "perception is the agent-mc-world event page (polled)"]),
        )

    # ---- lifecycle --------------------------------------------------------------------------------
    async def spawn(self) -> None:
        if self._state in ("ready", "spawning"):
            return
        self._set_state("spawning")
        try:
            info = await self.port.open()
        except Exception as error:
            self.last_error = type(error).__name__
            self._set_state("error", f"attach failed: {type(error).__name__}")
            raise
        body_id = info.get("uuid") or "unknown"
        self._identity = BodyIdentity(kind="numen", body_id=body_id, name=info.get("name") or self.name, owner_id=self.owner_id,
                                      world=WorldRef(server_id=info.get("server") or self.server_id, world_key=self.world_key),
                                      scope=self.scope, generation=self.port.generation())
        self._set_state("ready", "Numen body attached", generation=self._identity.generation)
        self._tasks = [asyncio.create_task(self._poll_loop(), name="numen-events")]
        if self.result_poll_seconds > 0:
            self._tasks.append(asyncio.create_task(self._reconcile_loop(), name="numen-results"))

    async def reconnect(self) -> None:
        await self._halt_tasks()
        with contextlib.suppress(Exception):
            await self.port.close()
        self._set_state("reconnecting")
        self._state = "detached"
        await self.spawn()

    async def destroy(self) -> None:
        await self._halt_tasks()
        with contextlib.suppress(Exception):
            await self.port.close()
        self._set_state("destroyed", "control released; the companion is kept")

    async def _halt_tasks(self) -> None:
        tasks, self._tasks = self._tasks, []
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # ---- actions ----------------------------------------------------------------------------------
    def _remember_meal(self, request_id: str) -> None:
        self._meals[request_id] = None
        self._meals.move_to_end(request_id)
        while len(self._meals) > self.LEDGER:
            self._meals.popitem(last=False)

    def _remember_item_use(self, request_id: str, item: str) -> None:
        self._item_uses[request_id] = item
        self._item_uses.move_to_end(request_id)
        while len(self._item_uses) > self.LEDGER:
            self._item_uses.popitem(last=False)

    def restore_request(self, action: BodyAction) -> None:
        super().restore_request(action)
        self._remember_adventure(action)
        if action.verb == "native" and action.name == "nourish":
            self._remember_meal(action.request_id)
        if action.verb == "use_item" and isinstance(action.args.get("item"), str):
            self._remember_item_use(action.request_id, action.args["item"])

    def _remember_adventure(self, action: BodyAction) -> None:
        if action.verb == "native" and action.name in (adventure.ACT, adventure.QUERY, adventure.SURVEY):
            self._adventures[action.request_id] = action
            if len(self._adventures) > self.LEDGER:
                self._adventures.popitem(last=False)

    @staticmethod
    def _party_check_id(request_id):
        return "party_" + hashlib.sha256(request_id.encode()).hexdigest()[:32]

    async def _adventure(self, name, args, request_id):
        account = self.identity().name
        line = adventure.player_command(name, args, account, self.adventure_partner)
        prerequisite = adventure.COORDINATION.get(args["kind"]) if name == adventure.ACT else None
        if prerequisite:
            query = {"kind": prerequisite}
            check_line = adventure.player_command(adventure.QUERY, query, account, self.adventure_partner)
            read = await self.port.call("lua", {"code": adventure.game_lua(check_line, account)}, self._party_check_id(request_id))
            if read.status in {"unknown", "accepted"}:
                return PortResult("unknown", "Original party check pending. The party change was not sent.")
            sample = adventure.game_result(read, adventure.QUERY, query)
            evidence = dict(sample.data or {})
            evidence["partyWriteSent"] = False
            if sample.status != "completed":
                return PortResult(sample.status, sample.text, evidence)
            if not any(row["type"] == "MC_RPG" and isinstance(row["value"], dict)
                       and adventure.coordination_check(args["kind"], self.adventure_partner, row["value"])
                       for row in evidence.get("adventure", {}).get("records", [])):
                return PortResult("rejected", "No party change sent. Follow the server's nextAction, or continue solo while waiting.", evidence)
        result = await self.port.call("lua", {"code": adventure.game_lua(line, account)}, request_id)
        return adventure.game_result(result, name, args, peer=self.adventure_partner)

    async def _do_act(self, action: BodyAction, request_id: str) -> ActionReceipt:
        verb, args = action.verb, action.args
        if verb == "native" and action.name in (adventure.ACT, adventure.QUERY, adventure.SURVEY):
            if not self.adventure_partner or self.port.transport != "numen-hosted-mcp":
                raise ArgumentError("This body has no configured adventure access.")
            self._remember_adventure(action.model_copy(update={"request_id": request_id}))
            if action.name == adventure.SURVEY:
                if args:
                    raise ArgumentError("survey takes no arguments")
                mapped = adventure.survey_result(await self.port.call("lua", {"code": adventure.SURVEY_LUA}, request_id))
            else:
                mapped = await self._adventure(action.name, args, request_id)
        elif verb == "native" and action.name == "nourish":
            if args or self.port.transport != "numen-hosted-mcp":
                raise ArgumentError("nourish takes no arguments and requires the hosted body")
            self._remember_meal(request_id)
            mapped = measured_meal(await self.port.call("lua", {"code": NPC_MEAL_LUA}, request_id))
        elif verb == "use_item":
            item = obj(args, "item", str)
            if set(args) != {"item"} or item not in self.item_use_ids:
                raise ArgumentError("Choose one reviewed item offered by this body's use_item catalogue")
            self._remember_item_use(request_id, item)
            mapped = measured_item_use(await self.port.call("lua", {"code": item_use_lua(item)}, request_id), item)
        elif verb == "native":
            mapped = await self.port.call(str(action.name), args, request_id)
        elif verb == "chat":
            text = obj(args, "text", str)
            if not 1 <= len(text) <= 1200:
                raise ArgumentError("text must be 1..1200 characters")
            mapped = await self.port.call("say", {"text": text}, request_id)
        elif verb == "move":
            x, y, z = xyz(args)
            code = LUA_DIALECTS[getattr(self.port, "dialect", "numen-paper")]["move"].format(x=lua_num(x), y=lua_num(y), z=lua_num(z))
            mapped = await self.port.call("lua", {"code": code}, request_id)
        elif verb == "attack":
            target = obj(args, "target", str, required=False, default="hostile")
            radius = obj(args, "radius", (int, float), required=False, default=16)
            if target not in SCAN_KINDS[:4] or not 1 <= radius <= 32:
                raise ArgumentError("target must be hostile|passive|player|all and radius 1..32")
            root = namespace(self.port)
            code = (f"local e={root}.scan.entities({lua_str(target)},{{radius={radius}}})[1]; "
                    f"if not e then print('QD_NUMEN_ATTACK no_target') return end; {root}.fight.attack(e)")
            mapped = measured_attack(await self.port.call("lua", {"code": code}, request_id))
        elif verb == "equip":
            item, hand = obj(args, "item", str), obj(args, "hand", str)
            if not ITEM.fullmatch(item):
                raise ArgumentError("equip requires an existing item ID")
            if hand == "auto" and self.port.transport == "numen-hosted-mcp":
                code = f"return {namespace(self.port)}.gear.wear({lua_str(item)})"
            else:
                if hand not in {"main", "off", "head", "chest", "legs", "feet"}:
                    raise ArgumentError("equip requires main|off|head|chest|legs|feet or an advertised automatic wardrobe")
                method, key = ("hold", "hand") if hand in {"main", "off"} else ("wear", "slot")
                code = f"return {namespace(self.port)}.gear.{method}({lua_str(item)},{{{key}={lua_str(hand)}}})"
            mapped = await self.port.call("lua", {"code": code}, request_id)
        elif verb == "drop":
            item = obj(args, "item", str)
            count = obj(args, "count", int, required=False, default=1)
            if not ITEM.match(item) or not 1 <= count <= 2304:
                raise ArgumentError("item must be an item id and count 1..2304")
            mapped = await self.port.call("lua", {"code": f"{namespace(self.port)}.inv.drop({lua_str(item)},{{count={count}}})"}, request_id)
        elif verb == "command":
            mapped = await self.port.command(obj(args, "line", str), request_id)
        elif verb == "inventory":
            if self.port.transport == "numen-hosted-mcp":
                mapped = measured_inventory(await self.port.call("lua", {"code": HOSTED_INVENTORY_LUA}, request_id))
            else:
                source = LUA_DIALECTS[getattr(self.port, "dialect", "numen-paper")]["inventory"]
                mapped = await (self.port.command(source, request_id) if source.startswith("/") else
                                self.port.call("lua", {"code": source}, request_id))
        elif verb == "observe":
            mapped = await self.port.observe()
        elif verb == "stop":
            mapped = await self.port.halt(request_id)
        else:  # pragma: no cover - guarded by capabilities
            raise ArgumentError(f"unmapped verb {verb}")
        receipt = self.receipt(request_id, verb, mapped.status, mapped.text[:4000], execution_id=mapped.execution_id, data=mapped.data)
        if receipt.terminal:
            self.emit("action_result", mapped.text[:500] or f"{verb} {mapped.status}", request_id=request_id, status=mapped.status,
                      data={"verb": verb})
        return receipt

    async def stop(self, reason: str | None = None) -> ActionReceipt:
        if "stop" not in self.capabilities().actions:
            return self.receipt("stop_unsupported", "stop", "unsupported", "no lua tool in this catalog")
        from .base import new_request_id
        return await self.act(BodyAction(verb="stop", request_id=new_request_id("stop")))

    async def _do_result(self, request_id: str, previous: ActionReceipt) -> ActionReceipt:
        action = self._adventures.get(request_id)
        if (action and action.name == adventure.ACT and action.args.get("kind") in adventure.COORDINATION
                and self.port.transport == "numen-hosted-mcp" and not self.port.recorded(request_id)):
            # A drain or crash may interrupt the read before dispatching the write.
            # Resolve that read under its original ID. Never submit either leg here.
            check_id = self._party_check_id(request_id)
            if self.port.recorded(check_id):
                check = await self.port.result(check_id)
                if check is None or check.status in {"unknown", "accepted"}:
                    return previous
            return self.settle(request_id, "rejected", "Party change was not dispatched.", {"partyWriteSent": False}) or previous
        mapped = await self.port.result(request_id)
        if mapped is not None and action is not None:
            if action.name == adventure.SURVEY:
                mapped = adventure.survey_result(mapped, recovered=True)
            else:
                mapped = adventure.game_result(mapped, action.name, action.args, peer=self.adventure_partner, recovered=True)
        if mapped is not None and request_id in self._meals:
            mapped = measured_meal(mapped)
        if mapped is not None and request_id in self._item_uses:
            mapped = measured_item_use(mapped, self._item_uses[request_id])
        if mapped is not None and previous.verb == "attack":
            mapped = measured_attack(mapped)
        if mapped is not None and previous.verb == "inventory" and self.port.transport == "numen-hosted-mcp":
            mapped = measured_inventory(mapped)
        if mapped is None or mapped.status in ("accepted",) or (mapped.status == "unknown" and previous.status == "unknown"):
            return previous
        return self.settle(request_id, mapped.status, mapped.text[:4000], mapped.data) or previous

    async def _reconcile_loop(self) -> None:
        while True:
            await asyncio.sleep(self.result_poll_seconds)
            for rid, receipt in list(self._receipts.items()):
                if receipt.status == "accepted":
                    with contextlib.suppress(Exception):
                        await self._do_result(rid, receipt)

    # ---- perception -------------------------------------------------------------------------------
    async def snapshot(self) -> BodySnapshot:
        seen = await self.port.observe()
        parsed = parse_status(seen.text)
        health = parsed.get("health")
        life = "dead" if self._life == "dead" or health == 0 else ("alive" if health is not None else "unknown")
        if health is not None:
            self._life = life
        return BodySnapshot(life_state=life,
                            position=parsed.get("position"), dimension=parsed.get("dimension"), health=parsed.get("health"),
                            max_health=parsed.get("max_health"), food=parsed.get("food"), entities=parsed.get('entities', []), text=seen.text[:4000], raw=seen.data)

    async def poll_once(self) -> int:
        count = 0
        for raw in await self.port.events():
            if raw.kind_hint is not None:  # hosted: agent-mc-world envelope
                kind = classify_envelope(raw.kind_hint)
                self._note(kind)
                self.emit(kind, raw.text, data={"type": raw.kind_hint, **raw.data}, raw=raw)
                count += 1
                continue
            wake = bool(raw.data.get("wake"))
            for kind, text, attrs in classify_native(raw.text):
                self._note(kind)
                severity = 3 if kind == "death" else (2 if wake or kind in ("dialogue", "dimension") else None)
                self.emit(kind, text, severity=severity, data={"eventId": raw.id, **attrs}, raw=raw)
                count += 1
        return count

    def _note(self, kind: str) -> None:
        if kind == "death":
            self._life = "dead"
            if self._state == "ready":
                self._state = "dead"
        elif kind == "respawn" or (kind == "lifecycle" and self._life == "dead"):
            self._life = "alive"
            if self._state == "dead":
                self._state = "ready"

    async def _poll_loop(self) -> None:
        failures = 0
        while True:
            try:
                await self.poll_once()
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                self.last_error = type(error).__name__
                if failures == 3:
                    self.emit("connection", f"event polling failing ({type(error).__name__})", severity=2)
                if type(error).__name__ == "ControlChanged":
                    self._set_state("error", "CONTROL_CHANGED: another controller owns this body; stopped")
                    return
            await asyncio.sleep(self.poll_seconds)

    def health(self):
        h = super().health()
        h.extra = {"transport": self.port.transport, "generation": self.port.generation(), "lifeState": self._life}
        return h
