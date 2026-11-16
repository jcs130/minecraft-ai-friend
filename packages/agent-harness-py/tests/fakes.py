"""Fakes for the network edges only. The code under test is the real adapter + the real reused bridges
(numen_controller.Controller, agent_mc_autonomy.bridge.outcome, touhou-maids maidCommand via node)."""
from __future__ import annotations

import asyncio
import contextlib
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from agent_mc_harness._reuse import numen_controller, repo_root

COMPANION = "6f0c1d2e-3a4b-4c5d-8e9f-001122334455"
OWNER = "0a1b2c3d-4e5f-4a6b-8c7d-8e9fa0b1c2d3"
MAID = "11111111-2222-4333-8444-555555555555"
WARNING = "[系统] 检测到你疑似使用自动化模组，继续将被临时封禁"


def text(value: Any, error: bool = False, structured: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"content": [{"type": "text", "text": value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)}],
                           "isError": error}
    if structured is not None:
        out["structuredContent"] = structured
    return out


# ------------------------------------------------------------------------------------------------ native Numen MCP
class FakeNumenWorld:
    """What the native Numen MCP server would do for one companion."""

    def __init__(self) -> None:
        self.pos = {"x": 10.0, "y": 64.0, "z": -5.0}
        self.hp, self.food, self.dimension = 20.0, 18.0, "minecraft:overworld"
        self.events: list[str] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail_next: Exception | None = None
        self.block = asyncio.Event()
        self.block.set()
        # Numen 0.1.5 replies: "one program per companion" refusal / seat-flip cut-off (the program may still have run).
        self.busy = False
        self.cut_off_next = False
        self.task_running = False

    def writes(self) -> list[tuple[str, dict[str, Any]]]:
        reads = ("/mycli status", "inventory status", "numen.status.self()", "numen.inv.items()")
        return [c for c in self.calls if c[0] not in ("get_events", "list_companions")
                and not (c[0] == "lua" and any(r in c[1].get("code", "") for r in reads))]

    async def call(self, name: str, args: dict[str, Any]) -> Any:
        from mcp import types
        self.calls.append((name, args))

        def result(t: str, error: bool = False, structured: dict[str, Any] | None = None) -> Any:
            return types.CallToolResult(content=[types.TextContent(type="text", text=t)], isError=error, structuredContent=structured)
        if name == "get_events":
            await asyncio.sleep(0.02)
            if self.events:
                block = "<events>" + "".join(self.events) + "</events>"
                self.events.clear()
                return result(block)
            return result("(no new events — call get_events again)")
        assert args.get("companion") == COMPANION, "controller must bind the companion"
        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error
        await self.block.wait()
        if name == "say":
            return result("said")
        if name == "lua":
            code = args["code"]
            if self.busy:
                return result("a call is already running for this companion, or its built-in brain is acting; wait for it to end", error=True)
            if self.cut_off_next:
                self.cut_off_next = False
                return result("this turn was cut off: EXTERNAL; nothing else ran", error=True)
            if "numen.status.self()" in code:  # numen-0.1.5 STATUS_LUA
                status = {"health": self.hp, "maxHealth": 20, "food": self.food, "position": self.pos, "dimension": self.dimension,
                          "gameMode": "survival"}
                return result("ok · 1 call · 0 s\nstdout:\nNUMEN_SELF " + json.dumps(status))
            if "numen.inv.items()" in code:
                return result("ok · 1 call · 0 s\nreturned: {stone = 3}")
            if "numen.task.stop" in code:
                stopped, self.task_running = self.task_running, False
                return result("ok · 1 call · 0 s\nstdout:\n" + ("stopped" if stopped else "idle: not_found"))
            if m := re.search(r"numen\.move\.walk\(\{x=(-?[\d.]+),y=(-?[\d.]+),z=(-?[\d.]+)\}\)", code):
                self.pos = {"x": float(m[1]), "y": float(m[2]), "z": float(m[3])}
                return result("ok · 1 call · 1 s\nstderr:\nline 1 numen.move.walk: reached")
            if "numen.mc.run(" in code:
                line = json.loads(re.search(r"numen\.mc\.run\((\".*?\")\)", code)[1])
                if line.startswith("/mycli status"):
                    out = [json.dumps({"health": self.hp, "maxHealth": 20, "food": self.food, "dimension": self.dimension, **self.pos})]
                else:
                    out = ["背包：stone x3"]
                return result("\n".join(out), structured={"commandReceipt": {"command": line, "result": 1, "output": out}})
            if m := re.search(r"numen\.move\.to\(\{x=(-?[\d.]+),y=(-?[\d.]+),z=(-?[\d.]+)\}\)", code):
                self.pos = {"x": float(m[1]), "y": float(m[2]), "z": float(m[3])}
                return result("arrived")
            if "numen.move.walk(0,0,0)" in code:
                return result("halted")
            if "numen.fight.attack" in code or "numen.inv.drop" in code:
                return result("ok")
            return result("lua done")
        return result(f"{name} ok")


