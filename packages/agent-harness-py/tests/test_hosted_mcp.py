import asyncio
import json
from types import SimpleNamespace

import pytest

from agent_mc_harness.body.hosted_mcp import HostedMcpPort

BODY="10000000-0000-0000-0000-000000000011"
OWNER="20000000-0000-0000-0000-000000000021"

class Session:
    def __init__(self): self.calls=[];self.mode="paused"
    async def call_tool(self,tool,args):
        assert tool=="hosted_body"
        assert args['companion']==BODY and args['expectedOwner']==OWNER
        self.calls.append(args)
        op=args['op']
        if op=='capabilities': value=dict(protocol='qiandengji-hosted-body/v1',stableIdentity=True,serverFence=True,persistedReceipts=True)
        elif op=='catalog': value=dict(tools=[dict(name='lua'),dict(name='say')])
        elif op in ('attach','transition','heartbeat'):
            if op!='heartbeat': self.mode='paused'if op=='attach'else args['mode']
            value=dict(roleUuid=BODY,epoch=args['epoch'],fenced=True,mode=self.mode)
        elif op=='call': value=dict(id=args['id'],state='partial',message=json.dumps(dict(success=True,message='ok · 1 call · 0 s\nreturned: true')))
        elif op=='result': value=dict(id=args['id'],state='completed',message='original result')
        elif op=='facts': value=dict(roleUuid=BODY,health=23,maxHealth=30,food=18,position=[1,64,2],dimension='minecraft:overworld')
        elif op=='battlefield': value=dict(battlefield=None)
        elif op=='observe': value=dict(text='Native inbox snapshot (newest first, read-only, 1/1 pending): '+json.dumps([dict(id='event1',type='talk',at=1,text='hello')]))
        return SimpleNamespace(isError=False,structuredContent=value)

def port(tmp_path,session):
    return HostedMcpPort(dict(endpoint='http://127.0.0.1:1/mcp',bodyId=BODY,ownerId=OWNER,name='QaKirito',serverId='qa',journalDirectory=str(tmp_path)),session=session)

def test_slow_hosted_walk_yields_to_speech_and_reconciles_original_id(tmp_path, monkeypatch):
    from agent_mc_harness import Scope
    from agent_mc_harness.body.numen import NumenBody
    from agent_mc_harness.models import BodyAction

    async def run():
        dispatched = asyncio.Event()
        finish = asyncio.Event()

        class WalkingSession(Session):
            async def call_tool(self, tool, args):
                if args["op"] == "call":
                    self.calls.append(args)
                    if args["tool"] == "say":
                        message = "Speech dispatched; it is not evidence of a reply."
                        state, success = "partial", True
                    else:
                        assert args["args"]["code"] == "return numen_hosted.move.walk({x=3,y=60,z=7})"
                        dispatched.set()
                        await finish.wait()
                        message = "no_path; stood at (2, 64, 2)"
                        state, success = "blocked", False
                    return SimpleNamespace(isError=False, structuredContent=dict(
                        id=args["id"], state=state, message=json.dumps(dict(success=success, message=message))))
                return await super().call_tool(tool, args)

        session = WalkingSession()
        adapter = port(tmp_path, session)
        body = NumenBody(adapter, scope=Scope(realm="isolation", account="owner", agent="companion"), poll_seconds=60)
        await body.spawn()
        move = BodyAction(verb="move", args={"x": 3, "y": 60, "z": 7}, request_id="first-walk")
        try:
            async with asyncio.timeout(3):
                accepted = await body.act(move)
                assert dispatched.is_set() and accepted.status == "accepted" and not accepted.terminal
                assert accepted.data["targetReached"] is False
                assert (await body.result(move.request_id)).status == "accepted"
                assert (await body.act(move)).status == "accepted"
                repeat = move.model_copy(update={"request_id": "second-walk"})
                blocked = await body.act(repeat)
                assert blocked.status == "rejected" and blocked.data["originalRequestId"] == move.request_id
                voice = await body.act(BodyAction(verb="chat", name="svc", args={"text": "我去找楼梯。"}, request_id="say-nearby"))
                assert voice.status == "completed" and "Speech dispatched" in voice.text
                assert not finish.is_set()
                finish.set()
                await adapter.walk_request[2]
                settled = await body.result(move.request_id)
                assert settled.terminal and settled.status == "rejected" and "no_path" in settled.text
                assert [row["id"] for row in session.calls if row["op"] == "call"] == ["first-walk", "say-nearby"]
        finally:
            finish.set()
            await body.destroy()

    monkeypatch.setattr("agent_mc_harness.body.hosted_mcp.WALK_INLINE_SECONDS", 0.01)
    asyncio.run(run())

