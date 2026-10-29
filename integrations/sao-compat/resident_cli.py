"""Exercise the actual owner-scoped lab MCP without printing bearer or leases."""
import argparse
import json
from pathlib import Path
import urllib.request
import urllib.error
import uuid

def clean(obj):
    if isinstance(obj,dict):return {k:('[redacted]' if k.lower()in {'token','leaseid','lease_id','apikey','authorization'} else clean(v))for k,v in obj.items()}
    if isinstance(obj,list):return [clean(x)for x in obj]
    return obj

def call(root, tool, arguments, code_file=None):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    credentials=json.loads((root/'lab-controller.private.json').read_text('utf-8'))
    if credentials['endpoint']!='http://127.0.0.1:39689/mcp':raise ValueError('lab_endpoint_changed')
    control=root/'lab-numen-control.private.json';owned=json.loads(control.read_text('utf-8'))if control.exists()else{}
    if tool not in {'operations','mod_operations','list_companions','create_companion'}:
        arguments.setdefault('companion',owned.get('bodyId'))
    if tool in {'lua','mod_action','action_cancel','ack_events','restore_companion','dormant_companion','release_control','set_permission'}:
        arguments.setdefault('lease_id',owned.get('leaseId'))
    if code_file:arguments['code']=Path(code_file).read_text('utf-8')
    payload={'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':'tools/call','params':{'name':tool,'arguments':arguments}}
    req=urllib.request.Request(credentials['endpoint'],json.dumps(payload).encode(),headers={'Authorization':'Bearer '+credentials['token'],'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=20)as response:data=json.load(response)
    except urllib.error.HTTPError as error:
        data=json.loads(error.read());print(json.dumps({'httpStatus':error.code,**clean(data)},ensure_ascii=False));return data
    if 'error'in data:raise RuntimeError(data['error'])
    out=data['result']['structuredContent']
    if out.get('ok')and tool=='create_companion':owned['bodyId']=out['bodyId']
    if out.get('ok')and tool=='claim_control':owned.update(bodyId=out['bodyId'],leaseId=out['lease']['leaseId'])
    control.write_text(json.dumps(owned,indent=2),encoding='utf-8')
    evidence=root/'acceptance';evidence.mkdir(exist_ok=True)
    name=tool+'-'+str(arguments.get('action_id','latest'))
    if not all(c.isalnum()or c in '._-' for c in name):raise ValueError('invalid_evidence_id')
    (evidence/(name+'.json')).write_text(json.dumps(clean(out),ensure_ascii=False,indent=2),encoding='utf-8')
    summary={k:clean(v)for k,v in out.items()if k in {'ok','action','code','bodyId','status','phase','online','position','health','maxHealth','hunger','permissionMode','totalFunctions','groups','functions','replayed','action_id','sampledAt','numenVersion'}}
    if 'outcome'in out:summary['outcome']=clean(out['outcome'])
    if 'after'in out:summary['after']={k:v for k,v in out['after'].items()if k in {'status','position','health','programRunning','currentAction'}}
    print(json.dumps(summary,ensure_ascii=False))
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('tool');p.add_argument('--arguments',default='{}');p.add_argument('--code-file');a=p.parse_args();call(a.root,a.tool,json.loads(a.arguments),a.code_file)