class FakeSession:
    def __init__(self, world: FakeNumenWorld, *_: Any, **__: Any) -> None:
        self.world = world

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def initialize(self) -> None:
        return None

    async def list_tools(self) -> Any:
        from mcp import types
        schema = {"type": "object", "properties": {"companion": {"type": "string"}, "code": {"type": "string"}, "text": {"type": "string"}}}
        names = ["list_companions", "lua", "skill", "todo", "memory", "say", "get_events"]
        return types.ListToolsResult(tools=[types.Tool(name=n, description=f"native {n}", inputSchema=schema) for n in names])

    async def call_tool(self, name: str, arguments: dict[str, Any], read_timeout_seconds: Any = None, **_: Any) -> Any:
        return await self.world.call(name, arguments)


def patch_native(monkeypatch: Any, world: FakeNumenWorld) -> None:
    nc = numen_controller()

    @contextlib.asynccontextmanager
    async def fake_client(url: str, headers: dict[str, str] | None = None, timeout: float = 15):  # type: ignore[no-untyped-def]
        assert url.startswith("http://127.0.0.1"), "native Numen MCP must be loopback"
        assert headers and headers["Authorization"].startswith("Bearer ")
        yield (None, None, None)

    monkeypatch.setattr(nc, "streamablehttp_client", fake_client)
    monkeypatch.setattr(nc, "SEAT_SETTLE_SECONDS", 0, raising=False)
    monkeypatch.setattr(nc, "ClientSession", lambda read, write, **kw: FakeSession(world))


# ------------------------------------------------------------------------------------------------ agent-mc-world bridge
class MaidOracle:
    """Long-lived node process running the real maid-port maidCommand."""

    def __init__(self) -> None:
        node = shutil.which("node")
        if node is None:
            raise RuntimeError("node not found")
        port = repo_root() / "paper" / "integrations" / "touhou-maids" / "agent" / "maid-port.mjs"
        self.proc = subprocess.Popen([node, str(Path(__file__).with_name("maid_oracle.mjs")), str(port)], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True)
        assert self.proc.stdout is not None
        self.tool = json.loads(self.proc.stdout.readline())

    def command(self, args: dict[str, Any]) -> dict[str, Any]:
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(args) + "\n")
        self.proc.stdin.flush()
        return dict(json.loads(self.proc.stdout.readline()))

    def close(self) -> None:
        self.proc.kill()
        self.proc.wait()


