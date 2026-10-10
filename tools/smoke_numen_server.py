"""Finite isolated real-NeoForge server-only Numen contract test; zero paid model requests."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import threading
import time
import uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from build_numen_server import NAME
from build_society_bridge import NUMEN_NAME
from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, REPO

def offline(name):
    value = bytearray(hashlib.md5(('OfflinePlayer:'+name).encode()).digest())
    value[6] = value[6] & 15 | 48
    value[8] = value[8] & 63 | 128
    return str(uuid.UUID(bytes=bytes(value)))

def run(root, output, node, java, full_pack=False):
    output = output.resolve()
    if (root/'research').resolve() not in output.parents or output.exists():
        raise ValueError('Use a new evidence directory inside runtime/research')
    for port in (28978, 28990, 28991, *([28979] if full_pack else [])):
        with socket.socket() as s: s.bind(('127.0.0.1', port))
    output.mkdir(parents=True)
    server = output/'server';mods=server/'mods';mods.mkdir(parents=True)
    for p in (root/'server/mods').glob('*.jar'):
        if full_pack or p.name in (NUMEN_NAME,'maw_numen_compat-0.1.0.jar'):
            shutil.copyfile(p,mods/p.name)
    shutil.copyfile(root/'build/numen-server'/NAME,mods/NAME)
    shutil.copyfile(root/'server/eula.txt',server/'eula.txt')
    props = {'server-ip':'127.0.0.1','server-port':'28978','online-mode':'false','enforce-secure-profile':'false','enable-rcon':'false','enable-query':'false','max-players':'12','spawn-protection':'0','view-distance':'3','simulation-distance':'3','difficulty':'peaceful','gamemode':'survival','level-name':'world-server-numen','level-type':'minecraft:flat','generator-settings':json.dumps({'layers':[{'block':'minecraft:bedrock','height':1},{'block':'minecraft:dirt','height':2},{'block':'minecraft:grass_block','height':1}],'biome':'minecraft:plains','features':False,'lakes':False,'structure_overrides':[]},separators=(',',':')),'level-seed':'1010','spawn-monsters':'false','motd':'Isolated headless Numen QA'}
    (server/'server.properties').write_text(''.join(f'{k}={v}\n' for k,v in props.items()),encoding='utf-8')
    args=(root/'server/libraries/net/neoforged/neoforge/21.1.248/win_args.txt').read_text('utf-8')
    args=args.replace('libraries/',(root/'server/libraries').as_posix()+'/').replace('-DlibraryDirectory=libraries','-DlibraryDirectory='+(root/'server/libraries').as_posix())
    (server/'qa-args.txt').write_text(args,encoding='utf-8')
    owner,other=offline('MawHeadQAOwner'),offline('MawHeadQAOther');bearer,other_token,bridge=secrets.token_hex(32),secrets.token_hex(32),secrets.token_hex(32)
    private=server/'config/maw-numen-private';private.mkdir(parents=True)
    (private/'accounts.json').write_text(json.dumps({'accounts':[{'ownerUuid':o,'tokenHash':hashlib.sha256(t.encode()).hexdigest()} for o,t in ((owner,bearer),(other,other_token))]}),encoding='utf-8')
    (private/'bridge.json').write_text(json.dumps({'secret':bridge}),encoding='utf-8')
    cfg={'enabled':True,'bind':'127.0.0.1','port':28990,'allowedHosts':['127.0.0.1:28990'],'publicEndpoint':'http://127.0.0.1:28990/mcp','allowedModelHosts':[],'testOnlyAllowLoopbackModels':True,'dailyModelCallsPerBody':12}
    (server/'config/maw-numen-server.json').write_text(json.dumps(cfg),encoding='utf-8')
    report={'schemaVersion':1,'fullPack':full_pack,'productionWorldActions':0,'paidModelRequests':0,'actualPhoneTested':False,'checks':{},'serverExitCodes':[],'ok':False};checks=report['checks']
    process=None;reader=None;client=None;gate=None;lines=[];mock_calls=[]
    def request(path,data=None,headers=None):
        req=Request('http://127.0.0.1:28990'+path, None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with urlopen(req,timeout=15) as res:return res.status,json.load(res)
        except HTTPError as e:return e.code,json.load(e)
    counter=0
    def rpc(method,params=None,token=bearer):
        nonlocal counter
        counter+=1;status,response=request('/mcp',{'jsonrpc':'2.0','id':counter,'method':method,'params':params or {}},{'Authorization':'Bearer '+token})
        assert status==200,(status,response)
        return response['result']
    def tool(name,args=None,token=bearer):
        value=rpc('tools/call',{'name':name,'arguments':args or {}},token)['structuredContent']
        return value
    def ui(action,args=None):
        status,res=request('/ui',{'ownerUuid':owner,'playerName':'MawHeadQAOwner','action':action,'arguments':args or {}},{'X-Maw-Bridge':bridge});assert status==200,(status,res);return res
    def start(label):
        nonlocal process,reader,lines,gate
        ready=threading.Event();lines=[]
        process=subprocess.Popen([str(java),'-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8','-Xms256m','-Xmx'+('2048m' if full_pack else '1024m'),'@qa-args.txt','nogui'],cwd=server,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        def capture():
            with (output/(label+'-server.log')).open('w',encoding='utf-8') as f:
                for line in process.stdout:
                    lines.append(line);f.write(line);f.flush()
                    if 'MAW_NUMEN_SERVER ready' in line:ready.set()
        reader=threading.Thread(target=capture,daemon=True);reader.start();deadline=time.monotonic()+200
        while not ready.is_set() and process.poll() is None and time.monotonic()<deadline:time.sleep(.2)
        assert ready.is_set(),'server not ready; inspect preserved log'
        if full_pack:
            main=json.loads((root/'services/service.json').read_text('utf-8'));original=next(row for row in main['services'] if row['id']=='gate')
            env={**os.environ,**original['env'],'GATE_LISTEN_HOST':'127.0.0.1','GATE_CACHE_FILE':str(output/'gate-cache.json'),'GATE_FAILURE_CAPTURE_FILE':str(output/'gate-failures.jsonl')};env.pop('GATE_LAN_SUBNET',None)
            gate=subprocess.Popen([str(node),str(REPO/'world/src/neoforge-handshake/gate.cjs'),'28979','127.0.0.1','28978'],cwd=REPO,env=env,stdin=subprocess.PIPE,stdout=(output/(label+'-gate.log')).open('w'),stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            deadline=time.monotonic()+30
            while time.monotonic()<deadline:
                try:
                    with socket.create_connection(('127.0.0.1',28979),timeout=1):break
                except OSError:time.sleep(.2)
            else:raise RuntimeError('isolated gateway unavailable')
    def console(command):process.stdin.write(command+'\n');process.stdin.flush()
    def stop():
        nonlocal process,gate
        if gate and gate.poll() is None:gate.stdin.write(b'{"kind":"shutdown"}\n');gate.stdin.flush();gate.wait(timeout=20)
        if gate:report.setdefault('gateExitCodes',[]).append(gate.returncode);gate=None
        if process and process.poll() is None:console('stop');process.wait(timeout=80)
        if process:report['serverExitCodes'].append(process.returncode)
        if reader:reader.join(timeout=5)
        process=None
    def terminal(aid):
        deadline=time.monotonic()+40
        while time.monotonic()<deadline:
            record=tool('action_status',{'companion':body,'action_id':aid})
            if record.get('phase') in ('terminal','unknown'):return record
            time.sleep(.2)
        raise TimeoutError('action not terminal; do not retry')
    class Mock(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])));mock_calls.append({'model':payload.get('model'),'hasAuth':self.headers.get('Authorization')=='Bearer qa-secret-not-real','tools':[t['function']['name'] for t in payload.get('tools',[])]})
            if self.path.startswith('/fail/'):
                raw=b'{"error":{"message":"qa-secret-not-real"}}';self.send_response(503);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
            n=len(mock_calls);name,args=('get_state',{}) if n==1 else ('lua',{'code':'local s=numen.status.self(); local p=numen.route.plan({to={x=math.floor(s.pos.x)+2,z=math.floor(s.pos.z)},costs={dig=false,place=false}}); if not p.ok then error(p.why) end; local m=numen.move.go(p); print(m.pos.x,m.pos.y,m.pos.z)'}) if n==2 else ('finish',{'summary':'已完成真实移动并核对回执。'})
            response={'id':'mock-'+str(n),'object':'chat.completion','choices':[{'index':0,'message':{'role':'assistant','content':'','tool_calls':[{'id':'mock-call-'+str(n),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]},'finish_reason':'tool_calls'}],'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}}
            raw=json.dumps(response).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    mock=ThreadingHTTPServer(('127.0.0.1',28991),Mock);threading.Thread(target=mock.serve_forever,daemon=True).start()
    try:
        start('first');checks['inside_java_http_no_owner_client']=request('/healthz')[1]['serverResident']
        checks['auth_and_origin']=request('/mcp',{})[0]==401 and request('/mcp',{}, {'Authorization':'Bearer '+bearer,'Origin':'https://example.com'})[0]==403
        checks['mcp_initialize_tools']=rpc('initialize',{'protocolVersion':'2025-06-18'})['protocolVersion']=='2025-06-18' and len(rpc('tools/list')['tools'])==14
        ops=tool('operations');report['operations']=ops;checks['runtime_operations']=ops['totalFunctions']>=30 and any(g['id']=='numen.route' for g in ops['groups'])
        created=tool('create_companion',{'name':'MawHeadBody','action_id':'qa-create-01'});assert created.get('online'),created
        body=created['bodyId'];report['bodyId']=body
        again=tool('create_companion',{'name':'MawHeadBody','action_id':'qa-create-01'});checks['create_idempotent_original_uuid']=again['bodyId']==body and again['replayed']
        checks['owner_isolation']=tool('get_state',{'companion':body},other_token)['code']=='body_not_owned'
        claim=tool('claim_control',{'companion':body,'controller_id':'qa-controller'});lease=claim['lease']['leaseId']
        checks['one_controller']=tool('claim_control',{'companion':body,'controller_id':'other-controller'})['code']=='controller_busy'
        code='local s=numen.status.self(); local p=numen.route.plan({to={x=math.floor(s.pos.x)+2,z=math.floor(s.pos.z)},costs={dig=false,place=false}}); if not p.ok then error(p.why) end; local m=numen.move.go(p); print(m.pos.x,m.pos.y,m.pos.z)'
        before=tool('get_state',{'companion':body});accepted=tool('lua',{'companion':body,'lease_id':lease,'action_id':'qa-walk-01','code':code});assert accepted['phase']=='accepted',accepted
        done=terminal('qa-walk-01');assert done['ok'],done
        after=tool('get_state',{'companion':body});report['walk']={'before':before['position'],'after':after['position'],'receipt':done['outcome']}
        checks['move_terminal_actual_position']=abs(after['position']['x']-before['position']['x'])>.5
        # Native walking leaves a small amount of velocity after its terminal receipt.
        # Check the durable receipt as well as displacement, rather than exact floats.
        time.sleep(.4)
        duplicate_before=tool('get_state',{'companion':body})
        walk_file=server/'world-server-numen/maw-numen-server/actions'/body/'qa-walk-01.json'
        receipt_hash=hashlib.sha256(walk_file.read_bytes()).hexdigest()
        replay=tool('lua',{'companion':body,'lease_id':lease,'action_id':'qa-walk-01','code':code})
        time.sleep(.4)
        duplicate_after=tool('get_state',{'companion':body})
        drift=max(abs(duplicate_after['position'][axis]-duplicate_before['position'][axis]) for axis in ('x','y','z'))
        unchanged=receipt_hash==hashlib.sha256(walk_file.read_bytes()).hexdigest()
        same_receipt=all(replay[k]==done[k] for k in ('phase','fingerprint','completedAt','outcome'))
        report['duplicate']={'before':duplicate_before['position'],'after':duplicate_after['position'],'maxDisplacement':drift,'durableReceiptUnchanged':unchanged,'sameTerminalReceipt':same_receipt}
        checks['reconnect_duplicate_does_not_execute']=replay['replayed'] and replay['phase']=='terminal' and unchanged and same_receipt and drift<.1 and not duplicate_after['programRunning']
        checks['fingerprint_conflict']=tool('lua',{'companion':body,'lease_id':lease,'action_id':'qa-walk-01','code':'print("different")'})['code']=='action_id_conflict'
        tool('lua',{'companion':body,'lease_id':lease,'action_id':'qa-client-only','code':'print(numen.api.help("numen.status"))'})
        unsupported=terminal('qa-client-only');checks['client_only_explicit_failure']=unsupported['phase']=='terminal' and not unsupported['ok'] and 'server_only_function_unavailable' in json.dumps(unsupported['outcome'])
        tool('lua',{'companion':body,'lease_id':lease,'action_id':'qa-cancel','code':'numen.time.wait(30); print("WAIT_SHOULD_NOT_COMPLETE")'})
        time.sleep(.3);tool('action_cancel',{'companion':body,'lease_id':lease,'action_id':'qa-cancel'})
        cancelled=terminal('qa-cancel');checks['async_cancel_receipt']=cancelled['phase']=='terminal' and not cancelled['ok']
        events=tool('get_events',{'companion':body});checks['events_non_consuming']=events['events']==tool('get_events',{'companion':body})['events'] and len(events['events'])>=2
        through=events['events'][-1]['sequence'];tool('ack_events',{'companion':body,'lease_id':lease,'through':through});checks['events_explicit_ack']=all(e['sequence']>through for e in tool('get_events',{'companion':body})['events'])
        # Expose the private UI only to a real, non-OP connected ordinary owner.
        source=output/'owner.cjs';source.write_text("const mc=require('mineflayer'),fs=require('fs');const b=mc.createBot({host:'127.0.0.1',port:28978,username:'MawHeadQAOwner',auth:'offline',version:'1.21.1',physicsEnabled:false});b.once('spawn',()=>fs.writeFileSync(process.argv[2],JSON.stringify({uuid:b.player.uuid})));b.on('error',e=>{console.error(e);process.exitCode=1});b.on('kicked',r=>console.error('kicked',r));const t=setInterval(()=>{if(fs.existsSync(process.argv[3])){clearInterval(t);b.quit('QA done');setTimeout(()=>process.exit(),250);}},200);setTimeout(()=>{b.quit();process.exit(2)},90000);",encoding='utf-8')
        if full_pack:source.write_text(source.read_text('utf-8').replace('port:28978','port:28979'),encoding='utf-8')
        env={**os.environ,'NODE_PATH':str(root/'gateway/permanent/node/node_modules')}
        client=subprocess.Popen([str(node),str(source),str(output/'owner-ready.json'),str(output/'owner-release')],env=env,stdout=(output/'owner.log').open('w'),stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        deadline=time.monotonic()+30
        while not (output/'owner-ready.json').exists() and client.poll() is None and time.monotonic()<deadline:time.sleep(.2)
        assert (output/'owner-ready.json').exists(),'ordinary owner login failed'
        assert json.loads((output/'owner-ready.json').read_text())['uuid']==owner
        ui('profile.save',{'profileId':'default','name':'QA model','provider':'openai','model':'qa-local','baseUrl':'http://127.0.0.1:28991/v1','apiKey':'qa-secret-not-real'})
        saved=ui('profile.save',{'profileId':'default','name':'QA model','provider':'openai','model':'qa-local','baseUrl':'http://127.0.0.1:28991/v1','apiKey':''})
        checks['profile_blank_retains_no_key_echo']=saved['profile']['keyConfigured'] and 'apiKey' not in saved['profile'] and 'qa-secret-not-real' not in json.dumps(ui('menu'))
        ui('settings',{'companion':body,'driver':'hosted','profileId':'default','permissionMode':'ask'})
        before_brain=tool('get_state',{'companion':body})['position'];ui('task',{'companion':body,'text':'向东走两格，核对实际坐标，然后停止。'})
        deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            state=tool('get_state',{'companion':body})
            if state.get('brain',{}).get('phase')=='completed':break
            time.sleep(.3)
        checks['hosted_native_loop_real_move_mock_model']=state.get('brain',{}).get('phase')=='completed' and len(mock_calls)==3 and abs(state['position']['x']-before_brain['x'])>.5
        report['mockModelCalls']=mock_calls
        ui('profile.save',{'profileId':'default','name':'QA failure','provider':'openai','model':'qa-local','baseUrl':'http://127.0.0.1:28991/fail/v1','apiKey':''})
        count=len(mock_calls);ui('task',{'companion':body,'text':'验证失败后停止，不重试。'});time.sleep(1.5)
        failed=tool('get_state',{'companion':body});checks['model_failure_pauses_no_retry']=failed['brain']['phase']=='unknown' and len(mock_calls)==count+1
        checks['key_not_in_server_log']=not any('qa-secret-not-real' in line for line in lines)
        ui('settings',{'companion':body,'driver':'external','profileId':'default','permissionMode':'ask'})
        claim=tool('claim_control',{'companion':body,'controller_id':'qa-controller'});lease=claim['lease']['leaseId']
        tool('lua',{'companion':body,'lease_id':lease,'action_id':'qa-owner-leaves','code':'numen.time.wait(3); print("OWNER_LEFT_ACTION_FINISHED")'})
        (output/'owner-release').write_text('done');client.wait(timeout=10);checks['owner_disconnect_normal']=client.returncode==0
        checks['owner_logout_does_not_cancel']=terminal('qa-owner-leaves')['ok']
        console('give MawHeadBody minecraft:bread 3');time.sleep(.4)
        inventory=tool('get_state',{'companion':body})['inventory'];assert sum(s.get('count',0) for s in inventory if s.get('id')=='minecraft:bread')==3
        stop();start('restored')
        restored=tool('get_state',{'companion':body});checks['restart_original_body_inventory']=restored.get('online') and restored['bodyId']==body and restored['inventory']==inventory
        checks['terminal_receipt_survives_restart']=tool('action_status',{'companion':body,'action_id':'qa-walk-01'})['phase']=='terminal'
        console('kill MawHeadBody');deadline=time.monotonic()+15;saw_dead=False
        while time.monotonic()<deadline:
            state=tool('get_state',{'companion':body});saw_dead|=state['status']=='dead'
            if saw_dead and state.get('online') and state['status']=='alive':break
            time.sleep(.2)
        checks['offline_owner_death_respawn_same_uuid']=saw_dead and state.get('online') and state['status']=='alive' and state['bodyId']==body
        anchor=json.loads((server/'world-server-numen/maw-numen-server/bodies'/f'{body}.json').read_text())['anchor'];checks['respawn_uses_safe_anchor']=abs(state['position']['x']-anchor['x'])<1 and abs(state['position']['z']-anchor['z'])<1
        stop()
        # Explicit interrupted-action fixture: not a real unfinished production action.
        folder=server/'world-server-numen/maw-numen-server';bfile=folder/'bodies'/f'{body}.json';b=json.loads(bfile.read_text());b['activeAction']='qa-unknown-fixture';bfile.write_text(json.dumps(b),encoding='utf-8')
        afile=folder/'actions'/body/'qa-unknown-fixture.json';afile.write_text(json.dumps({'session':str(uuid.uuid4()),'phase':'accepted','action_id':'qa-unknown-fixture','fingerprint':hashlib.sha256(b'print("NEVER_REPLAY")').hexdigest()}),encoding='utf-8')
        start('unknown')
        blocked=tool('get_state',{'companion':body});unknown=tool('action_status',{'companion':body,'action_id':'qa-unknown-fixture'})
        checks['interrupted_unknown_not_restored_or_replayed']=not blocked['online'] and blocked['blocked']=='previous_action_unknown_do_not_replay' and unknown['phase']=='unknown' and not any('NEVER_REPLAY' in line for line in lines)
        report['completed']=True
    finally:
        if client and client.poll() is None:
            (output/'owner-release').write_text('done')
            try:client.wait(timeout=10)
            except subprocess.TimeoutExpired:report['clientCleanupFailed']=True
        stop();mock.shutdown();mock.server_close()
        report['ok']=report.get('completed',False) and all(checks.values()) and all(c==0 for c in [*report['serverExitCodes'],*report.get('gateExitCodes',[])]) and not report.get('clientCleanupFailed')
        (output/'acceptance.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=DEFAULT_ROOT);p.add_argument('--output',type=Path,required=True);p.add_argument('--java',type=Path,default=DEFAULT_JAVA);p.add_argument('--node',type=Path,required=True);p.add_argument('--full-pack',action='store_true');a=p.parse_args()
    result=run(a.root,a.output,a.node,a.java,a.full_pack);print(json.dumps(result,ensure_ascii=False));raise SystemExit(0 if result['ok'] else 1)

if __name__=='__main__':main()
