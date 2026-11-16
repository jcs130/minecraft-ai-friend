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
import json
import re
from collections import OrderedDict
from dataclasses import dataclass, field
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
from .base import ArgumentError, BaseBody, obj, xyz

STATUS_LINE = "/mycli status --json"
INVENTORY_LINE = "/mycli inventory status"
# numen.task.stop fails with not_found when the body is idle; that is a successful stop for us.
STOP_LUA = ("local ok,e=pcall(numen.task.stop) if ok then print('stopped') "
            "else print('idle: '..tostring(type(e)=='table' and e.kind or e)) end")
STATUS_LUA = ("local me=numen.status.self() "
              "print('NUMEN_SELF {\"health\":'..me.hp..',\"maxHealth\":'..me.max_hp..',\"food\":'..me.hunger.."
              "',\"position\":{\"x\":'..me.pos.x..',\"y\":'..me.pos.y..',\"z\":'..me.pos.z..'},\"dimension\":\"'..me.dimension.."
              "'\",\"gameMode\":\"'..me.game_mode..'\"}')")
INVENTORY_LUA = "return numen.inv.items()"
LUA_DIALECTS: dict[str, dict[str, str]] = {
    "numen-0.1.5": {"move": "numen.move.walk({{x={x},y={y},z={z}}})", "stop": STOP_LUA, "observe": STATUS_LUA, "inventory": INVENTORY_LUA},
    "numen-paper": {"move": "numen.move.to({{x={x},y={y},z={z}}})", "stop": "numen.move.walk(0,0,0)", "observe": STATUS_LINE,
                    "inventory": INVENTORY_LINE},
}
# Numen 0.1.5 replies: the program was refused before it ran / was cut while the driving seat flipped (it may still run).
BUSY = re.compile(r"a call is already running for this companion|another program is already running", re.I)
CUT_OFF = re.compile(r"this turn was cut off", re.I)
ITEM = re.compile(r"^[a-z0-9_.-]+(?::[a-z0-9_./-]+)?$")
SCAN_KINDS = ("hostile", "passive", "player", "all", "item")


def _field(model: Any, camel: str, snake: str) -> Any:
    """mcp 1.x exposes camelCase result/tool fields, mcp 2.x snake_case (isError -> is_error ...)."""
    return getattr(model, camel) if hasattr(model, camel) else getattr(model, snake, None)


