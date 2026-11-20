"""Finite real-world checks against an already prepared synthetic loopback fixture.

Requires NativeBodyProbe and RecruitmentProbe test mods. Refuses production worlds.
Fixture JSON contains lab, endpoint, tokenFile, ownerId, maidId and synthetic=true;
credentials are read privately, never included in the report.
"""
from pathlib import Path
import argparse
import json
import math
import socket
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixture',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--expiry-only',action='store_true')
args=parser.parse_args()
fixture=json.loads(args.fixture.read_bytes());lab=Path(fixture['lab'])
assert fixture['synthetic'] is True and (lab/'.native-body-qa').read_text()=='SYNTHETIC_NATIVE_BODY_ONLY'
assert (lab/'.resident-hybrid-qa').read_text()=='SYNTHETIC_RESIDENT_HYBRID_ONLY'
props=dict(x.split('=',1)for x in (lab/'server.properties').read_text().splitlines()if'='in x)
assert props['server-ip']=='127.0.0.1'
url=urllib.parse.urlsplit(fixture['endpoint']);assert url.scheme=='http' and url.hostname=='127.0.0.1' and url.path=='/maid-body'
assert fixture['maidId'].startswith('10000000-') and fixture['ownerId'].startswith('20000000-')
token=Path(fixture['tokenFile']).read_text().strip()
report={'synthetic':True,'productionChanged':False,'startedAt':time.time(),'checks':[],'observations':{}}
args.output.parent.mkdir(parents=True,exist_ok=True)
def check(name,condition,**data):
    report['checks'].append({'name':name,'passed':bool(condition),**data})
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'check':name,'passed':bool(condition)},ensure_ascii=False),flush=True)
    assert condition,name
def command(text):
    def exact(s,n):
        b=b''
        while len(b)<n:
            c=s.recv(n-len(b))
            if not c:raise ConnectionError('RCON closed')
            b+=c
        return b
    def packet(s,i,t,text):
        b=struct.pack('<ii',i,t)+text.encode()+b'\0\0';s.sendall(struct.pack('<i',len(b))+b)
        n=struct.unpack('<i',exact(s,4))[0];b=exact(s,n);return struct.unpack('<ii',b[:8]),b[8:-2].decode()
    with socket.create_connection(('127.0.0.1',int(props['rcon.port'])),timeout=10)as s:
        code,_=packet(s,11,3,props['rcon.password']);assert code[0]==11
        _,answer=packet(s,12,2,text);return answer
def probe(verb,extra=''):
    return json.loads(command(f"bodyportqa {verb} {fixture['maidId']} {extra}".strip()))