def test_stop_releases_the_inline_walk_waiter_without_replaying(tmp_path):
    async def run():
        dispatched = asyncio.Event()
        stopped = asyncio.Event()

        class WalkingSession(Session):
            async def call_tool(self, tool, args):
                if args["op"] == "call":
                    self.calls.append(args)
                    dispatched.set()
                    await asyncio.Future()
                if args["op"] == "transition" and args["mode"] == "paused":
                    stopped.set()
                if args["op"] == "result":
                    assert stopped.is_set()
                    self.calls.append(args)
                    return SimpleNamespace(isError=False, structuredContent={
                        "id": args["id"], "state": "cancelled", "message": "stopped at the original position",
                    })
                return await super().call_tool(tool, args)

        session = WalkingSession()
        adapter = port(tmp_path, session)
        await adapter.open()
        try:
            async with asyncio.timeout(3):
                move = asyncio.create_task(adapter.start_walk("walk()", "first-walk"))
                await dispatched.wait()
                assert (await adapter.halt("stop-walk")).status == "completed"
                assert (await move).status == "unknown"
                assert (await adapter.result("first-walk")).status == "rejected"
                assert [row["id"] for row in session.calls if row["op"] == "call"] == ["first-walk"]
        finally:
            await adapter.close()

    asyncio.run(run())

def test_hosted_leases_and_original_receipts(tmp_path):
    async def run():
        session=Session();p=port(tmp_path,session)
        try:
            assert(await p.open())['uuid']==BODY
            a=await p.call('lua',{'code':'return true'},'original_request_1')
            assert a.status=='completed'
            again=await p.call('lua',{'code':'return true'},'original_request_1')
            assert again.status=='completed'
            assert(await p.call('lua',{'code':'return false'},'original_request_1')).status=='rejected'
            assert sum(r['op']=='call'for r in session.calls)==1
            assert(await p.observe()).data['facts']['health']==23
            assert len(await p.events())==1 and await p.events()==[]
            assert (await p.halt('halt_request')).status=='completed'
        finally:await p.close()
        assert session.mode=='paused'
        assert [c['epoch']for c in session.calls if c['op']in('attach','transition')]==[1,2,3,4,5]
    asyncio.run(run())

def test_lost_session_reads_the_original_blocked_move_without_taking_control(tmp_path, monkeypatch):
    from contextlib import asynccontextmanager

    async def run():
        session = Session()
        p = port(tmp_path, session)
        await p.open()
        rid = "interrupted-walk"
        original = session.call_tool

        async def broken(tool, args):
            session.calls.append(args)
            raise ConnectionError("original transport closed")

        session.call_tool = broken
        try:
            assert (await p.call("lua", {"code": "walk()"}, rid)).status == "unknown"
            p.lost = True
            fresh_calls = []
            reply_id = "other-request"

            async def read(tool, args):
                fresh_calls.append(args)
                assert args["op"] == "result" and args["id"] == rid
                value = dict(id=reply_id, state="blocked", message=json.dumps(
                    dict(success=False, message="this turn was cut off: EXTERNAL; nothing else ran")))
                return SimpleNamespace(isError=False, structuredContent=value)

            @asynccontextmanager
            async def fresh():
                yield SimpleNamespace(call_tool=read)

            monkeypatch.setattr(p, "_mcp_session", fresh)
            with pytest.raises(ValueError, match="original_request_mismatch"):
                await p.result(rid)
            assert (await p.result(rid)).status == "unknown" and len(fresh_calls) == 1
            p.next_receipt_probe[rid] = 0
            reply_id = rid
            result = await p.result(rid)
            assert result.status == "rejected" and "earlier steps may already have run" in result.text
            assert "nothing else ran" not in result.text and result.data["retryAllowed"] is False
            assert (await p.result(rid)).status == "rejected" and len(fresh_calls) == 2
            assert fresh_calls[0]["boot"] == p.boot and fresh_calls[0]["epoch"] == p.epoch
            fresh_write = await p.call("lua", {"code": "walk()"}, "new-after-fence")
            assert fresh_write.status == "rejected" and not p.recorded("new-after-fence")
            assert sum(c["op"] == "call" for c in session.calls) == 1 and p.lost
        finally:
            session.call_tool = original
            await p.close()
    asyncio.run(run())