@dataclass
class PortResult:
    status: ActionStatus
    text: str = ""
    data: Any = None
    execution_id: str | None = None


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
        config = {**config, "read_only_lua": sorted({*config.get("read_only_lua", []), STATUS_LUA, INVENTORY_LUA})}
        # Controller(cfg) needs: upstream_url (loopback), token_file (path only - never the token), companion_uuid,
        # journal_dir. The QwenPaw console delivery is not used: event_transport=channel, auto_wake=False.
        self.cfg = {"qwenpaw_url": "http://127.0.0.1:9", "agent_id": "agent-mc-harness", **config,
                    "event_transport": "channel", "auto_wake": False}
        self.nc = numen_controller()
        self.controller = controller
        self._stack: contextlib.AsyncExitStack | None = None
        self._seen: OrderedDict[str, None] = OrderedDict()

    async def open(self) -> dict[str, Any]:
        if self.controller is None:
            self.controller = self.nc.Controller(self.cfg)
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
        if structured.get("status") == "unknown" or "结果未知" in text or CUT_OFF.search(text):
            return PortResult("unknown", text, structured)
        if _field(result, "isError", "is_error"):
            return PortResult("failed", text, structured)
        return PortResult("completed", text, structured or None)

    async def call(self, tool: str, args: dict[str, Any], request_id: str) -> PortResult:
        # The controller binds `companion`, journals, guards repeats and never replays (request_id is ours only).
        return self._map(await self.controller.call(tool, args))

    async def command(self, line: str, request_id: str) -> PortResult:
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
            fresh.append(RawEvent(id=row["id"], text=row.get("text", ""), data={"wake": bool(row.get("wake"))}))
        while len(self._seen) > 1024:
            self._seen.popitem(last=False)
        return fresh

    async def result(self, request_id: str) -> PortResult | None:
        return None  # native Numen MCP has no per-request query; the controller ledger blocks repeats instead

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
    dialect = "numen-paper"

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
        return await self.call("lua", {"code": numen_controller().command_script(line)}, request_id)

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
                     "dimension_change": "dimension", "task_finished": "status", "respawn": "respawn", "hurt": "combat"}
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
                 name: str | None = None, owner_id: str | None = None, poll_seconds: float = 2.0, result_poll_seconds: float = 3.0) -> None:
        super().__init__()
        self.port, self.scope, self.server_id, self.world_key = port, scope, server_id, world_key
        self.name, self.owner_id = name, owner_id
        self.poll_seconds, self.result_poll_seconds = poll_seconds, result_poll_seconds
        self._identity: BodyIdentity | None = None
        self._tasks: list[asyncio.Task[None]] = []
        self._life = "unknown"
        self._last: dict[str, Any] = {}

    # ---- identity / capabilities -----------------------------------------------------------------
    def identity(self) -> BodyIdentity | None:
        return self._identity

    def _tools(self) -> set[str]:
        return {n.name for n in self.port.catalog()}

    def capabilities(self) -> Capabilities:
        tools = self._tools()
        lua, native = "lua" in tools, self.port.transport == "numen-mcp"
        dialect = LUA_DIALECTS[getattr(self.port, "dialect", "numen-paper")]

        def via(source: str) -> str:
            return f"command {source}" if source.startswith("/") else f"lua {source[:60]}"
        acts: dict[str, ActionSupport] = {"observe": ActionSupport(native="mc_numen observe" if not native else via(dialect["observe"]))}
        if "say" in tools:
            acts["chat"] = ActionSupport(native="say", args=["text"])
        if lua:
            acts["move"] = ActionSupport(native="lua " + dialect["move"].split("(")[0], args=["x", "y", "z"], async_=not native)
            acts["stop"] = ActionSupport(native="lua " + ("numen.task.stop" if dialect["stop"] == STOP_LUA else dialect["stop"]),
                                         notes="lands between programs: Numen runs one program per companion" if native else
                                         "halt used by numen-hosting on handoff")
            acts["attack"] = ActionSupport(native="lua numen.scan.entities + numen.fight.attack", args=["target", "radius"], async_=not native,
                                           notes="target: hostile|passive|player|all; first visible match")
            acts["drop"] = ActionSupport(native="lua numen.inv.drop", args=["item", "count"], async_=not native)
            acts["command"] = ActionSupport(native="command (numen.mc.run)" if native else "lua numen.mc.run", args=["line"],
                                            notes="the body's own /mycli commands; normal player permissions")
            acts["inventory"] = ActionSupport(native=via(dialect["inventory"]))
        return Capabilities(
            kind="numen", transport=self.port.transport, actions=acts,
            native_actions=self.port.catalog(),
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
            limits=["no look/mine/place/craft verbs: use native lua/skill",
                    "Lua calls block until done (native MCP, up to 150 s); stop bypasses the controller lock" if native else
                    "lua/say return 'partial' -> accepted; reconciled through mc_numen result",
                    "result() on native MCP has no per-request query: unknown stays unknown (controller blocks repeats)" if native else
                    "perception is the agent-mc-world event page (polled)"],
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
    async def _do_act(self, action: BodyAction, request_id: str) -> ActionReceipt:
        verb, args = action.verb, action.args
        if verb == "native":
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
            radius = obj(args, "radius", int, required=False, default=16)
            if target not in SCAN_KINDS[:4] or not 1 <= radius <= 32:
                raise ArgumentError("target must be hostile|passive|player|all and radius 1..32")
            code = (f"local e=numen.scan.entities({lua_str(target)},{{radius={radius}}})[1]; "
                    "if not e then print('no target') return end; numen.fight.attack(e)")
            mapped = await self.port.call("lua", {"code": code}, request_id)
        elif verb == "drop":
            item = obj(args, "item", str)
            count = obj(args, "count", int, required=False, default=1)
            if not ITEM.match(item) or not 1 <= count <= 2304:
                raise ArgumentError("item must be an item id and count 1..2304")
            mapped = await self.port.call("lua", {"code": f"numen.inv.drop({lua_str(item)},{{count={count}}})"}, request_id)
        elif verb == "command":
            mapped = await self.port.command(obj(args, "line", str), request_id)
        elif verb == "inventory":
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
        mapped = await self.port.result(request_id)
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
        return BodySnapshot(life_state=life,
                            position=parsed.get("position"), dimension=parsed.get("dimension"), health=parsed.get("health"),
                            max_health=parsed.get("max_health"), food=parsed.get("food"), text=seen.text[:4000], raw=seen.data)

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