class FakeBridge:
    """agent-mc-autonomy MinecraftBridge interface over a fake agent-mc-world runtime."""

    def __init__(self, *, numen: bool = False, maid_tool: dict[str, Any] | None = None, oracle: MaidOracle | None = None) -> None:
        self.tools: list[dict[str, Any]] = []
        self._numen, self._maid_tool, self.oracle = numen, maid_tool, oracle
        self.calls: list[tuple[str, dict[str, Any], str | None]] = []
        self.events: list[dict[str, Any]] = []
        self._cursor = 0
        self.opened = self.closed = 0
        # hosted numen state
        self.requests: dict[str, str] = {}
        self.hp = 20.0
        # maid state
        self.life = "alive"
        self.inbox: list[dict[str, Any]] = []
        self.receipts: dict[str, str] = {}
        self.maid_commands: list[str] = []

    async def open(self) -> None:
        self.opened += 1
        self.tools = [{"name": "mc_events", "inputSchema": {"type": "object"}}]
        if self._numen:
            self.tools.append({"name": "mc_numen", "inputSchema": {"type": "object"}})
        if self._maid_tool:
            self.tools.append({"name": "mc_maids", "description": self._maid_tool["description"], "inputSchema": self._maid_tool["parameters"]})

    async def close(self) -> None:
        self.closed += 1

    def push(self, type_: str, text_: str) -> None:
        self._cursor += 1
        self.events.append({"cursor": self._cursor, "type": type_, "text": text_})

    def writes(self) -> list[tuple[str, dict[str, Any], str | None]]:
        reads = {"catalog", "observe", "result"}
        out = []
        for name, args, rid in self.calls:
            if name == "mc_events" or (name == "mc_numen" and args.get("op") in reads):
                continue
            if name == "mc_numen" and args.get("op") == "call" and "/mycli status" in json.dumps(args, ensure_ascii=False):
                continue
            if name == "mc_maids" and args.get("action") in {"list", "context", "inventory", "inbox", "receipt", "workshop", "tasks"}:
                continue
            out.append((name, args, rid))
        return out

    async def call(self, name: str, arguments: dict[str, Any], *, timeout: float = 45, request_id: str | None = None,
                   turn_id: str | None = None, attribution: dict[str, Any] | None = None) -> dict[str, Any]:
        if name not in {t["name"] for t in self.tools}:
            raise ValueError("Unknown Minecraft tool; discover the actual tool catalogue first")
        self.calls.append((name, arguments, request_id))
        await asyncio.sleep(0)
        if name == "mc_events":
            after = arguments.get("after", 0)
            page = [e for e in self.events if e["cursor"] > after]
            return text({"protocol": "agent-mc/v1", "run": "run-1", "events": page, "nextCursor": page[-1]["cursor"] if page else after,
                         "hasMore": False, "gap": False})
        if name == "mc_numen":
            return self._numen_call(arguments, request_id)
        return self._maid_call(arguments)

    # hosted Numen (agent-mc-world numen-client.ts + numen-hosting core-port.mjs shapes)
    def _numen_call(self, args: dict[str, Any], request_id: str | None) -> dict[str, Any]:
        op = args["op"]
        if op == "catalog":
            tools = [{"name": n, "description": f"hosted {n}", "parameters": {"type": "object"}} for n in ("lua", "say", "skill", "todo", "memory", "guide")]
            return text(tools)
        if op == "observe":
            status = json.dumps({"health": self.hp, "food": 17, "x": 1, "y": 70, "z": 2, "dimension": "minecraft:overworld"})
            return text(f"Numen observation at 1700000000000 ms; server=qiandengji; uuid={COMPANION}\n{status}")
        if op == "result":
            rid = args["requestId"]
            state = "completed" if rid in self.requests else "unknown"
            self.requests[rid] = state
            return text(f"请求 {rid}：{state}。", structured={"protocol": "agent-mc/v1", "text": f"请求 {rid}：{state}。", "failed": state == "unknown",
                                                           "meta": {"backend": "numen", "requestId": rid, "state": state}})
        assert request_id, "mc_numen call needs the host callId"
        state = "partial" if args["tool"] in ("lua", "say") and "/mycli" not in json.dumps(args) else "completed"
        self.requests[request_id] = state
        out = ["ok"] if state == "partial" else ["背包：stone x3"]
        return text("\n".join(out), structured={"protocol": "agent-mc/v1", "text": "\n".join(out), "failed": False,
                                               "meta": {"backend": "numen", "requestId": request_id, "state": state}})

    # touhou maids (maid-port reply shapes; arguments checked by the real maidCommand)
    def _maid_call(self, args: dict[str, Any]) -> dict[str, Any]:
        if self.oracle is not None:
            checked = self.oracle.command(args)
            if not checked["ok"]:
                return text({"ok": False, "status": "not_dispatched", "error": checked["error"]}, error=True)
            self.maid_commands.append(checked["command"])
        action, rid = args["action"], args.get("requestId")

        def reply(data: dict[str, Any] | None = None, status: str | None = None, ok: bool = True) -> dict[str, Any]:
            value: dict[str, Any] = {"ok": ok, "action": action, "requestId": rid or "read", "sampledAt": "2026-11-16T12:00:00Z", "data": data or {}}
            if status:
                value["status"] = status
            if rid:
                value["operationId"] = rid
            return text(value)
        if action == "list":
            return reply({"maids": [{"maidId": MAID, "name": "肥鱼", "ownerId": OWNER}]})
        if action == "context":
            return reply({"lifeState": self.life, "dimension": "minecraft:overworld", "position": {"x": 3, "y": 64, "z": 4}})
        if action == "inventory":
            return reply({"slots": [], "mainHand": None, "availableSlots": 6})
        if action == "workshop":
            return reply({"workshops": [{"workshopId": "ws1", "recipes": []}]})
        if action == "inbox":
            rows, self.inbox = list(self.inbox), []
            return reply({"events": rows, "sessionKey": "s-1"})
        if action == "receipt":
            state = self.receipts.get(args["operationId"], "unknown")
            return reply({"status": state, "operationId": args["operationId"]})
        if action in ("recall", "make", "cast"):
            self.receipts[str(rid)] = "completed"
            return reply({"status": "reserved" if action == "make" else "pending"}, status="pending")
        return reply({"status": "applied"})
