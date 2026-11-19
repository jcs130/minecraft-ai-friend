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