def test_lost_hosted_lease_is_not_reported_as_a_ready_body(tmp_path):
    from agent_mc_harness import Scope
    from agent_mc_harness.body.numen import NumenBody

    async def run():
        p = port(tmp_path, Session())
        body = NumenBody(p, scope=Scope(realm="isolation", account="owner", agent="companion"), poll_seconds=60)
        try:
            await body.spawn()
            assert body.health().connected
            p.lost = True
            assert not body.health().connected and body.health().lifecycle == "error"
        finally:
            await body.destroy()
        assert body.health().lifecycle == "destroyed"
    asyncio.run(run())


def test_hosted_partial_envelope_is_not_automatic_success(tmp_path):
    p=port(tmp_path,Session())
    try:
        assert p.mapped(dict(id='x',state='partial',message='still running'),'x','lua').status=='unknown'
        assert p.mapped(dict(id='x', state='partial', message='Speech dispatched; it is not evidence of a reply.'),
                        'x').status == 'unknown'
        pending='The script stopped at line 1 (numen_hosted.fight.attack) because of an event; t7 keeps running.'
        receipt=p.mapped(dict(id='x',state='partial',message=json.dumps(dict(success=False,message=pending))),'x','lua')
        assert receipt.status=='accepted' and receipt.execution_id=='t7'
        combat = "The script stopped at line 1 (numen_hosted.fight.attack) after 2 calls: an urgent targeted event arrived; t8 keeps running. Nothing after that ran."
        for message, status in [(combat, "accepted"), ("denied by permission", "rejected")]:
            returned = p.mapped(dict(id='x', state='blocked', message=json.dumps(dict(success=False, message=message))), 'x', 'lua')
            assert returned.status == status
        assert p.mapped(dict(id='x', state='cancelled', message=combat), 'x', 'lua').status == "rejected"
        with pytest.raises(ValueError):p.mapped(dict(id='another',state='completed'),'x')
    finally:p.ledger.close()

def test_hosted_unknown_is_never_resubmitted(tmp_path):
    async def run():
        session=Session();p=port(tmp_path,session)
        await p.open()
        original=session.call_tool
        async def lost(tool,args):
            if args['op']=='call':raise TimeoutError()
            return await original(tool,args)
        session.call_tool=lost
        try:
            assert(await p.call('say',{'text':'test'},'original_unknown')).status=='unknown'
            session.call_tool=original
            assert(await p.call('say',{'text':'test'},'original_unknown')).status=='unknown'
            assert not any(r['op']=='call'for r in session.calls)
            assert(await p.result('original_unknown')).status=='completed'
        finally:await p.close()
    asyncio.run(run())


def test_hosted_say_recovers_persisted_partial_receipt_after_controller_restart(tmp_path):
    class SpeechSession(Session):
        sent = "Speech dispatched; it is not evidence of a reply."

        async def call_tool(self, tool, args):
            if args["op"] == "call":
                self.calls.append(args)
                raise ConnectionError("connection lost after dispatch")
            if args["op"] == "result":
                self.calls.append(args)
                message = self.sent if args["id"] == "speech" else "Action is incomplete."
                receipt = dict(id=args["id"], state="partial", message=json.dumps(dict(success=True, message=message)))
                return SimpleNamespace(isError=False, structuredContent=receipt)
            return await super().call_tool(tool, args)

    async def run():
        original = SpeechSession()
        first = port(tmp_path, original)
        try:
            assert (await first.call("say", {"text": "Hello"}, "speech")).status == "unknown"
        finally:
            await first.close()

        reconnect = SpeechSession()
        restored = port(tmp_path, reconnect)
        try:
            result = await restored.result("speech")
            assert result.status == "completed" and result.text == SpeechSession.sent
            assert (await restored.result("speech")).status == "completed"
            assert (await restored.result("ambiguous-partial")).status == "unknown"
            assert [(c["op"], c["id"]) for c in reconnect.calls] == [
                ("result", "speech"), ("result", "ambiguous-partial")]
            assert [c["op"] for c in original.calls] == ["call"]
        finally:
            await restored.close()

    asyncio.run(run())


