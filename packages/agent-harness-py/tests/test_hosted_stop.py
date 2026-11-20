"""Exercise the stop request at the hosted_body lease boundary."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from test_hosted_mcp import BODY, Session, port


class LeaseSession(Session):
    """Model HostedControlLease's boot/epoch checks; facts do not expose boot."""

    def __init__(self):
        super().__init__()
        self.boot = None
        self.epoch = 0
        self.fenced = False
        self.transitions = []
        self.after_commit = None

    def snapshot(self):
        return dict(roleUuid=BODY, mode=self.mode, epoch=self.epoch, fenced=self.fenced)

    async def call_tool(self, tool, args):
        op = args["op"]
        if op not in {"attach", "transition", "heartbeat", "facts", "result"}:
            return await super().call_tool(tool, args)
        self.calls.append(args)
        if op == "result":
            # The native action journal contains calls, never lease transitions.
            return SimpleNamespace(isError=True)
        if op in {"attach", "transition"}:
            if self.boot == args["boot"] and args["epoch"] <= self.epoch:
                return SimpleNamespace(isError=True)
            if self.boot not in {None, args["boot"]} and self.fenced:
                return SimpleNamespace(isError=True)
            self.boot, self.epoch = args["boot"], args["epoch"]
            self.mode = args.get("mode", "paused")
            self.fenced = True
            self.transitions.append((self.mode, self.epoch))
            if self.after_commit:
                self.after_commit(self)
        if op == "heartbeat" and (args["boot"] != self.boot or args["epoch"] != self.epoch or not self.fenced):
            return SimpleNamespace(isError=True)
        return SimpleNamespace(isError=False, structuredContent=self.snapshot())


