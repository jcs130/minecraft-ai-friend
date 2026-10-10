"""Private server configuration, per-owner credentials, and bounded MCP calls. Never prints keys/tokens."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid
from urllib.request import Request,urlopen
from society_lab import DEFAULT_ROOT,REPO,sha256
from maw_service import atomic_json

PORT=28989
PUBLIC='http://192.168.3.163:28984/numen/mcp'
MODEL_HOSTS=['coding.dashscope.aliyuncs.com','dashscope.aliyuncs.com','api.openai.com','api.deepseek.com','api.anthropic.com','api.moonshot.cn','api.moonshot.ai','open.bigmodel.cn','api.siliconflow.cn']

def initialize(root=DEFAULT_ROOT):
    private=root/'server/config/maw-numen-private'
    cfg=root/'server/config/maw-numen-server.json'
    bedrock=root/'bedrock/plugins/Geyser/maw-agents-private.json'
    if cfg.exists():raise ValueError('Configuration already exists; preserve and edit explicitly')
    if bedrock.exists():raise ValueError('Bedrock private bridge exists; do not overwrite')
    private.mkdir(parents=True,exist_ok=True)
    for name,value in [('accounts.json',{'accounts':[]}),('bridge.json',{'secret':secrets.token_hex(32)})]:
        target=private/name
        if not target.exists():atomic_json(target,value)
    atomic_json(cfg,{'schemaVersion':1,'enabled':True,'bind':'127.0.0.1','port':PORT,'allowedHosts':[f'127.0.0.1:{PORT}'],'publicEndpoint':PUBLIC,'allowedModelHosts':MODEL_HOSTS,'dailyModelCallsPerBody':100})
    bridge=json.loads((private/'bridge.json').read_text('utf-8'))
    atomic_json(bedrock,{'endpoint':f'http://127.0.0.1:{PORT}/ui','secret':bridge['secret']})
    return {'ok':True,'config':str(cfg),'keysConfigured':False,'publicEndpoint':PUBLIC,'newPublicPorts':0}

def restrict_private(root=DEFAULT_ROOT):
    if os.name!='nt':return
    name=subprocess.run(['whoami'],capture_output=True,text=True,check=True).stdout.strip()
    for path in (root/'server/config/maw-numen-private',root/'bedrock/plugins/Geyser/maw-agents-private.json'):
        # Only this existing desktop account and SYSTEM; no administrator elevation needed.
        subprocess.run(['icacls',str(path),'/inheritance:r','/grant:r',name+':(OI)(CI)F' if path.is_dir() else name+':F','SYSTEM:(OI)(CI)F' if path.is_dir() else 'SYSTEM:F'],capture_output=True,check=True)

def provision(owner,label,root=DEFAULT_ROOT):
    owner=str(uuid.UUID(owner));private=root/'server/config/maw-numen-private';path=private/'accounts.json'
    accounts=json.loads(path.read_text('utf-8'));token=secrets.token_hex(32)
    if any(a['ownerUuid']==owner for a in accounts['accounts']):raise ValueError('Owner already provisioned; rotate explicitly from the private in-game menu')
    accounts['accounts'].append({'ownerUuid':owner,'label':label,'tokenHash':hashlib.sha256(token.encode()).hexdigest()});atomic_json(path,accounts)
    credentials=private/'credentials'/f'{owner}.json';atomic_json(credentials,{'ownerUuid':owner,'endpoint':PUBLIC,'token':token})
    return {'ok':True,'ownerUuid':owner,'credentialsFile':str(credentials),'tokenPrinted':False}

def call(credentials,operation,arguments):
    c=json.loads(credentials.read_text('utf-8'));data={'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':'tools/call','params':{'name':operation,'arguments':arguments}}
    req=Request(c['endpoint'],json.dumps(data).encode(),headers={'Authorization':'Bearer '+c['token'],'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'})
    with urlopen(req,timeout=15) as response:result=json.load(response)
    if 'error' in result:raise ValueError(result['error']['message'])
    return result['result']['structuredContent']

def probe(root=DEFAULT_ROOT):
    checks={};report={'schemaVersion':1,'scope':'server_resident_numen_and_bedrock_forms','checks':checks,'modelRequests':0,'worldActions':0,'actualPhoneTested':False,'ok':False}
    try:
        config=json.loads((root/'server/config/maw-numen-server.json').read_text('utf-8'))
        checks['loopback_native_http']=config['enabled'] and config['bind']=='127.0.0.1' and config['port']==PORT and not config.get('testOnlyAllowLoopbackModels')
        checks['existing_lan_gateway_no_new_ports']=config['publicEndpoint']==PUBLIC
        with urlopen(f'http://127.0.0.1:{PORT}/healthz',timeout=5) as response:h=json.load(response)
        checks['native_resident_endpoint']=h['ok'] and h['serverResident'] and not h['clientRequired']
        checks['native_maid_config_adapter']=h.get('maidConfigAvailable') is True
        main=json.load(urlopen('http://127.0.0.1:28985/healthz',timeout=5))
        checks['owned_java_and_worker_healthy']=main['healthy'] and not main['paused'] and time.time()-main['heartbeatEpoch']<20
        for name,build,installed in [('numen-server','numen-server',root/'server/mods/maw_numen_server-0.1.0.jar'),('bedrock-forms','bedrock-agents',root/'bedrock/plugins/Geyser/extensions/MawAgents.jar')]:
            rec=json.loads((root/'build'/build/'build-record.json').read_text('utf-8'));checks[name+'-exact-artifact']=sha256(installed)==rec['sha256'] and all(sha256(REPO/p)==digest for p,digest in rec['sourceFiles'].items())
        native=(root/'server/logs/latest.log').read_text('utf-8',errors='replace');checks['native_addon_loaded']='MAW_NUMEN_SERVER ready serverResident=true clientRequired=false port=28989' in native
        bridge=json.loads((root/'server/config/maw-numen-private/bridge.json').read_text('utf-8'));ui=json.loads((root/'bedrock/plugins/Geyser/maw-agents-private.json').read_text('utf-8'))
        checks['private_loopback_bridge_bound']=ui['endpoint']==f'http://127.0.0.1:{PORT}/ui' and secrets.compare_digest(bridge['secret'],ui['secret']) and len(bridge['secret'])==64
        bedrock=json.load(urlopen('http://127.0.0.1:28996/healthz',timeout=5));checks['owned_bedrock_healthy']=bedrock['healthy'] and not bedrock['paused'] and time.time()-bedrock['heartbeatEpoch']<20
        log=(root/'bedrock/ops/logs/bedrock.log').read_text('utf-8',errors='replace');checks['native_forms_loaded']='MAW_AGENTS ready nativeForms=true modelKeysRedacted=true' in log
        checks['native_maid_forms_loaded']='MAW_MAID_FORMS ready nativeConfig=true permission=native_operator ownerOnly=true' in log
    except Exception as error:report['error']=type(error).__name__
    report['ok']=len(checks)==12 and all(checks.values());return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=('initialize','provision','call','health'));p.add_argument('--root',type=Path,default=DEFAULT_ROOT);p.add_argument('--owner');p.add_argument('--label',default='external-agent');p.add_argument('--credentials',type=Path);p.add_argument('--operation');p.add_argument('--arguments',type=Path);a=p.parse_args()
    if a.action=='initialize':result=initialize(a.root);restrict_private(a.root)
    elif a.action=='provision':result=provision(a.owner,a.label,a.root)
    elif a.action=='call':result=call(a.credentials,a.operation,json.loads(a.arguments.read_text('utf-8')) if a.arguments else {})
    else:result=probe(a.root)
    print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result.get('ok',True) else 1

if __name__=='__main__':sys.exit(main())
