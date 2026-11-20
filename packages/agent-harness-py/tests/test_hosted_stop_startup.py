import asyncio
from types import SimpleNamespace

import pytest

from agent_mc_harness.body.numen import NumenBody
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyAction, Scope
from agent_mc_harness.npc import NpcHost
from test_hosted_mcp import BODY, OWNER, Session, port
from test_hosted_stop import LeaseSession
from test_server_npc import role


class LegacySession(Session):
    async def call_tool(self, tool, args):
        if args["op"] == "result":
            raise FileNotFoundError("Legacy transitions had no server action receipt")
        return await super().call_tool(tool, args)


def test_host_start_retires_only_stop_older_than_confirmed_fence(tmp_path):
    async def run():
        session = LegacySession()
        native = port(tmp_path, session)
        body = NumenBody(native, scope=Scope(realm="qa", account="qa", agent="qa", character=BODY))
        journal = ActionJournal(tmp_path / "dispatch.sqlite")
        host = NpcHost(role(body_id=BODY, character_id=BODY, owner_id=OWNER), body, None, None, journal)
        old_stop = BodyAction(verb="stop", request_id="legacy_stop_0001")
        old_move = BodyAction(verb="move", args={"x": 0, "y": 0, "z": 0}, request_id="legacy_move_0001")
        late_stop = BodyAction(verb="stop", request_id="current_stop_0001")
        journal.begin(BODY, old_stop)
        journal.begin(BODY, old_move)
        # Deliver these through the normal actor startup and reconciliation loop.
        actor = asyncio.create_task(host.run())
        try:
            for _ in range(100):
                if any(a.request_id == old_stop.request_id for a, _ in journal.recent(BODY)):
                    break
                await asyncio.sleep(.01)
            receipts = {a.request_id: r for a, r in journal.recent(BODY)}
            assert old_stop.request_id in receipts, "legacy stop still blocks replanning"
            receipt = receipts[old_stop.request_id]
            assert receipt.status == "failed" and receipt.terminal and not receipt.retry_allowed
            assert receipt.data["historicalOutcome"] == "unknown"
            assert receipt.data["supersededByFence"] == native.confirmed_initial_fence
            assert [a.request_id for a in journal.unresolved(BODY)] == [old_move.request_id]
            body.restore_request(late_stop)
            assert (await body.result(late_stop.request_id)).status == "unknown"
            assert not any(r["op"] == "call" for r in session.calls)
            assert [r["mode"] for r in session.calls if r["op"] == "transition"] == ["harness"]
        finally:
            host.closed = True
            host.wake.set()
            await actor
            await host.close()

    asyncio.run(run())


def test_explicit_reconnect_uses_new_driver_and_original_receipts(tmp_path):
    class ExpiringLease(LeaseSession):
        async def call_tool(self, tool, args):
            if args["op"] == "facts":
                self.calls.append(args)
                self.fenced = False  # The game expires the old pause after its last heartbeat.
                return SimpleNamespace(isError=False, structuredContent={**self.snapshot(), "workPending": False})
            return await super().call_tool(tool, args)

    async def run():
        session = ExpiringLease()
        native = port(tmp_path, session)
        body = NumenBody(native, scope=Scope(realm="qa", account="qa", agent="qa", character=BODY))
        try:
            await body.spawn()
            original = "stop_before_reconnect"
            assert (await native.halt(original)).status == "completed"
            await body.reconnect()
            assert body.health().connected and body.port.boot != native.boot
            assert (await body.port.result(original)).status == "completed"
            assert len([r for r in session.calls if r["op"] == "attach"]) == 2
            assert {r["companion"] for r in session.calls} == {BODY}
            body.port.lost = True
            with pytest.raises(RuntimeError, match="CONTROL_CHANGED"):
                await body.reconnect()
            assert len([r for r in session.calls if r["op"] == "attach"]) == 2
        finally:
            await body.destroy()

    asyncio.run(run())