def test_heartbeat_and_halt_share_a_consistent_generation(tmp_path, monkeypatch, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        paused, release_drain = asyncio.Event(), asyncio.Event()
        allow_heartbeat, heartbeat_woke = asyncio.Event(), asyncio.Event()
        real_sleep = asyncio.sleep

        async def timer(seconds):
            if asyncio.current_task() is p.heartbeat:
                await allow_heartbeat.wait()
                allow_heartbeat.clear()
                heartbeat_woke.set()
            else:
                await real_sleep(seconds)

        async def drain():
            paused.set()
            await release_drain.wait()

        monkeypatch.setattr(asyncio, "sleep", timer)
        monkeypatch.setattr(p, "_drain_stopped", drain)
        await p.open()
        request = asyncio.create_task(p.halt("stop-at-rendezvous"))
        try:
            await asyncio.wait_for(paused.wait(), 2)
            allow_heartbeat.set()
            await asyncio.wait_for(heartbeat_woke.wait(), 2)
            release_drain.set()
            assert (await request).status == "completed"
            assert not p.lost and session.mode == "harness"
            assert session.transitions == [("paused", 1), ("harness", 2), ("paused", 3), ("harness", 4)]
            assert (await p.call("say", {"text": "ready"}, "next-action")).status == "completed"
        finally:
            release_drain.set()
            await asyncio.gather(request, return_exceptions=True)
            await p.close()
    run(check())


def test_heartbeat_reply_in_flight_cannot_invalidate_a_new_generation(tmp_path, monkeypatch, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        sampled, deliver, next_tick = asyncio.Event(), asyncio.Event(), asyncio.Event()
        send = session.call_tool
        sleep = asyncio.sleep

        async def delayed_heartbeat(tool, args):
            snapshot = await send(tool, args)
            if args["op"] == "heartbeat":
                sampled.set()
                await deliver.wait()
            return snapshot

        async def timer(seconds):
            if asyncio.current_task() is p.heartbeat:
                if sampled.is_set():
                    await next_tick.wait()
            else:
                await sleep(seconds)

        monkeypatch.setattr(session, "call_tool", delayed_heartbeat)
        monkeypatch.setattr(asyncio, "sleep", timer)
        await p.open()
        try:
            await asyncio.wait_for(sampled.wait(), 2)
            request = asyncio.create_task(p.halt("stop-after-heartbeat"))
            await sleep(0)
            deliver.set()
            assert (await request).status == "completed"
            await sleep(0)
            assert not p.lost and session.mode == "harness"
            assert (await p.call("say", {"text": "ready"}, "following-action")).status == "completed"
        finally:
            deliver.set()
            await p.close()
    run(check())


def test_slow_native_drain_renews_its_own_paused_lease(tmp_path, monkeypatch, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        paused, renewed, idle = asyncio.Event(), asyncio.Event(), asyncio.Event()
        original_send, sleep = session.call_tool, asyncio.sleep

        async def capture(tool, args):
            reply = await original_send(tool, args)
            if args["op"] == "heartbeat" and session.mode == "paused" and not reply.isError:
                renewed.set()
            return reply

        async def timer(seconds):
            if asyncio.current_task() is p.heartbeat:
                await (idle if renewed.is_set() else paused).wait()
            else:
                await sleep(seconds)

        async def slow_drain():
            paused.set()
            # Advance the fixture to its lease deadline while cleanup is still running.
            try:
                await asyncio.wait_for(renewed.wait(), 1)
            except TimeoutError:
                session.fenced = False

        monkeypatch.setattr(session, "call_tool", capture)
        monkeypatch.setattr(asyncio, "sleep", timer)
        monkeypatch.setattr(p, "_drain_stopped", slow_drain)
        await p.open()
        try:
            result = await p.halt("long-drain")
            assert renewed.is_set() and result.status == "completed"
            assert session.mode == "harness" and not p.lost
        finally:
            await p.close()
    run(check())


@pytest.mark.parametrize("missing_ack", ["paused", "harness"])
def test_lost_transition_ack_reconciles_the_original_stop(tmp_path, missing_ack, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        await p.open()

        def lose_reply(s):
            if s.mode == missing_ack:
                s.after_commit = None
                raise TimeoutError("transition committed before response loss")

        session.after_commit = lose_reply
        try:
            returned = await p.halt("stop-lost-ack")
            if returned.status == "unknown":
                returned = await p.result("stop-lost-ack")
            assert returned.status == "completed"
            assert session.mode == "harness" and not p.lost
            assert (await p.halt("stop-lost-ack")).status == "completed"
            assert (await p.result("stop-lost-ack")).status == "completed"
            assert session.transitions == [("paused", 1), ("harness", 2), ("paused", 3), ("harness", 4)]
        finally:
            await p.close()
    run(check())


def test_duplicate_stop_is_durable_across_reconnect_and_conflicting_calls(tmp_path, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        await p.open()
        try:
            assert (await p.halt("same-stop")).status == "completed"
            assert (await p.call("say", {"text": "x"}, "same-stop")).status == "rejected"
        finally:
            await p.close()
        session.fenced = False  # previous boot's heartbeat lease expired
        q = port(tmp_path, session)
        await q.open()
        transitions = list(session.transitions)
        try:
            assert (await q.result("same-stop")).status == "completed"
            assert (await q.halt("same-stop")).status == "completed"
            assert session.transitions == transitions
            assert not any(c["op"] == "call" and c["id"] == "same-stop" for c in session.calls)
        finally:
            await q.close()
    run(check())


def test_concurrent_duplicate_stop_fences_only_once(tmp_path, monkeypatch, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        await p.open()
        paused, release = asyncio.Event(), asyncio.Event()

        async def drain():
            paused.set()
            await release.wait()

        monkeypatch.setattr(p, "_drain_stopped", drain)
        first = asyncio.create_task(p.halt("same-in-flight"))
        try:
            await asyncio.wait_for(paused.wait(), 2)
            second = asyncio.create_task(p.halt("same-in-flight"))
            await asyncio.sleep(0)
            release.set()
            receipts = await asyncio.gather(first, second)
            assert receipts[0].status == "completed"
            assert (await p.result("same-in-flight")).status == "completed"
            assert session.transitions == [("paused", 1), ("harness", 2), ("paused", 3), ("harness", 4)]
        finally:
            release.set()
            await p.close()
    run(check())


def test_original_normal_action_cannot_be_reused_as_a_stop(tmp_path, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        await p.open()
        try:
            assert (await p.call("say", {"text": "ready"}, "original-speech")).status == "completed"
            before = list(session.transitions)
            assert (await p.halt("original-speech")).status == "rejected"
            assert session.transitions == before
        finally:
            await p.close()
    run(check())


@pytest.mark.parametrize("crash_after_pause_ack", [False, True])
def test_crashed_stop_is_not_replayed_in_the_new_driver(tmp_path, monkeypatch, crash_after_pause_ack, run):
    async def check():
        session = LeaseSession()
        old = port(tmp_path, session)
        await old.open()
        original_send = session.call_tool

        async def crash():
            raise asyncio.CancelledError()

        async def crash_before_send(tool, args):
            if args["op"] == "transition" and args["mode"] == "paused":
                await crash()
            return await original_send(tool, args)

        if crash_after_pause_ack:
            monkeypatch.setattr(old, "_start_task_window", crash)
        else:
            monkeypatch.setattr(session, "call_tool", crash_before_send)
        try:
            with pytest.raises(asyncio.CancelledError):
                await old.halt("stop-before-restart")
        finally:
            # An abrupt process exit has no graceful close/transition.
            old.heartbeat.cancel()
            await asyncio.gather(old.heartbeat, return_exceptions=True)
            old.ledger.close()
            monkeypatch.setattr(session, "call_tool", original_send)
        session.fenced = False
        new = port(tmp_path, session)
        await new.open()
        try:
            before = list(session.transitions)
            result = await new.result("stop-before-restart")
            if crash_after_pause_ack:
                assert result.status == "completed"
            else:
                assert result.status == "failed" and "supersed" in result.text.lower()
            assert (await new.halt("stop-before-restart")).status == result.status
            assert session.transitions == before
        finally:
            await new.close()
    run(check())


@pytest.mark.parametrize("foreign_mode", ["paused", "manual"])
def test_matching_epoch_on_another_boot_never_authorizes_stop_resume(tmp_path, foreign_mode, run):
    async def check():
        session = LeaseSession()
        p = port(tmp_path, session)
        await p.open()

        def lost_lease(s):
            s.after_commit = None
            s.boot = "foreign-boot"
            s.mode = foreign_mode
            raise TimeoutError("response lost; another controller now owns the body")

        session.after_commit = lost_lease
        try:
            stop = await p.halt("lost-to-another-driver")
            assert stop.status in {"unknown", "rejected", "failed"}
            assert (await p.result("lost-to-another-driver")).status != "completed"
            assert not p.disconnected.is_set()
            assert session.mode == foreign_mode and session.boot == "foreign-boot"
            assert len([c for c in session.calls if c["op"] == "transition" and c["mode"] == "harness"]) == 1
            assert (await p.call("say", {"text": "x"}, "after-ownership-loss")).status == "rejected"
            assert not any(c["op"] == "call" for c in session.calls)
        finally:
            await p.close()
    run(check())


@pytest.mark.parametrize("failure", ["heartbeat", "stop"])
@pytest.mark.parametrize("facts_case,reconnect", [
    ("expired", True), ("server-restart", True), ("unknown-generation", False),
    ("manual-driver", False), ("work-pending", False), ("missing-facts", False),
])
def test_lease_expiry_needs_idle_body_evidence_before_reconnect(
        tmp_path, monkeypatch, run, failure, facts_case, reconnect):
    async def check():
        s = LeaseSession()
        p = port(tmp_path, s)
        tick = asyncio.Event()
        real_sleep = asyncio.sleep
        original_call = s.call_tool

        async def timer(seconds):
            if asyncio.current_task() is p.heartbeat:
                await tick.wait()
            else:
                await real_sleep(seconds)

        def expire():
            s.mode = "manual" if facts_case == "manual-driver" else "paused"
            s.fenced = facts_case == "manual-driver"
            if s.fenced:
                s.boot = "someone-else"
            if facts_case == "server-restart":
                s.epoch = 0
            if facts_case == "unknown-generation":
                s.epoch += 19

        def expire_before_ack(_):
            s.after_commit = None
            expire()
            raise TimeoutError("long server stall during transition")

        async def with_facts(tool, args):
            if args["op"] == "facts":
                if facts_case == "missing-facts":
                    raise TimeoutError("body facts inaccessible")
                return SimpleNamespace(isError=False, structuredContent=s.snapshot() | {
                    "workPending": facts_case == "work-pending", "ready": True,
                })
            return await original_call(tool, args)

        @asynccontextmanager
        async def fresh():
            async def read(tool, args):
                assert args["op"] == "facts"
                return await with_facts(tool, args)
            yield SimpleNamespace(call_tool=read)

        monkeypatch.setattr(asyncio, "sleep", timer)
        monkeypatch.setattr(s, "call_tool", with_facts)
        monkeypatch.setattr(p, "_mcp_session", fresh)
        await p.open()
        try:
            if failure == "heartbeat":
                expire()
                tick.set()
                await asyncio.wait_for(p.heartbeat, 1)
            else:
                s.after_commit = expire_before_ack
                assert (await p.halt("stop-at-expiry")).status == "unknown"
            assert p.lost and p.disconnected.is_set() == reconnect
            expected = [("paused", 1), ("harness", 2)]
            assert s.transitions == (expected if failure == "heartbeat" else expected + [("paused", 3)])
        finally:
            await p.close()
    run(check())
