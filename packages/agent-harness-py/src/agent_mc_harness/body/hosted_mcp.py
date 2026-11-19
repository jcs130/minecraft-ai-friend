"""Direct hosted_body MCP transport for the unified NPC executor.

Uses the existing Numen server lease and durable original action receipts. It
never starts Numen's model loop, summons a body, or falls back to ordinary Lua.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from .._reuse import numen_controller
from ..models import NativeAction
from .native_tasks import NativeTasks, background_task, finished_task_details
from .numen import PortResult, RawEvent, command_lua, _field


class HostedMcpPort:
    transport = "numen-hosted-mcp"
    dialect = "numen-hosted-0.1.5"

    def __init__(self, config, *, session=None):
        self.cfg = config
        url = urlsplit(config["endpoint"])
        if url.scheme != "http" or url.hostname != "127.0.0.1" or url.path != "/mcp" or url.username or url.query or url.fragment:
            raise ValueError("hosted_mcp_must_be_reviewed_loopback")
        self.body = config["bodyId"]
        self.boot, self.epoch = str(uuid4()), 1
        self.task_connection = self.boot
        self.session = session
        self.stack = None
        self.connection_task = None
        self.connected = None
        self.stopping = asyncio.Event()
        self.heartbeat = None
        self.tools = []
        self.seen = set()
        self.task_floor = None
        self.finished_ids = set()
        self.lost = False
        self.ledger = NativeTasks(Path(config["journalDirectory"]) / "hosted-tasks.sqlite3", self.body)

    async def rpc(self, op, **values):
        if self.lost and op not in {"facts", "observe", "result"}:
            raise RuntimeError("CONTROL_CHANGED")
        args = {**values, "op": op, "companion": self.body, "expectedName": self.cfg["name"],
                "expectedOwner": self.cfg["ownerId"], "serverId": self.cfg["serverId"], "boot": self.boot, "epoch": self.epoch}
        reply = await self.session.call_tool("hosted_body", args)
        if _field(reply, "isError", "is_error"):
            raise RuntimeError("HOSTED_REQUEST_REFUSED_QUERY_ORIGINAL")
        value = _field(reply, "structuredContent", "structured_content")
        if not value:
            blocks = getattr(reply, "content", [])
            if len(blocks) != 1 or blocks[0].type != "text":
                raise ValueError("hosted_structured_receipt_required")
            value = json.loads(blocks[0].text)
        if not isinstance(value, dict):
            raise ValueError("hosted_structured_receipt_required")
        if "roleUuid" in value and value["roleUuid"] != self.body:
            raise ValueError("hosted_body_identity_mismatch")
        return value

    async def open(self):
        if self.session is None:
            self.connected = asyncio.get_running_loop().create_future()
            self.connection_task = asyncio.create_task(self._connection())
            await self.connected
        caps = await self.rpc("capabilities")
        if caps.get("protocol") != "qiandengji-hosted-body/v1" or not all(caps.get(k) is True for k in ("stableIdentity", "serverFence", "persistedReceipts")):
            raise ValueError("hosted_fenced_body_required")
        attached = await self.rpc("attach")
        if attached.get("fenced") is not True or attached.get("mode") != "paused":
            raise RuntimeError("original_body_not_paused")
        await self._start_task_window()
        self.epoch += 1
        started = await self.rpc("transition", mode="harness")
        if started.get("fenced") is not True or started.get("mode") != "harness" or started.get("epoch") != self.epoch:
            raise RuntimeError("hosted_control_not_confirmed")
        self.tools = [NativeAction(name=t["name"], description=t.get("description", "")[:300], input_schema=t.get("parameters", {}), read_only=t["name"] == "guide") for t in (await self.rpc("catalog"))["tools"]]
        self.heartbeat = asyncio.create_task(self._heartbeat())
        return {"uuid": self.body, "name": self.cfg["name"], "session": True}

    async def _connection(self):
        nc = numen_controller()
        try:
            async with nc.streamablehttp_client(self.cfg["endpoint"], headers={"Authorization":"Bearer "+Path(self.cfg["tokenFile"]).read_text().strip()}, timeout=15) as streams:
                async with nc.ClientSession(streams[0],streams[1]) as session:
                    await session.initialize()
                    self.session = session
                    self.connected.set_result(True)
                    await self.stopping.wait()
        except Exception as error:
            self.lost = True
            if not self.connected.done(): self.connected.set_exception(error)

    async def _heartbeat(self):
        try:
            while True:
                await asyncio.sleep(2)
                status = await self.rpc("heartbeat")
                if status.get("epoch") != self.epoch or status.get("mode") != "harness":
                    raise RuntimeError("CONTROL_CHANGED")
        except asyncio.CancelledError:
            raise
        except Exception:
            self.lost = True

    def catalog(self): return self.tools
    def generation(self): return self.boot + ":" + str(self.epoch)

    def recorded(self, request_id):
        """A call is committed locally before any RPC can leave this process."""
        return self.ledger.get(request_id, self.task_connection) is not None

    def mapped(self, value, request, tool=None):
        if value.get("id") != request:
            raise ValueError("hosted_original_request_mismatch")
        state, text = value.get("state"), str(value.get("message", ""))
        outcome = None
        with contextlib.suppress(ValueError):
            decoded = json.loads(text)
            if isinstance(decoded,dict) and isinstance(decoded.get("success"),bool) and isinstance(decoded.get("message"),str):
                outcome = decoded["success"]
                text = decoded["message"]
        # An urgent world event can stop Lua while its already-dispatched native
        # attack keeps running. The task ID will receive its own finish event.
        if state == "blocked" and outcome is False:
            running = background_task(text)
            if running:
                return PortResult("accepted", text, value, running)
        if state in ("failed", "blocked", "cancelled"):
            return PortResult("rejected", text, value)
        if state == "unknown":
            return PortResult("unknown", text, value)
        task = background_task(text)
        if task:
            return PortResult("accepted", text, value, task)
        if outcome is False:
            return PortResult("failed",text,value)
        if state == "completed" or state == "partial" and tool == "say" and "Speech dispatched" in text:
            return PortResult("completed", text, value)
        # Synchronous Lua completion has no remaining native job. A partial
        # envelope alone is not completion evidence.
        if state == "partial" and outcome is True and (tool == "lua" or re.match(r"ok · \d+ calls? · ",text)):
            return PortResult("completed", text, value)
        return PortResult("unknown", text, value)

    async def call(self, tool, args, request_id):
        signature = hashlib.sha256(json.dumps([tool,args], sort_keys=True).encode()).hexdigest()
        old = self.ledger.get(request_id, self.task_connection)
        if old:
            if old["data"]["fingerprint"] != signature:
                return PortResult("rejected","request_id_conflict; query the original request")
            return PortResult(**old)
        self.ledger.begin(request_id, signature, self.task_connection)
        try:
            value = await self.rpc("call", id=request_id, tool=tool, args=args)
            result = self.mapped(value, request_id, tool)
            self.ledger.save(request_id, result.status, result.text, result.execution_id)
            return result
        except Exception:
            return PortResult("unknown", "Original hosted action outcome unknown; query its request ID.")

    async def result(self, request_id):
        saved = self.ledger.get(request_id, self.task_connection)
        if saved and saved["status"] not in ("accepted", "unknown"): return PortResult(**saved)
        value = await self.rpc("result", id=request_id)
        result = self.mapped(value, request_id)
        if (saved and result.status == "accepted" and saved["status"] == "unknown"
                and saved["data"]["connection"] == self.task_connection):
            # The call may have returned after the client timed out. Bind its native
            # task to the original request, without submitting the action again.
            self.ledger.save(request_id, result.status, result.text, result.execution_id)
            return result
        if result.status not in ("accepted", "unknown"):
            self.ledger.save(request_id, result.status, result.text, result.execution_id)
            return result
        return PortResult(**saved) if saved else result

    async def observe(self):
        facts = await self.rpc("facts")
        position = facts["position"]
        parsed = {"health": facts["health"], "maxHealth": facts["maxHealth"], "food": facts["food"],
                  "position": dict(zip(("x","y","z"),position)), "dimension": facts["dimension"]}
        battle = (await self.rpc("battlefield")).get("battlefield")
        entities = [] if not battle else [dict(e, hostile=True) for e in battle.get("threats", [])]
        text = "NUMEN_SELF " + json.dumps(parsed) + "\n" + "\n".join("NUMEN_ENTITY " + json.dumps(e) for e in entities)
        return PortResult("completed", text, {"facts":facts,"battlefield":battle})

    @staticmethod
    def _inbox(observed):
        text = observed.get("text", "")
        match = re.search(r'Native inbox snapshot[^\n]*?: (\[.*\])\s*$', text, re.S)
        return json.loads(match[1]) if match else []

    async def _start_task_window(self):
        # Task numbers restart at t1. Old inbox entries must never settle a new
        # action, even if a number and native tool name both happen to match.
        snapshot = await self.rpc("observe")
        self.task_floor = snapshot.get("sampledAt")
        self.finished_ids = {row["id"] for row in self._inbox(snapshot) if row.get("type") == "task_finished"}

    def _record_finishes(self, rows):
        for row in rows:
            if (row.get("type") != "task_finished" or row.get("id") in self.finished_ids
                    or not isinstance(self.task_floor, int) or not isinstance(row.get("at"), int)
                    or row["at"] <= self.task_floor):
                continue
            for task, tool, status, detail in finished_task_details("<events>" + row["text"] + "</events>"):
                if tool and self.ledger.finish(self.task_connection, task, status, detail, tool=tool):
                    self.finished_ids.add(row["id"])
        # Keep applied IDs while the same events are still in the server inbox.
        self.finished_ids.intersection_update(row["id"] for row in rows)

    async def _drain_stopped(self):
        # A confirmed pause stops a running walk/fight and publishes task_finished.
        # The original session is still available here, including after a server-side Stop.
        pending = self.ledger.pending(self.task_connection)
        if not pending:
            return
        async with asyncio.timeout(4):
            for request in pending:
                await self.result(request)
            for delay in (0, .1, .25, .5):
                if delay: await asyncio.sleep(delay)
                self._record_finishes(self._inbox(await self.rpc("observe")))
                if not self.ledger.pending(self.task_connection):
                    break

    async def events(self):
        rows = self._inbox(await self.rpc("observe"))
        # Reconsider an event that raced the Lua reply on the next read.
        self._record_finishes(rows)
        result = []
        for row in reversed(rows):
            key = str(row["id"])
            if key in self.seen: continue
            self.seen.add(key)
            kind, words = row["type"], row["text"]
            if kind == "qd_npc_dialogue":
                # Only the server-authored event kind is decoded; arbitrary chat
                # containing JSON never gains speaker identity or private privileges.
                try:
                    dialogue = json.loads(words)
                    if (dialogue.get("schema") != 1 or dialogue.get("listenerId") != self.body
                            or not isinstance(dialogue.get("speakerId"), str)
                            or not str(dialogue.get("eventId", "")).startswith("qdvoice:" + dialogue["speakerId"] + ":")
                            or dialogue.get("channel") not in ("chat", "voice", "npc_chat", "public")
                            or not isinstance(dialogue.get("text"), str)):
                        continue
                    result.append(RawEvent(key, dialogue["text"][:1200], "chat",
                        {**dialogue, "trusted": False, "nativeKind": kind, "source": "untrusted_game_dialogue",
                         "serverAttributed": True}))
                except (ValueError, TypeError, AttributeError):
                    pass
                continue
            hint = "chat" if kind in ("talk","query","web_spectator_message") else "system_message"
            result.append(RawEvent(key, words, hint, {"eventId":key,"nativeKind":kind,"occurredAt":row.get("at")}))
        if len(self.seen) > 4096: self.seen = {str(r["id"]) for r in rows}
        return result

    async def command(self, line, request_id):
        return await self.call("lua", {"code":command_lua(line,"numen_hosted")},request_id)

    async def halt(self, request_id):
        # A lease transition stops the old actuator. It cannot enqueue a second
        # Lua program behind the task it is meant to stop.
        self.epoch += 1
        value = await self.rpc("transition", mode="paused")
        if value.get("fenced") is not True: return PortResult("unknown","halt not confirmed")
        await self._drain_stopped()
        await self._start_task_window()
        self.task_connection = str(uuid4())
        self.epoch += 1
        await self.rpc("transition", mode="harness")
        return PortResult("completed","Original actuator stopped by server fence.")

    async def close(self):
        if self.heartbeat:
            self.heartbeat.cancel()
            await asyncio.gather(self.heartbeat,return_exceptions=True)
        if self.session and not self.lost:
            self.epoch += 1
            with contextlib.suppress(Exception):
                paused = await self.rpc("transition", mode="paused")
                if paused.get("fenced") is True and paused.get("mode") == "paused" and paused.get("epoch") == self.epoch:
                    await self._drain_stopped()
        self.stopping.set()
        if self.connection_task: await asyncio.gather(self.connection_task,return_exceptions=True)
        self.ledger.close()
