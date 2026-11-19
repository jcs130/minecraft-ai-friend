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

def test_hosted_partial_envelope_is_not_automatic_success(tmp_path):
    p=port(tmp_path,Session())
    try:
        assert p.mapped(dict(id='x',state='partial',message='still running'),'x','lua').status=='unknown'
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
