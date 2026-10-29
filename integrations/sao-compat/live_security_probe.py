"""Owner/lease/unknown-result regression against the running lab MCP."""
import json
from pathlib import Path
import sys
import urllib.request
import urllib.error
import uuid

def probe(root):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    credentials=json.loads((root/'lab-controller.private.json').read_text('utf-8'))
    body=json.loads((root/'lab-numen-control.private.json').read_text('utf-8'))['bodyId']
    def request(tool,args,token=None,origin=None):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        if origin:headers['Origin']=origin
        data={'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':'tools/call','params':{'name':tool,'arguments':args}}
        req=urllib.request.Request('http://127.0.0.1:39689/mcp',json.dumps(data).encode(),headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=15)as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
    checks=[]
    def check(name,passed):
        checks.append({'name':name,'passed':passed})
        if not passed:raise AssertionError(name)
    status,_=request('list_companions',{});check('missing_token_401',status==401)
    status,_=request('list_companions',{},'0'*64);check('wrong_token_401',status==401)
    status,_=request('list_companions',{},credentials['token'],'https://untrusted.invalid');check('browser_origin_403',status==403)
    status,res=request('get_state',{'companion':str(uuid.uuid4())},credentials['token'])
    check('foreign_body_denied',status==200 and res['result']['structuredContent'].get('code')=='body_not_owned')
    status,res=request('claim_control',{'companion':body,'controller_id':'sao-acceptance-20261029'},credentials['token'])
    check('owner_can_claim',status==200 and res['result']['structuredContent'].get('ok')is True)
    status,res=request('claim_control',{'companion':body,'controller_id':'conflicting-controller'},credentials['token'])
    check('second_controller_denied',status==200 and res['result']['structuredContent'].get('code')=='controller_busy')
    status,res=request('action_status',{'companion':body,'action_id':'never-submitted-action'},credentials['token'])
    check('unknown_action_not_completed',status==200 and res['result']['structuredContent'].get('code')=='unknown_action_id' and res['result']['structuredContent'].get('ok')is False)
    path=root/'acceptance/security.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(checks,indent=2),encoding='utf-8');print(json.dumps(checks))

if __name__=='__main__':probe(sys.argv[1])