def native():return json.loads(command('companiontest body '+fixture['maidId']))
def http(data,auth=token):
    raw=json.dumps(data).encode() if not isinstance(data,bytes) else data
    q=urllib.request.Request(fixture['endpoint'],data=raw,headers={'Authorization':'Bearer '+auth,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(q,timeout=12)as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
class Client:
    def __init__(self):self.env={k:fixture[k] for k in ['ownerId','maidId']};self.env['controllerId']=str(uuid.uuid4())
    def bind(self):
        code,data=http({'operation':'bind',**{k:v for k,v in self.env.items()if k!='generation'}})
        assert code==200,(code,data);self.env['generation']=data['generation'];return data
    def raw(self,action,**kw):
        data={'operation':'call',**self.env,'name':'mc_maids','arguments':{'action':action,**kw}}
        if 'requestId'in kw:data['requestId']=kw['requestId']
        return http(data)
    def call(self,action,**kw):
        code,data=self.raw(action,**kw);assert code==200,(code,data)
        return json.loads(data['result']['content'][0]['text'])
    def release(self):return http({'operation':'release',**self.env})
run=uuid.uuid4().hex[:10]
c=Client();bound=False
def write(action,**fields):return c.call(action,requestId=f'qa-{run}-{action}-{uuid.uuid4().hex[:5]}',**fields)
def settle(request):
    until=time.monotonic()+33
    while True:
        receipt=c.call('receipt',operationId=request)['data']
        if receipt['status'] not in ['running','accepted'] or time.monotonic()>until:return receipt
        time.sleep(.15)
try:
    if args.expiry_only:
        c.bind();bound=True;write('stop');epoch=probe('controller')['epoch']
        time.sleep(122)
        check('real_idle_lease_expires_and_stops_body',not probe('controller')['active'] and native()['sitting'])
        code,error=c.raw('context');check('expired_generation_refused_without_rebind',code==409 and error['code']=='CONTROL_CHANGED')
        check('expiry_invalidates_delayed_callback_epoch',probe('controller')['epoch']>epoch)
    else:
        code,error=http({'operation':'bind',**c.env},'wrong');check('wrong_bearer_rejected',code==401)
        code,error=http(b'\xff');check('malformed_utf8_rejected',code==400 and error['code']=='INVALID_JSON')
        code,error=http(b'x'*16385);check('request_byte_limit_enforced',code==413)
        foreign={**c.env,'ownerId':str(uuid.uuid4())};code,error=http({'operation':'bind',**foreign});check('foreign_owner_cannot_bind',code==403)
        c.bind();bound=True;check('original_owner_offline',json.loads(command('companiontest player-count'))['onlinePlayers']==0)
        original_generation=c.env['generation'];check('same_controller_bind_is_idempotent',c.bind()['generation']==original_generation)
        second=Client();code,error=http({'operation':'bind',**second.env});check('second_controller_busy',code==409 and error['code']=='CONTROL_BUSY')
        write('stop');command(f"companiontest position {fixture['maidId']} 180.5 81 100.5")
        context=c.call('context')['data'];check('brain_projection_consistent',context['physicalController']=='native_body' and context['brain']['physicalController']=='native_body' and context['brain']['readOnly'])
        check('offline_people_are_not_social_targets',context['nearbyPlayers']==[])
        check('stationed_maid_does_not_offer_social_walk',context['socialWalkAvailable'] is False)
        check('equipment_help_does_not_promise_transfer','transfer put' not in c.call('inventory')['data']['nextStep'])
        code,error=c.raw('brain',choice='native');check('brain_query_cannot_mutate_choice',code==400 and error['code']=='UNEXPECTED_FIELD')
        code,error=c.raw('walk',requestId='bad-'+run,x=181,z=100);check('missing_coordinate_diagnosed',code==400 and error['code']=='INVALID_y')
        code,error=c.raw('walk',requestId='alias-'+run,to={'x':181,'y':81,'z':100});check('ambiguous_coordinate_alias_not_guessed',code==400 and error['code']=='UNEXPECTED_FIELD')
        row=write('walk',x=380,y=81,z=100);check('out_of_range_rejection_is_durable',row['status']=='rejected' and row['data']['observation']['reason']=='walk_out_of_range' and not row['data']['goalCompleted'])
        old='legacy-'+run;probe('legacy',old);row=c.call('receipt',operationId=old)['data'];check('legacy_unknown_stays_in_original_namespace',row['namespace']=='legacy' and row['status']=='unknown')
        code,error=c.raw('stop',requestId=old);check('legacy_action_id_not_redispatched',code==409 and error['code']=='REQUEST_CONFLICT_LEGACY_QUERY_ORIGINAL')
        first='pickup-'+run;c.call('pickup',requestId=first,enabled=True);write('pickup',enabled=False);c.call('pickup',requestId=first,enabled=True)
        check('duplicate_write_does_not_restore_old_setting',c.call('context')['data']['pickup'] is False)
        target={'x':186.5,'y':81,'z':100.5};rid='walk-'+run
        row=c.call('walk',requestId=rid,**target);check('walk_admission_does_not_claim_arrival',row['status']=='running' and not row['data']['goalCompleted'])
        check('inflight_navigation_keeps_social_walk_busy',c.call('context')['data']['socialWalkAvailable'] is False)
        done=settle(rid);actual=native()['position'];check('native_walk_reaches_real_world_target',done['status']=='completed' and done['goalCompleted'] and math.dist(actual,[target['x'],target['y'],target['z']])<=.91,actual=actual)
        c.call('walk',requestId=rid,x=186.5,y=81.0,z=100.5);write('stop');check('equivalent_numeric_duplicate_returns_original_result',c.call('receipt',operationId=rid)['data']['observedAt']==done['observedAt'])
        report['observations']['walk']=done
        code,error=c.raw('walk',requestId=rid,x=187.5,y=81,z=100.5);check('changed_target_same_id_refused',code==409 and error['code']=='REQUEST_CONFLICT')
        x,y,z=native()['position'];rid='cancel-'+run;c.call('walk',requestId=rid,x=x+16,y=y,z=z);write('stop');row=c.call('receipt',operationId=rid)['data']
        check('stop_cancels_active_walk_without_claiming_goal',row['status']=='cancelled' and not row['goalCompleted'] and native()['sitting'])
        probe('noai','true');row=write('stop');probe('noai','false');check('stop_not_blocked_by_no_ai',row['status']=='applied')
        command(f"companiontest item-fixture {fixture['maidId']} 0 minecraft:iron_sword 1")
        row=write('equip',hand='main',slot=0);check('equip_moves_real_native_stack',row['status']=='applied' and 'iron_sword'in native()['mainhand'])
        command(f"item replace entity {fixture['maidId']} armor.head with minecraft:iron_helmet[minecraft:enchantments={{levels:{{\"minecraft:binding_curse\":1}}}}]")
        row=write('equip',hand='head',slot=1);check('binding_curse_not_bypassed_without_player',row['status']=='rejected' and row['data']['observation']['reason']=='binding_curse' and 'iron_helmet'in native()['armor'][0])
        original=c.call('context')['data'];probe('owner','20000000-0000-0000-0000-000000000099')
        code,error=c.raw('context');check('actual_owner_change_blocks_state',code==409 and error['code']=='owner_mismatch')
        code,error=c.raw('pickup',requestId='foreign-'+run,enabled=True);check('actual_owner_change_blocks_mutation',code==409 and error['code']=='owner_mismatch')
        probe('owner',fixture['ownerId'])
        check('ownership_rejection_did_not_change_setting',c.call('context')['data']['pickup'] is False)
        probe('takeover','20000000-0000-0000-0000-000000000099');check('foreign_player_cannot_take_control',probe('controller')['active'])
        epoch=probe('controller')['epoch'];probe('takeover',fixture['ownerId']);code,error=c.raw('context')
        check('owner_takeover_invalidates_controller',code==409 and error['code']=='CONTROL_CHANGED' and not probe('controller')['active'] and probe('controller')['epoch']>epoch)
        c=Client();c.bind();check('new_controller_attaches_same_body',c.call('context')['data']['maidId']==fixture['maidId'])
        row=c.call('receipt',operationId=rid)['data'];check('cancelled_result_survives_controller_replacement',row['status']=='cancelled')
finally:
    if bound and not args.expiry_only:
        probe('owner',fixture['ownerId']);probe('noai','false');probe('gui','false')
    if bound:c.release()
    report['finishedAt']=time.time();args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
