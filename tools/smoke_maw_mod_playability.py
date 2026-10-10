"""Isolated full-mod functional audit, ordinary Mineflayer plus Numen; zero model calls."""
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
from society_lab import DEFAULT_ROOT, DEFAULT_JAVA, REPO
from smoke_numen_server import offline

NODE=Path(r'C:\Users\lzl19\AppData\Local\hermes\node\node.exe')

def prepare(root: Path, output: Path):
    if output.exists() or (root/'research').resolve() not in output.resolve().parents:
        raise ValueError('A fresh directory inside runtime/research is required')
    server=output/'server';mods=server/'mods';mods.mkdir(parents=True)
    for p in (root/'server/mods').glob('*.jar'):shutil.copyfile(p,mods/p.name)
    shutil.copyfile(root/'server/eula.txt',server/'eula.txt')
    # Library files are only referenced by an absolute JVM argfile; no link or copy.
    args=(root/'server/libraries/net/neoforged/neoforge/21.1.248/win_args.txt').read_text('utf-8')
    args=args.replace('libraries/',(root/'server/libraries').as_posix()+'/').replace('-DlibraryDirectory=libraries','-DlibraryDirectory='+(root/'server/libraries').as_posix())
    (server/'qa-args.txt').write_text(args,encoding='utf-8')
    props={'server-ip':'127.0.0.1','server-port':'28978','online-mode':'false','enforce-secure-profile':'false','enable-rcon':'false','max-players':'6','spawn-protection':'0','view-distance':'3','simulation-distance':'3','difficulty':'peaceful','gamemode':'survival','level-name':'world-mod-audit','level-type':'minecraft:flat','generator-settings':json.dumps({'layers':[{'block':'minecraft:bedrock','height':1},{'block':'minecraft:dirt','height':126},{'block':'minecraft:grass_block','height':1}],'biome':'minecraft:plains','features':False,'lakes':False,'structure_overrides':[]},separators=(',',':')),'level-seed':'10102026','spawn-monsters':'false','motd':'Isolated full-mod playability QA'}
    (server/'server.properties').write_text(''.join(f'{k}={v}\n' for k,v in props.items()),encoding='utf-8')
    private=server/'config/maw-numen-private';private.mkdir(parents=True)
    token=secrets.token_hex(32);owner=offline('MawModQA')
    (private/'accounts.json').write_text(json.dumps({'accounts':[{'ownerUuid':owner,'tokenHash':hashlib.sha256(token.encode()).hexdigest()}]}),encoding='utf-8')
    (private/'bridge.json').write_text(json.dumps({'secret':secrets.token_hex(32)}),encoding='utf-8')
    config={'enabled':True,'bind':'127.0.0.1','port':28990,'allowedHosts':['127.0.0.1:28990'],'publicEndpoint':'http://127.0.0.1:28990/mcp','allowedModelHosts':[],'dailyModelCallsPerBody':0}
    (server/'config/maw-numen-server.json').write_text(json.dumps(config),encoding='utf-8')
    # Token stays in the private evidence directory and is never printed.
    (output/'qa-credentials.json').write_text(json.dumps({'token':token,'owner':owner}),encoding='utf-8')
    return server

