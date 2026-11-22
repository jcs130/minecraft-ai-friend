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
from .native_tasks import HOSTED_STOP, NativeTasks, background_task, finished_task_details
from .numen import PortResult, RawEvent, command_lua, _field


HEARTBEAT_INTERVAL_SECONDS = 2
HEARTBEAT_RPC_SECONDS = 3
WALK_INLINE_SECONDS = 2


class HostedMcpPort:
    transport = "numen-hosted-mcp"
    dialect = "numen-hosted-0.1.5"

    def __init__(self, config, *, session=None, action_journal=None):
        self.cfg = config
        url = urlsplit(config["endpoint"])
        if url.scheme != "http" or url.hostname != "127.0.0.1" or url.path != "/mcp" or url.username or url.query or url.fragment:
            raise ValueError("hosted_mcp_must_be_reviewed_loopback")
        self.body = config["bodyId"]
        self.boot, self.epoch = str(uuid4()), 1
        self.task_connection = self.boot
        self.session = session
        self._provided_session = session
        self.stack = None
        self.connection_task = None
        self.connected = None
        self.stopping = asyncio.Event()
        self.heartbeat = None
        self.tools = []
        self.seen = set()
        self.task_floor = None
        self.finished_ids = set()
        self.finish_candidates = {}
        self.finish_outcomes = {}
        self.latest_finish_at = 0
        self.lost = False
        self.disconnected = asyncio.Event()
        self.control_lock = asyncio.Lock()
        self.transition_lock = asyncio.Lock()
        self.lease_mode = "paused"
        self.owned_epoch = 0
        self.requested_mode = "paused"
        self.previous_states = frozenset()
        self.attached = False
        self._initial_fence = None
        self.closing = False
        self.next_receipt_probe = {}
        self.next_vacancy_probe = None
        self.walk_request: tuple[str, int, asyncio.Task[PortResult]] | None = None
        self.action_journal = action_journal
        self.ledger = NativeTasks(Path(config["journalDirectory"]) / "hosted-tasks.sqlite3", self.body)

    async def rpc(self, op, **values):
        if self.lost and op not in {"facts", "observe", "result"}:
            raise RuntimeError("CONTROL_CHANGED")
        return await self._request(self.session, op, **values)

    async def _request(self, session, op, *, fence_epoch=None, **values):
        args = {**values, "op": op, "companion": self.body, "expectedName": self.cfg["name"],
                "expectedOwner": self.cfg["ownerId"], "serverId": self.cfg["serverId"], "boot": self.boot,
                "epoch": self.epoch if fence_epoch is None else fence_epoch}
        reply = await session.call_tool("hosted_body", args)
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
        await self._acquire("attach", "paused")
        self.attached = True
        await self._start_task_window()
        self.epoch += 1
        await self._acquire("transition", "harness")
        self.tools = [NativeAction(name=t["name"], description=t.get("description", "")[:300], input_schema=t.get("parameters", {}), read_only=t["name"] == "guide") for t in (await self.rpc("catalog"))["tools"]]
        self.heartbeat = asyncio.create_task(self._heartbeat())
        self._initial_fence = self.generation()
        return {"uuid": self.body, "name": self.cfg["name"], "session": True}

    def _confirmed(self, reply, mode, epoch=None):
        return (reply.get("roleUuid") == self.body and reply.get("fenced") is True
                and reply.get("mode") == mode and reply.get("epoch") == (self.epoch if epoch is None else epoch))

    @staticmethod
    def _control_denied(error):
        return isinstance(error, ValueError) or str(error) in {"CONTROL_CHANGED", "HOSTED_REQUEST_REFUSED_QUERY_ORIGINAL"}

    async def _acquire(self, operation, mode):
        self.requested_mode = mode
        try:
            reply = await self.rpc(operation, **({"mode": mode} if operation == "transition" else {}))
            if not self._confirmed(reply, mode):
                raise RuntimeError("CONTROL_CHANGED")
        except Exception as error:
            if self._control_denied(error):
                self.lost = True
            raise
        self.lease_mode, self.owned_epoch = mode, self.epoch

    @property
    def confirmed_initial_fence(self):
        return None if self.lost or self.closing else self._initial_fence

    @contextlib.asynccontextmanager
    async def _mcp_session(self):
        nc = numen_controller()
        headers = {"Authorization": "Bearer " + Path(self.cfg["tokenFile"]).read_text().strip()}
        async with nc.streamablehttp_client(self.cfg["endpoint"], headers=headers, timeout=15) as streams:
            async with nc.ClientSession(streams[0], streams[1]) as session:
                await session.initialize()
                yield session

    async def _connection(self):
        try:
            async with self._mcp_session() as session:
                self.session = session
                self.connected.set_result(True)
                await self.stopping.wait()
        except Exception as error:
            if not self.lost:
                self.lost = True
                self.disconnected.set()
            if not self.connected.done(): self.connected.set_exception(error)

    async def _heartbeat(self):
        missed = False
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            try:
                await self._heartbeat_once()
            except Exception as error:
                # A missed response does not itself change the server fence.
                # Let the next scheduled heartbeat confirm the same fence.
                if not self.lost and not missed and self._transient_facts_error(error):
                    missed = True
                    continue
                await self._lose_control(error)
                return
            missed = False

    async def _lose_control(self, error):
        if self.lost:
            return
        self.lost = True
        if not self._control_denied(error):
            self.disconnected.set()
        elif (str(error) == "HOSTED_REQUEST_REFUSED_QUERY_ORIGINAL" and self._initial_fence
              and not self.closing):
            # Both expiry and an active handoff can refuse our heartbeat.
            try:
                async with asyncio.timeout(3):
                    facts = await self.rpc("facts")
            except Exception as read_error:
                if self._transient_facts_error(read_error):
                    self.next_vacancy_probe = asyncio.get_running_loop().time() + 15
                return
            if self._vacant(facts, {self.owned_epoch, self.epoch}):
                self.disconnected.set()

    async def _recheck_vacancy(self):
        # The old MCP stream can be unusable after a stall. A new read-only
        # session asks about the original fence, without attaching or renewing.
        now = asyncio.get_running_loop().time()
        if self.closing or self.next_vacancy_probe is None or now < self.next_vacancy_probe:
            return
        self.next_vacancy_probe = None
        try:
            async with asyncio.timeout(6), self._mcp_session() as session:
                facts = await self._request(session, "facts")
        except Exception as error:
            if self._transient_facts_error(error):
                self.next_vacancy_probe = asyncio.get_running_loop().time() + 15
            return
        if (self.closing or facts.get("epoch") != self.owned_epoch or facts.get("ready") is not True
                or not self._vacant(facts, {self.owned_epoch})):
            return
        if self._unfinished_local_work():
            # The original receipt poll may still settle a physically finished
            # call. Keep this body fenced until that outcome has been recorded.
            self.next_vacancy_probe = asyncio.get_running_loop().time() + 15
            return
        self.disconnected.set()

    @staticmethod
    def _transient_facts_error(error):
        if isinstance(error, BaseExceptionGroup):
            return all(HostedMcpPort._transient_facts_error(child) for child in error.exceptions)
        from anyio import BrokenResourceError, ClosedResourceError, EndOfStream
        from httpx import TransportError
        if isinstance(error, (OSError, TransportError, BrokenResourceError, ClosedResourceError, EndOfStream)):
            return True
        # MCP 2 uses httpx2, whose transport exceptions are separate classes.
        try:
            from httpx2 import TransportError as NewTransportError
        except ImportError:
            return False
        return isinstance(error, NewTransportError)

    def _unfinished_local_work(self):
        if self.action_journal and self.action_journal.unresolved(self.body):
            return True
        for request, connection in self.ledger.unsettled():
            if self.action_journal is None or connection in {self.task_connection, self.boot} or (connection or "").startswith(self.boot + ":"):
                return True
            # Earlier versions sometimes retained an uncertain transport row
            # after an original action was separately reconciled by the host.
            receipt = self.action_journal.receipt(self.body, request)
            if not receipt or receipt.request_id != request or not receipt.terminal or receipt.status in {"accepted", "unknown"}:
                return True
        return False

    async def _heartbeat_once(self):
        # The queue drain can take longer than a lease. Renew our deliberate
        # pause while it runs, but never race an epoch/mode change.
        async with self.transition_lock:
            async with asyncio.timeout(HEARTBEAT_RPC_SECONDS):
                status = await self.rpc("heartbeat")
            if not self._confirmed(status, self.lease_mode):
                raise RuntimeError("CONTROL_CHANGED")

    def catalog(self): return self.tools
    def generation(self): return self.boot + ":" + str(self.epoch)

    def new_session_port(self):
        # Fresh process fence, transport and SQLite handle; durable calls stay
        # bound to the same configured body. The injected session is for tests.
        if self.lost and not self.disconnected.is_set():
            raise RuntimeError("CONTROL_CHANGED")
        port = HostedMcpPort(self.cfg, session=self._provided_session, action_journal=self.action_journal)
        port.previous_states = {(self.owned_epoch, self.lease_mode), (self.epoch, self.requested_mode)}
        return port

    async def wait_previous_release(self, *, never_attached=False):
        """Observe the prior seat becoming vacant without extending its lease."""
        if not self.previous_states and not never_attached:
            return
        async with asyncio.timeout(25):
            if self._provided_session is None:
                async with self._mcp_session() as session:
                    await self._wait_for_vacancy(session, never_attached=never_attached)
            else:
                await self._wait_for_vacancy(self._provided_session, never_attached=never_attached)

    async def wait_voluntary_release(self):
        """Verify the closed controller's native seat before announcing a handoff."""
        if not self.closing or self.attached:
            raise RuntimeError("hosted_control_still_open")
        self.previous_states = {(self.owned_epoch, self.lease_mode), (self.epoch, self.requested_mode)}
        for attempt in range(2):
            try:
                await self.wait_previous_release(never_attached=self.owned_epoch == 0)
                return
            except Exception as error:
                if attempt or not self._transient_facts_error(error):
                    raise
                await asyncio.sleep(.5)

    async def wait_for_return(self, paused):
        """Wait without renewing another controller's lease or attaching early."""
        while not paused():
            try:
                await self.wait_previous_release(never_attached=True)
            except Exception as error:
                if not self._transient_facts_error(error):
                    raise
                await asyncio.sleep(2)
            else:
                return not paused()
        return False

    async def _wait_for_vacancy(self, session, *, never_attached=False):
        epochs = {epoch for epoch, _ in self.previous_states}
        while True:
            facts = await self._request(session, "facts")
            epoch, mode = facts.get("epoch"), facts.get("mode")
            if self._vacant(facts, {epoch} if never_attached else epochs):
                return  # attach still has to win the native fence atomically
            if facts.get("roleUuid") != self.body or not never_attached and (epoch, mode) not in self.previous_states:
                self.lost = True
                raise RuntimeError("CONTROL_CHANGED")
            await asyncio.sleep(.5)

    def _vacant(self, facts, epochs):
        epoch = facts.get("epoch")
        return (facts.get("roleUuid") == self.body and facts.get("mode") == "paused"
                and facts.get("fenced") is False and facts.get("workPending") is False
                and type(epoch) is int and (epoch == 0 or epoch in epochs))

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
        # A persisted result contains the server's outcome but omits the tool name.
        # The exact successful say acknowledgement proves dispatch, not a reply.
        speech_dispatched = (tool == "say" and "Speech dispatched" in text
                             or tool is None and outcome is True
                             and text == "Speech dispatched; it is not evidence of a reply.")
        if state == "completed" or state == "partial" and speech_dispatched:
            return PortResult("completed", text, value)
        # Synchronous Lua completion has no remaining native job. A partial
        # envelope alone is not completion evidence.
        if state == "partial" and outcome is True and (tool == "lua" or re.match(r"ok · \d+ calls? · ",text)):
            return PortResult("completed", text, value)
        return PortResult("unknown", text, value)

    async def start_walk(self, code, request_id):
        return await self._submit("lua", {"code": code}, request_id, walk=True)

    async def call(self, tool, args, request_id):
        return await self._submit(tool, args, request_id, walk=False)

    async def _submit(self, tool, args, request_id, *, walk):
        signature = hashlib.sha256(json.dumps([tool,args], sort_keys=True).encode()).hexdigest()
        # Only admission is serialized. A long-running call must stay interruptible.
        async with self.control_lock:
            if self.stopping.is_set():
                return PortResult("unknown", "Session closed; query the original request after reconnect.")
            old = self.ledger.get(request_id, self.task_connection)
            if old:
                if old["data"]["fingerprint"] != signature:
                    return PortResult("rejected","request_id_conflict; query the original request")
                return PortResult(**old)
            if self.lost or self.closing:
                return PortResult("rejected", "Hosted control unavailable; this new action was not dispatched.")
            if walk and self.walk_request:
                original, walk_epoch, pending = self.walk_request
                if walk_epoch == self.epoch and (
                    not pending.done() or self.ledger.get(original, self.task_connection)["status"] in {"accepted", "unknown"}
                ):
                    return PortResult("rejected", "The previous hosted walk has no terminal result. Query its original request or stop it before choosing another route.",
                                      {"reason": "walk_in_progress", "originalRequestId": original, "targetReached": False})
            self.ledger.begin(request_id, signature, self.task_connection)
            epoch, generation = self.epoch, self.task_connection
            if walk:
                task = asyncio.create_task(self._dispatch(tool, args, request_id, epoch, generation))
                self.walk_request = (request_id, epoch, task)
        if not walk:
            return await self._dispatch(tool, args, request_id, epoch, generation)
        done, _ = await asyncio.wait({task}, timeout=WALK_INLINE_SECONDS)
        if task.cancelled():
            return PortResult("unknown", "The local walk wait ended after a control change. Query the original request without resending.",
                              {"reason": "walk_wait_ended", "originalRequestId": request_id})
        return task.result() if done else self._walk_pending(request_id)

    @staticmethod
    def _walk_pending(request_id):
        return PortResult("accepted", "Walk admitted by the local controller; arrival is unconfirmed. Query the original request without resending.",
                          {"reason": "walk_in_progress", "originalRequestId": request_id, "targetReached": False,
                           "nextSafeRead": "result"})

    async def _dispatch(self, tool, args, request_id, epoch, generation):
        try:
            value = await self.rpc("call", fence_epoch=epoch, id=request_id, tool=tool, args=args)
            result = self.mapped(value, request_id, tool)
            if result.status == "accepted" and result.execution_id:
                bound = self.ledger.bind_background(request_id, generation, result.execution_id, result.text)
                return result if bound["status"] == "accepted" else PortResult(**bound)
            self.ledger.save(request_id, result.status, result.text, result.execution_id)
            return result
        except Exception as error:
            return PortResult("unknown", "Original hosted action outcome unknown; query its request ID.",
                              {"reason": "native_rpc_unconfirmed", "errorType": type(error).__name__})

    async def result(self, request_id):
        if self.stopping.is_set():
            return PortResult("unknown", "Session closed; query the original request after reconnect.")
        saved = self.ledger.get(request_id, self.task_connection)
        if saved and saved["status"] not in ("accepted", "unknown"): return PortResult(**saved)
        if self.walk_request and self.walk_request[0] == request_id:
            task = self.walk_request[2]
            if not task.done() and not self.lost:
                return self._walk_pending(request_id)
        if saved and saved["data"]["fingerprint"] == HOSTED_STOP:
            # No "result" file exists for lease transitions on the Numen server.
            async with self.control_lock:
                if self.stopping.is_set():
                    return PortResult(**saved)
                return self._stop_result(request_id)
        if self.lost and saved:
            # A transport session can expire after the game has already committed
            # the original result. Read it without attaching or renewing the lease.
            now = asyncio.get_running_loop().time()
            if now < self.next_receipt_probe.get(request_id, 0):
                return PortResult(**saved)
            self.next_receipt_probe[request_id] = now + 15
            async with asyncio.timeout(10), self._mcp_session() as session:
                value = await self._request(session, "result", id=request_id)
        else:
            value = await self.rpc("result", id=request_id)
        result = self.mapped(value, request_id)
        if saved and result.status == "accepted" and result.execution_id:
            # The original Lua reply identifies the background task. Its finish
            # may already have been seen and evicted from the bounded native inbox.
            bound = self.ledger.bind_background(request_id, self.task_connection, result.execution_id, result.text)
            if saved["status"] == "unknown" and bound["status"] == "accepted":
                return result
            return PortResult(**bound)
        if result.status not in ("accepted", "unknown"):
            self.ledger.save(request_id, result.status, result.text, result.execution_id)
            self.next_receipt_probe.pop(request_id, None)
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
        self.task_floor = None
        self.finished_ids.clear()
        self.finish_candidates.clear()
        self.finish_outcomes.clear()
        self.latest_finish_at = 0
        try:
            snapshot = await self.rpc("observe")
        except Exception:
            # A missing observation cannot establish which lease created a task.
            # Keep its outcome unknown; the control fence can still operate.
            return
        self.task_floor = snapshot.get("sampledAt")
        self.finished_ids = {row["id"] for row in self._inbox(snapshot) if row.get("type") == "task_finished"}

    def _record_finishes(self, rows):
        if not isinstance(self.task_floor, int):
            return
        finishes = []
        for row in rows:
            if row.get("type") != "task_finished" or type(row.get("at")) is not int or row["at"] <= self.task_floor:
                continue
            self.latest_finish_at = max(self.latest_finish_at, row["at"])
            if row.get("id") in self.finished_ids:
                continue
            for task, tool, status, detail in finished_task_details("<events>" + row["text"] + "</events>"):
                if tool:
                    self.finish_outcomes.setdefault((task, tool), set()).add((status, detail))
                    finishes.append((row["id"], task, tool, status, detail))
        pending = frozenset(self.ledger.pending(self.task_connection))
        if not pending:
            # A finish already seen with no outstanding calls cannot belong to
            # a future request, even if it disappears and reenters the inbox.
            self.task_floor = max(self.task_floor, self.latest_finish_at)
            self.finish_candidates.clear()
            self.finished_ids.clear()
            self.finish_outcomes.clear()
            return
        for event, task, tool, status, detail in finishes:
            eligible = self.finish_candidates.setdefault(event, pending)
            if len(self.finish_outcomes[task, tool]) == 1 and self.ledger.finish(
                    self.task_connection, task, status, detail, tool=tool, eligible=eligible):
                self.finished_ids.add(event)
            elif len(eligible) == 1 and self.ledger.remember_early_finish(
                    next(iter(eligible)), self.task_connection, event, task, tool,
                    "completed" if status == "done" else "failed", detail):
                self.finished_ids.add(event)

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

    async def _retire_walk_waiter(self):
        if self.walk_request:
            task = self.walk_request[2]
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def events(self):
        if self.next_vacancy_probe is not None:
            await self._recheck_vacancy()
            if self.disconnected.is_set():
                return []
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

    def _stop_result(self, request_id):
        saved = self.ledger.get(request_id, self.task_connection)
        if saved["status"] == "unknown" and self.confirmed_initial_fence:
            boot, _, confirmed = self.ledger.stop_fence(request_id)
            if boot != self.boot:
                # A later *acknowledged* paused attach stopped the old actuator
                # even if the process died before learning the original outcome.
                # Only the original pause acknowledgement proves that stop ran.
                if confirmed:
                    status, text = "completed", "Original stop was confirmed; control resumed under a new fence."
                else:
                    status, text = "failed", "Original stop outcome unknown; superseded by a confirmed startup pause. Do not replay."
                self.ledger.save(request_id, status, text, None)
                saved = self.ledger.get(request_id, self.task_connection)
        return PortResult(**saved)

    async def _stop_transition(self, mode):
        async with self.transition_lock:
            if self.lost:
                raise RuntimeError("CONTROL_CHANGED")
            self.epoch += 1
            self.requested_mode = mode
            try:
                reply = await self.rpc("transition", mode=mode)
            except ValueError:
                raise  # a mismatched identity or invalid control reply is not a lost ACK
            except Exception:
                reply = None
            if reply is None:
                # Only heartbeat checks this exact boot *and* epoch. Public facts
                # for a different driver at the same generation are not proof.
                try:
                    reply = await self.rpc("heartbeat")
                except RuntimeError as error:
                    if str(error) != "HOSTED_REQUEST_REFUSED_QUERY_ORIGINAL":
                        raise
                    # A transition that never arrived leaves *our* older fence
                    # in place. A refusal of both generations requires an
                    # independent, read-only vacancy check before reopening.
                    old_epoch = self.epoch - 1
                    try:
                        old = await self.rpc("heartbeat", fence_epoch=old_epoch)
                    except Exception as unverified:
                        if str(unverified) == "HOSTED_REQUEST_REFUSED_QUERY_ORIGINAL":
                            raise
                        raise RuntimeError("CONTROL_CHANGED") from unverified
                    if not self._confirmed(old, self.lease_mode, epoch=old_epoch):
                        raise RuntimeError("CONTROL_CHANGED") from error
                    raise ConnectionError("Original lease still held; transition unconfirmed.") from error
            if not self._confirmed(reply, mode):
                raise RuntimeError("CONTROL_CHANGED")
            self.lease_mode, self.owned_epoch = mode, self.epoch

    async def halt(self, request_id):
        async with self.control_lock:
            if self.stopping.is_set():
                return PortResult("unknown", "Session closed; query the original stop after reconnect.")
            old = self.ledger.get(request_id, self.task_connection)
            if old:
                if old["data"]["fingerprint"] != HOSTED_STOP:
                    return PortResult("rejected", "request_id_conflict; query the original request")
                return self._stop_result(request_id)
            if not self.confirmed_initial_fence:
                return PortResult("rejected", "Hosted control unavailable; stop was not dispatched.")

            self.ledger.begin_stop(request_id, self.boot, self.epoch + 1)
            restored = False
            failure = None
            try:
                await self._stop_transition("paused")
                self.ledger.confirm_stop(request_id)
                # The server already fenced the old actuator. Retire only
                # the local waiter; the original receipt remains queryable.
                await self._retire_walk_waiter()
                with contextlib.suppress(Exception):
                    await self._drain_stopped()
                await self._start_task_window()
                self.task_connection = str(uuid4())
                await self._stop_transition("harness")
                self.ledger.save(request_id, "completed", "Original actuator stopped by server fence.", None)
                restored = True
            except Exception as error:
                # Preserve the last durable phase; never issue another pause.
                failure = error
                return PortResult("unknown", "Stop/control outcome uncertain; reconcile the original request.")
            finally:
                # Includes cancellation between the committed pause and resume.
                # No subsequent write may use an unconfirmed controller.
                if not restored:
                    await self._lose_control(failure)
            return self._stop_result(request_id)

    async def close(self):
        self.closing = True
        if self.heartbeat:
            self.heartbeat.cancel()
            await asyncio.gather(self.heartbeat,return_exceptions=True)
        async with self.control_lock:
            if self.attached and not self.lost:
                try:
                    await self._stop_transition("paused")
                except Exception as error:
                    await self._lose_control(error)
                else:
                    with contextlib.suppress(Exception):
                        await self._drain_stopped()
            self.attached = False
            self.stopping.set()
        await self._retire_walk_waiter()
        if self.connection_task: await asyncio.gather(self.connection_task,return_exceptions=True)
        self.ledger.close()