class WalkingSession(Session):
    launch = "The script stopped at line 1 (numen_hosted.move.walk) after 1 call; t3 keeps running."
    tool = "numen_hosted.move.walk"

    def __init__(self):
        super().__init__()
        self.rows = []
        self.clock = 100
        self.dispatched = False
        self.drop_call_reply = False
        self.stop_on_pause = True

    def finish(self, key, tool, status, at):
        self.rows.insert(0, dict(id=key, type="task_finished", at=at,
            text=f'<event kind="task_finished" id="t3" task="{tool}" status="{status}">{status} walk</event>'))

    async def call_tool(self, tool, args):
        op = args["op"]
        if op == "transition" and args["mode"] == "paused" and self.dispatched and self.stop_on_pause:
            self.clock += 1
            self.finish("stop-" + str(self.clock), self.tool, "stopped", self.clock)
        if op not in {"observe", "call", "result"}:
            return await super().call_tool(tool, args)
        self.calls.append(args)
        if op == "observe":
            value = dict(sampledAt=self.clock, text="Native inbox snapshot: " + json.dumps(self.rows))
        else:
            if op == "call":
                self.dispatched = True
                if self.drop_call_reply:
                    raise TimeoutError()
            value = dict(id=args["id"], state="blocked", message=json.dumps(dict(success=False, message=self.launch)))
        return SimpleNamespace(isError=False, structuredContent=value)


@pytest.mark.parametrize("reopen", [False, True])
def test_original_lost_attack_reply_reconciles_an_evicted_finish(tmp_path, reopen):
    async def run():
        game = WalkingSession()
        game.tool = "numen_hosted.fight.attack"
        game.launch = "The script stopped at line 1 (numen_hosted.fight.attack) after 2 calls; t3 keeps running."
        game.drop_call_reply = True
        p = port(tmp_path, game)
        await p.open()
        try:
            assert (await p.call("lua", {"code": "attack()"}, "actual_attack")).status == "unknown"
            game.finish("early", game.tool, "stopped", 105)
            await p.events()
            game.rows.clear()  # The native inbox only presents its newest entries.
            if reopen:
                p.lost = True
                await p.close()
                p = port(tmp_path, game)
                await p.open()
            outcome = await p.result("actual_attack")
            assert (outcome.status, outcome.execution_id, outcome.text) == ("failed", "t3", "stopped walk")
            assert (await p.result("actual_attack")).status == "failed"
            assert sum(c["op"] == "call" for c in game.calls) == 1
        finally:
            await p.close()
    asyncio.run(run())


@pytest.mark.parametrize("unrelated", ["before_window", "wrong_tool", "wrong_task", "ambiguous", "concurrent"])
def test_early_finish_needs_one_original_request_and_exact_native_match(tmp_path, unrelated):
    async def run():
        game = WalkingSession()
        game.drop_call_reply = True
        p = port(tmp_path, game)
        await p.open()
        try:
            await p.call("lua", {"code": "walk()"}, "real_walk")
            if unrelated == "concurrent":
                await p.call("lua", {"code": "another_walk()"}, "concurrent_walk")
            game.finish("first", "numen_hosted.fight.attack" if unrelated == "wrong_tool" else game.tool,
                        "done", 99 if unrelated == "before_window" else 105)
            if unrelated == "wrong_task":
                game.rows[0]["text"] = game.rows[0]["text"].replace('id="t3"', 'id="t4"')
            if unrelated == "ambiguous":
                game.finish("different-event", game.tool, "stopped", 106)
            await p.events()
            game.rows.clear()
            p.lost = True
            await p.close()
            p = port(tmp_path, game)
            await p.open()
            assert (await p.result("real_walk")).status == "unknown"
            assert sum(c["op"] == "call" for c in game.calls) == (2 if unrelated == "concurrent" else 1)
        finally:
            await p.close()
    asyncio.run(run())


def test_ambiguous_early_finish_can_still_be_read_after_the_original_launch_is_bound(tmp_path):
    async def run():
        game = WalkingSession()
        game.drop_call_reply = True
        p = port(tmp_path, game)
        await p.open()
        try:
            await p.call("lua", {"code": "walk()"}, "real_walk")
            await p.call("lua", {"code": "guide()"}, "other_read")
            game.finish("early", game.tool, "done", 105)
            await p.events()
            assert (await p.result("real_walk")).status == "accepted"
            await p.events()
            assert (await p.result("real_walk")).status == "completed"
        finally:
            await p.close()
    asyncio.run(run())