class Audit:
    def __init__(self,root,output):
        self.root=root;self.output=output;self.server=output/'server';self.lines=[];self.process=None;self.gate=None;self.client=None;self.counter=0
        self.report={'schemaVersion':1,'paidModelRequests':0,'productionWorldActions':0,'actualPhoneTested':False,'checks':{},'fixtures':[],'trace':[],'ok':False}
        self.credentials=json.loads((output/'qa-credentials.json').read_text('utf-8'))
    def save(self):
        (self.output/'result.json').write_text(json.dumps(self.report,ensure_ascii=False,indent=2),encoding='utf-8')
    def check(self,key,condition,evidence=None):
        self.report['checks'][key]=bool(condition)
        if evidence is not None:self.report.setdefault('evidence',{})[key]=evidence
        self.save()
        assert condition,key
    def console(self,command):
        self.report['fixtures'].append({'at':time.time(),'command':command});self.process.stdin.write(command+'\n');self.process.stdin.flush();time.sleep(.15)
    def rpc(self,name,args=None):
        self.counter+=1
        body={'jsonrpc':'2.0','id':self.counter,'method':'tools/call','params':{'name':name,'arguments':args or {}}}
        req=Request('http://127.0.0.1:28990/mcp',json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+self.credentials['token']})
        with urlopen(req,timeout=15) as response:result=json.load(response)['result']['structuredContent']
        self.report['trace'].append({'kind':'mcp','operation':name,'arguments':args,'result':result});self.save();return result
    def player(self,kind,**fields):
        self.counter+=1;cid=str(self.counter);p=self.output/'player-command.json';temp=p.with_suffix('.part')
        temp.write_text(json.dumps({'id':cid,'kind':kind,**fields}),encoding='utf-8');os.replace(temp,p)
        deadline=time.monotonic()+18
        while time.monotonic()<deadline:
            r=self.output/'player-result.json'
            if r.exists():
                result=json.loads(r.read_text('utf-8'))
                if result['id']==cid:
                    self.report['trace'].append({'kind':'player','command':kind,**fields,'result':result});self.save()
                    assert 'error' not in result,result
                    return result['result']
            if self.client.poll() is not None:raise RuntimeError('ordinary player exited; inspect logs')
            time.sleep(.05)
        raise TimeoutError('unknown player result; do not replay')
    def query(self,operation,args=None):return self.rpc('mod_query',{'companion':self.body,'operation':operation,'arguments':args or {}})
    def mutation(self,operation,args=None,aid=None,expect=True):
        aid=aid or 'audit-'+str(uuid.uuid4());request={'companion':self.body,'lease_id':self.lease,'action_id':aid,'operation':operation,'arguments':args or {}}
        accepted=self.rpc('mod_action',request)
        if 'phase' not in accepted:
            assert not expect,accepted
            return accepted
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            result=self.rpc('action_status',{'companion':self.body,'action_id':aid})
            if result.get('phase') in ('terminal','unknown'):
                assert result['phase']=='terminal',result
                if expect:assert result['ok'],result
                return result
            time.sleep(.1)
        raise TimeoutError('native mutation outcome unknown; do not replay')
    def start(self):
        for port in (28978,28979,28990):
            with socket.socket() as s:s.bind(('127.0.0.1',port))
        self.process=subprocess.Popen([str(DEFAULT_JAVA),'-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8','-Xms256m','-Xmx2048m','@qa-args.txt','nogui'],cwd=self.server,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        def capture():
            with (self.output/'server-console.log').open('w',encoding='utf-8') as f:
                for line in self.process.stdout:self.lines.append(line);f.write(line);f.flush()
        self.reader=threading.Thread(target=capture,daemon=True);self.reader.start();deadline=time.monotonic()+200
        while time.monotonic()<deadline:
            if any('MAW_NUMEN_SERVER ready' in line for line in self.lines):break
            if self.process.poll() is not None:raise RuntimeError('isolated server exited')
            time.sleep(.2)
        else:raise TimeoutError('isolated server startup')
        main=json.loads((self.root/'services/service.json').read_text('utf-8'));original=next(r for r in main['services'] if r['id']=='gate')
        env={**os.environ,**original['env'],'NODE_PATH':str(self.root/'gateway/permanent/node/node_modules'),'GATE_LISTEN_HOST':'127.0.0.1','GATE_CACHE_FILE':str(self.output/'gate-cache.json'),'GATE_FAILURE_CAPTURE_FILE':str(self.output/'gate-failures.jsonl')};env.pop('GATE_LAN_SUBNET',None)
        self.gate=subprocess.Popen([str(NODE),str(REPO/'world/src/neoforge-handshake/gate.cjs'),'28979','127.0.0.1','28978'],cwd=REPO,env=env,stdin=subprocess.PIPE,stdout=(self.output/'gate.log').open('w'),stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            try:
                with socket.create_connection(('127.0.0.1',28979),timeout=1):break
            except OSError:time.sleep(.2)
        self.client=subprocess.Popen([str(NODE),str(REPO/'tools/smoke_maw_mod_player.cjs'),'28979',str(self.output)],env=env,stdout=(self.output/'player.log').open('w'),stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        deadline=time.monotonic()+30
        while time.monotonic()<deadline and not (self.output/'player-ready.json').exists():time.sleep(.1)
        assert (self.output/'player-ready.json').exists(),'ordinary player login failed'
    def stop(self):
        if self.client and self.client.poll() is None:
            try:self.player('quit')
            except Exception:pass
            self.client.wait(timeout=10)
        if self.gate and self.gate.poll() is None:self.gate.stdin.write(b'{"kind":"shutdown"}\n');self.gate.stdin.flush();self.gate.wait(timeout=20)
        if self.process and self.process.poll() is None:self.console('stop');self.process.wait(timeout=80)
        self.report['exitCodes']={k:p.returncode for k,p in [('player',self.client),('gate',self.gate),('server',self.process)] if p}
        self.save()

def run(a):
    a.start()
    # Concrete native workflows are kept in a separate module for replayable QA.
    from smoke_maw_mod_workflows import workflows
    workflows(a)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=DEFAULT_ROOT);p.add_argument('--output',type=Path,required=True);p.add_argument('--prepare',action='store_true');args=p.parse_args()
    if args.prepare:prepare(args.root,args.output);print(json.dumps({'ok':True,'prepared':str(args.output)}));return
    a=Audit(args.root,args.output)
    try:run(a);a.report['ok']=all(a.report['checks'].values())
    except Exception as e:a.report['error']=str(e);raise
    finally:a.stop()
    print(json.dumps({'ok':a.report['ok'],'checks':len(a.report['checks']),'output':str(args.output)}))

if __name__=='__main__':main()
