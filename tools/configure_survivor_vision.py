"""Add the existing scene tool's native policy, preserving other permissions.

Defaults to preview. Apply only at the original survivor's idle maintenance
boundary. Native policy updates also refresh the active driver handler; the
legacy tools-list API alone does not grant invocation permission.
"""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import argparse,json,sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'world/survival'))
from mcp_server import TOOL_NAMES


def prepare_policy(policy, names=TOOL_NAMES):
    expected=set(names)
    if 'view_scene' not in expected or not isinstance(policy,dict):raise ValueError('invalid_policy')
    rules=policy.get('tool_defaults')
    if (policy.get('default_effect')!='deny' or policy.get('client_overrides')!=[]
        or policy.get('tool_overrides')!=[] or policy.get('unmanaged_rules_count')!=0
        or not isinstance(rules,list)):raise ValueError('unexpected_policy_scope')
    found=[]
    for rule in rules:
        if (not isinstance(rule,dict) or set(rule)!={'tool_name','effect'}
            or rule.get('effect')!='allow' or not isinstance(rule.get('tool_name'),str)):
            raise ValueError('unexpected_policy_rule')
        found.append(rule['tool_name'])
    if len(found)!=len(set(found)) or set(found) not in (expected,expected-{'view_scene'}):
        raise ValueError('unexpected_policy_tools')
    after=deepcopy(policy)
    if 'view_scene' not in found:after['tool_defaults'].append({'tool_name':'view_scene','effect':'allow'})
    return after


def main():
    from configure_survivor_party import api
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();role='qd-survivor';route='/mcp/policy/numen_survival'
    before=api('GET',route,role);after=prepare_policy(before)
    connection=api('GET','/mcp/numen_survival',role)
    assert connection['enabled'] and connection['url']=='http://survivor:8089/mcp'
    assert set(connection['tools'])==set(TOOL_NAMES)
    if not args.apply or before==after:
        print(json.dumps({'changed':before!=after,'applied':False,'addedTool':'view_scene' if before!=after else None}));return
    state=ROOT/'server/survival-agent-state/survival'
    def idle():
        read=lambda name:json.loads((state/name).read_text('utf8'))
        assert read('control.json')['enabled'] is False and not read('controller.json').get('active')
        assert read('lease.json')['status']=='closed'
        assert not (state/'unknown.json').exists() and not (state/'inflight-action.json').exists()
        assert api('GET','/agents/'+role+'/agent-status',role)['running_task_count']==0
        for job in api('GET','/cron/jobs',role):
            assert job['enabled'] is False
            assert api('GET','/cron/jobs/'+job['id'],role)['state'].get('last_status')!='running'
    idle()
    out=ROOT/'runtime/survivor-vision-policy'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    out.mkdir(parents=True,exist_ok=False)
    (out/'before.json').write_text(json.dumps(before,ensure_ascii=False,indent=2),'utf8')
    assert api('GET',route,role)==before and api('GET','/mcp/numen_survival',role)==connection
    idle()
    (out/'intent.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),'utf8')
    api('PUT',route,role,after) # One write; uncertain failure is not replayed.
    actual=api('GET',route,role)
    (out/'after.json').write_text(json.dumps(actual,ensure_ascii=False,indent=2),'utf8')
    current_connection=api('GET','/mcp/numen_survival',role)
    # access_summary is the API's derived policy count; the connection itself
    # (URL, credentials reference, tool list and enable flag) must stay exact.
    stable=lambda value:{k:v for k,v in value.items() if k!='access_summary'}
    assert actual==after and stable(current_connection)==stable(connection)
    print(json.dumps({'applied':True,'onlyAddedPolicy':'view_scene','totalToolPolicies':len(actual['tool_defaults']),'backup':str(out)}))


if __name__=='__main__':main()