def test_a_pre_dispatch_event_cannot_be_adopted_by_a_later_original(tmp_path):
    async def run():
        game = WalkingSession()
        game.drop_call_reply = True
        p = port(tmp_path, game)
        await p.open()
        try:
            game.finish("prior", game.tool, "done", 105)
            await p.events()
            saved = game.rows.pop()
            await p.events()
            await p.call("lua", {"code": "walk()"}, "later_walk")
            assert (await p.result("later_walk")).status == "accepted"
            game.rows.append(saved)
            await p.events()
            assert (await p.result("later_walk")).status == "accepted"
        finally:
            await p.close()
    asyncio.run(run())


@pytest.mark.parametrize("drop_reply", [True, False])
def test_contradictory_finishes_in_one_native_snapshot_do_not_settle_a_call(tmp_path, drop_reply):
    async def run():
        game = WalkingSession()
        game.drop_call_reply = drop_reply
        p = port(tmp_path, game)
        await p.open()
        try:
            await p.call("lua", {"code": "walk()"}, "conflicting_walk")
            game.finish("one", game.tool, "done", 105)
            game.finish("two", game.tool, "stopped", 106)
            await p.events()
            game.rows.pop()
            await p.events()
            assert (await p.result("conflicting_walk")).status in ("accepted", "unknown")
        finally:
            await p.close()
    asyncio.run(run())


@pytest.mark.parametrize("drop_reply", [False, True])
def test_pause_reconciles_original_walk_including_lost_launch_reply(tmp_path, drop_reply):
    async def run():
        session = WalkingSession()
        session.drop_call_reply = drop_reply
        p = port(tmp_path, session)
        await p.open()
        assert (await p.call("lua", {"code":"walk()"}, "original_walk")).status == ("unknown" if drop_reply else "accepted")
        await p.close()
        q = port(tmp_path, session)
        try:
            await q.open()
            result = await q.result("original_walk")
            assert (result.status, result.execution_id, result.text) == ("failed", "t3", "stopped walk")
            assert (await q.call("lua", {"code":"walk()"}, "original_walk")).status == "failed"
            assert sum(c["op"] == "call" for c in session.calls) == 1
        finally:
            await q.close()
    asyncio.run(run())


def test_reused_task_numbers_old_or_wrong_events_do_not_complete_walk(tmp_path):
    async def run():
        session = WalkingSession()
        session.finish("old", session.tool, "done", 98)
        p = port(tmp_path, session)
        await p.open()
        try:
            await p.call("lua", {"code":"walk()"}, "new_walk")
            # A pre-attach event can enter the bounded inbox snapshot late.
            session.finish("old-late", session.tool, "done", 99)
            session.finish("other-tool", "numen_hosted.fight.attack", "done", 103)
            await p.events()
            assert (await p.result("new_walk")).status == "accepted"
            session.finish("new", session.tool, "stopped", 104)
            await p.events()
            assert (await p.result("new_walk")).status == "failed"
        finally:
            await p.close()
    asyncio.run(run())


def test_unavailable_inbox_during_halt_does_not_strand_control_or_invent_a_result(tmp_path):
    async def run():
        session = WalkingSession()
        p = port(tmp_path, session)
        await p.open()
        await p.call("lua", {"code":"first()"}, "lost_walk")
        original = session.call_tool
        async def unavailable(tool, args):
            if args["op"] == "observe": raise TimeoutError()
            return await original(tool, args)
        session.call_tool = unavailable
        try:
            assert (await p.halt("halt")).status == "completed" and session.mode == "harness"
            assert (await p.result("lost_walk")).status == "unknown"
            assert sum(c["op"] == "call" for c in session.calls) == 1
        finally:
            await p.close()
    asyncio.run(run())


def test_unproven_previous_connection_is_not_settled_by_reused_number(tmp_path):
    async def run():
        session = WalkingSession()
        old = port(tmp_path, session)
        await old.open()
        await old.call("lua", {"code":"first()"}, "lost_walk")
        old.lost = True  # No game-acknowledged pause or original terminal event.
        await old.close()
        new = port(tmp_path, session)
        await new.open()
        try:
            await new.call("lua", {"code":"second()"}, "current_walk")
            session.finish("new", session.tool, "done", 108)
            await new.events()
            assert (await new.result("current_walk")).status == "completed"
            assert (await new.result("lost_walk")).status == "unknown"
            assert sum(c["op"] == "call" for c in session.calls) == 2
        finally:
            await new.close()
    asyncio.run(run())
