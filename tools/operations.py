"""One bounded CLI for world operations; public inventory never contains secrets.

Examples: operations.py status; operations.py doctor; operations.py snapshot
          operations.py restart panel --execute qiandengji
The web panel reads this snapshot; its authenticated control service has a
separate fixed API and does not run these command strings.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r'^[a-z][a-z0-9-]{0,47}$')
KNOWN = frozenset(('mc','world','gate','npc','resources','qwenpaw','qwenpaw-ops','voice','asr','panel','tts','control','survivor'))


def utc(): return datetime.now(timezone.utc).isoformat()


def read_registry(root=ROOT):
    value=json.loads((root/'config/operations-runtime.json').read_text('utf-8-sig'))
    assert type(value.get('schema')) is int and value['schema']==1 and value.get('project')=='qiandengji'
    services=value.get('services'); assert isinstance(services,list) and {s['id'] for s in services}==KNOWN
    assert len(services)==len(KNOWN)
    for key, members in value['groups'].items():
        assert NAME.fullmatch(key) and isinstance(members,list) and set(members)<=KNOWN
    for row in services+value['externalServices']:
        assert NAME.fullmatch(row['id']) and isinstance(row['dependencies'],list)
    for row in value['externalServices']:
        assert NAME.fullmatch(row['container'])
        assert not row.get('healthUrl') or row['healthUrl']=='http://127.0.0.1:8100/health'
    return value


def command(args, timeout=40):
    proc=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout,
                        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if proc.returncode: raise RuntimeError('Operation unavailable: '+args[0])
    return proc.stdout


def compose(*args,timeout=120):
    return command(['docker','compose','--project-directory',str(ROOT),'-f',str(ROOT/'compose.yml'),'-p','qiandengji',*args],timeout)


def inspect_containers(names):
    result={}
    # Missing one optional legacy container must not hide all current services.
    for name in names:
        try:
            row=json.loads(command(['docker','inspect',name],12))[0]
            state=row.get('State',{}); labels=row.get('Config',{}).get('Labels',{}) or {}
            result[name]={'state':state.get('Status','unknown'),'health':state.get('Health',{}).get('Status',''),
                'project':labels.get('com.docker.compose.project'), 'service':labels.get('com.docker.compose.service'),
                'restart':row.get('HostConfig',{}).get('RestartPolicy',{}).get('Name',''),
                'id':row.get('Id'),'startedAt':state.get('StartedAt')}
        except Exception:
            result[name]={'state':'unavailable','health':'unknown','project':None,'restart':None}
    return result


def probe_shared_tts(opener=urllib.request.urlopen):
    """Probe the actual dependency; a polling voice worker alone proves nothing."""
    try:
        with opener('http://127.0.0.1:8100/health',timeout=4) as response:
            body=response.read(16385)
            assert len(body)<=16384
            data=json.loads(body)
            return {'ok':response.status==200 and isinstance(data,dict) and data.get('ok') is True,
                    'endpoint':'http://127.0.0.1:8100/health','scope':'Shared TTS health endpoint; not an audio listening test'}
    except Exception as exc:
        return {'ok':False,'endpoint':'http://127.0.0.1:8100/health','errorType':type(exc).__name__}


def collect_snapshot(root=ROOT):
    registry=read_registry(root)
    names=['qiandengji-'+row['id']+'-1' for row in registry['services']]+[row['container'] for row in registry['externalServices']]
    states=inspect_containers(names); rows=[]; issues=[]; core_ok=True
    for row in registry['services']:
        name='qiandengji-'+row['id']+'-1'; state=states[name]
        owned=state.get('project')=='qiandengji' and state.get('service')==row['id']
        ready=owned and state['state']=='running' and (not row['healthRequired'] or state['health']=='healthy')
        supervised=state.get('restart')=='unless-stopped'
        core_ok=core_ok and ready and supervised
        rows.append({key:row[key] for key in ('id','label','group','purpose','dependencies')}|
                    {'container':name,'state':state['state'],'health':state['health'],'ready':ready and supervised,'managedBy':'D 项目 Compose · '+str(state.get('restart') or '无已知守护')})
        if not ready:issues.append({'code':'service:'+row['id'],'severity':'error','title':row['label']+'未就绪','detail':'检查该服务的状态、健康结果及 Compose 归属。'})
        if not supervised:issues.append({'code':'supervision:'+row['id'],'severity':'error','title':row['label']+'缺少预期守护','detail':'当前 restart 策略与 unless-stopped 不符。'})
    dependency=probe_shared_tts()
    for row in registry['externalServices']:
        state=states[row['container']]
        rows.append({key:row[key] for key in ('id','label','group','container','purpose','managedBy','dependencies')}|
                    {'state':state['state'],'health':('healthy' if dependency['ok'] else 'unhealthy') if row['id']=='shared-tts' else state['health']})
        if row.get('desiredState')=='exited' and state['state']!='exited':
            issues.append({'code':'retirement-drift:'+row['id'],'severity':'warning','title':row['label']+'状态有变化',
                           'detail':'登记的期望状态为退出，当前为 '+state['state']+'。请核对是否有其他启动器将其拉起；巡检不会擅自再次停止。'})
        if row.get('desiredRestart')=='no' and state.get('restart')!='no':
            issues.append({'code':'retirement-policy:'+row['id'],'severity':'warning','title':row['label']+'启动策略有变化',
                           'detail':'退役环境应保持 restart=no；检查是否有其他管理入口更改策略。'})
    if not dependency['ok']:issues.append({'code':'shared-tts','severity':'error','title':'语音合成不可用','detail':'语音回复依赖本项目 tts 的 8100 端口；语音队列存活不能代替此依赖检查。'})
    try:
        from qwenpaw_inventory import collect_qwenpaw_inventory
        inventory=collect_qwenpaw_inventory(project_root=root)
        runtimes=inventory['runtimes']; agents=inventory['agents']; issues.extend(inventory.get('issues',[]))
    except Exception as exc:
        runtimes=[]; agents=[]
        issues.append({'code':'qwenpaw-inventory','severity':'warning','title':'Agent 配置清单不可用','detail':'采集失败类型：'+type(exc).__name__+'；不将未知配置视为未启用。'})
    team_round = None
    round_path = root/'server/operations-agent-state/run-reports/latest.json'
    try:
        if round_path.is_file() and round_path.stat().st_size < 128*1024:
            value=json.loads(round_path.read_text(encoding='utf8'))
            if value.get('schema')==1 and value.get('project')=='qiandengji-ops': team_round=value
    except (OSError,ValueError): pass
    team_policy=None; team_usage=None
    team_root=root/'server/operations-agent-state'
    try:
        value=json.loads((team_root/'upgrade-report.json').read_text(encoding='utf8'))
        if value.get('project')=='qiandengji-ops' and value.get('ok'): team_policy=value
        usage_file=team_root/'work/token_usage.json'
        if usage_file.stat().st_size > 4*1024*1024: raise ValueError('usage_limit')
        days=json.loads(usage_file.read_text(encoding='utf8'))
        today=datetime.now().strftime('%Y-%m-%d')
        bucket=days.get(today,{})
        team_usage={'window':'today','generatedAt':utc(),
            'callCount':sum(r.get('call_count',0) for r in bucket.values()),
            'promptTokens':sum(r.get('prompt_tokens',0) for r in bucket.values()),
            'completionTokens':sum(r.get('completion_tokens',0) for r in bucket.values()),
            'cachedTokens':sum(r.get('cache_read_tokens',0) for r in bucket.values()) if any('cache_read_tokens' in r for r in bucket.values()) else None}
    except (OSError,ValueError,TypeError,AttributeError): pass
    return {'schema':1,'project':'qiandengji','generatedAt':utc(),'runtimes':runtimes,'agents':agents,'services':rows,'issues':issues,'teamRound':team_round,
            'teamPolicy':team_policy,'teamUsage':team_usage,
        'commands':[{'label':'查看全部状态','command':'python tools/operations.py status'},
                    {'label':'检查服务与依赖','command':'python tools/operations.py doctor'},
                    {'label':'刷新管理台运营清单','command':'python tools/operations.py snapshot'},
                    {'label':'运行一次运营组巡检（最多同时两个模型）','command':'docker exec qiandengji-qwenpaw-ops-1 python /ops/operations_team_run.py'},
                    {'label':'查看安全启停方案','command':'python tools/operations.py restart panel'},
                    {'label':'执行已指定服务重启','command':'python tools/operations.py restart panel --execute qiandengji'}],
        'checks':{'currentServices':core_ok,'sharedTts':dependency},
        'scope':'Current service state and configured Agent metadata. Enabled agents and MCP subprocesses are not evidence of autonomous operation.'}


def write_snapshot(value,root=ROOT):
    target=root/'server/panel-state/operations.json'; target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=target.parent,prefix='.operations-',suffix='.tmp',delete=False) as stream:
        temporary=Path(stream.name)
        stream.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    try:temporary.replace(target)
    finally:temporary.unlink(missing_ok=True)
    # Reuse the supervised two-minute inventory job for live service health.
    # Full deployment/gameplay evidence remains in reports/runtime-health.json.
    services={r['id']:{'ok':r.get('ready') is True,'state':r.get('state','unknown'),
        'health':r.get('health','unknown')} for r in value.get('services',[]) if r.get('id') in KNOWN}
    health={'checked_at':value['generatedAt'],'ok':len(services)==len(KNOWN) and all(r['ok'] for r in services.values()),
        'services':services,'scope':'Current owned container health from the supervised inventory; gameplay evidence is separate.'}
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf8',dir=target.parent,prefix='.health-',suffix='.tmp',delete=False) as stream:
        temporary=Path(stream.name); stream.write(json.dumps(health,ensure_ascii=False)+'\n')
    try: temporary.replace(target.parent/'health.json')
    finally: temporary.unlink(missing_ok=True)


def select_services(requested,group,registry):
    if group and requested:raise ValueError('Choose either a group or explicit services')
    chosen=list(registry['groups'][group]) if group and group!='all' else sorted(KNOWN) if group=='all' else requested
    if not chosen or any(name not in KNOWN for name in chosen):raise ValueError('Only explicitly registered D project services are allowed')
    return list(dict.fromkeys(chosen))


def lifecycle_plan(action,selected,states):
    assert action in ('start','stop','restart') and selected and set(selected)<=KNOWN
    expanded=set(selected)
    if action in ('stop','restart'):
        if 'mc' in expanded:expanded.update(('world','npc','gate','survivor'))
        elif 'world' in expanded:expanded.add('npc')
        if 'tts' in expanded:expanded.add('voice')
    stop_order=[n for n in ('survivor','npc','world','gate','voice','asr','qwenpaw-ops','qwenpaw','resources','panel','control','mc','tts') if n in expanded]
    # A restart restores previously running consumers; it does not wake a
    # deliberately stopped dependent just because its prerequisite restarted.
    start=list(selected) if action=='start' else [n for n in stop_order if n in selected or states.get('qiandengji-'+n+'-1',{}).get('state')=='running']
    start=[n for n in ('tts','mc','world','gate','npc','qwenpaw','qwenpaw-ops','resources','voice','asr','control','panel','survivor') if n in start] if action!='stop' else []
    dependencies={'world':['mc'],'gate':['mc'],'npc':['mc','world'],'voice':['tts'],'survivor':['mc']}
    required=sorted({d for n in start for d in dependencies.get(n,[]) if d not in start})
    return {'project':'qiandengji','action':action,'selected':selected,'stop':stop_order if action!='start' else [],
            'saveMinecraft':action!='start' and 'mc' in expanded and states.get('qiandengji-mc-1',{}).get('state')=='running',
            'start':start,'requiredRunning':required,'scope':'Existing D containers only; startup does not implicitly start or recreate dependencies'}


def validate_lifecycle(plan,states):
    for name in set(plan['stop']+plan['start']+plan.get('requiredRunning',[])):
        state=states.get('qiandengji-'+name+'-1',{})
        if (not state.get('id') or state.get('project')!='qiandengji' or state.get('service')!=name
                or state.get('state') not in ('running','exited','created')):
            raise ValueError('Existing container state and ownership must be verified before lifecycle changes')
    for name in plan.get('requiredRunning',[]):
        state=states['qiandengji-'+name+'-1']
        if state['state']!='running' or (name=='mc' and state.get('health')!='healthy'):
            raise ValueError('A required dependency is not ready; explicitly include it in the requested plan')


@contextmanager
def lifecycle_lock():
    path=ROOT/'server/world-data/.qiandengji-smoke.lock'
    # Shared with the existing gameplay QA tools; exclusive creation prevents
    # another operation from entering after a mere existence check.
    with path.open('x',encoding='utf-8') as stream:
        stream.write(json.dumps({'pid':os.getpid(),'kind':'operations','at':utc()}))
    try:
        assert not (ROOT/'server/world-data/.qiandengji-recorder-qa.json').exists(), 'A recorder verification window is active'
        yield
    finally:path.unlink()


def write_action_record(record):
    out=ROOT/'runtime/operations-actions';out.mkdir(parents=True,exist_ok=True)
    (out/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')


def execute_lifecycle(plan,states):
    record={'schema':1,'project':'qiandengji','startedAt':utc(),'ok':False,'plan':plan,'steps':[]}
    def step(label,*args,**kwargs):
        row={'action':label,'services':list(args),'outcome':'started'};record['steps'].append(row)
        try:
            result=compose(*args,**kwargs);row['outcome']='command_completed';return result
        except Exception as exc:
            row.update(outcome='not_confirmed',errorType=type(exc).__name__);raise
    try:
        consumers=[name for name in plan['stop'] if name!='mc']
        if consumers:step('stop-consumers','stop',*consumers)
        if plan['saveMinecraft']:
            response=step('save-minecraft','exec','-T','mc','rcon-cli','save-all flush')
            assert 'Saved the game' in response or 'Saved the world' in response, 'Save acknowledgement not received; MC remains running'
        if 'mc' in plan['stop']:step('stop-minecraft','stop','mc')
        for name in plan['start']:
            step('start-and-wait','up','-d','--no-deps','--no-recreate','--wait','--wait-timeout','180',name,timeout=210)
        record['ok']=True
    except Exception as exc:
        record['errorType']=type(exc).__name__
        observed=inspect_containers(['qiandengji-'+n+'-1' for n in set(plan['stop']+plan['start'])])
        record['observedAfterFailure']=observed
        record['pendingRecovery']=[n for n in plan['stop'] if states.get('qiandengji-'+n+'-1',{}).get('state')=='running'
                                   and observed.get('qiandengji-'+n+'-1',{}).get('state')!='running']
        record['recoveryNote']='Inspect recorded outcomes before retrying; no automatic replay of an uncertain lifecycle action'
        raise
    finally:
        record['finishedAt']=utc()
        write_action_record(record)
    return record


def apply_lifecycle(plan,states):
    assert ROOT.resolve()==Path('D:/Projects/QiandengJi').resolve()
    with lifecycle_lock():
        # Refresh inside the shared lock. A change since the displayed plan
        # must be re-planned, particularly whether MC needs a save.
        fresh=inspect_containers(['qiandengji-'+n+'-1' for n in KNOWN])
        validate_lifecycle(plan,fresh)
        if lifecycle_plan(plan['action'],plan['selected'],fresh)!=plan:
            raise ValueError('Runtime state changed; generate a fresh lifecycle plan')
        return execute_lifecycle(plan,fresh)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['status','doctor','snapshot','start','stop','restart'],nargs='?',default='status')
    parser.add_argument('services',nargs='*')
    parser.add_argument('--group',choices=['all','game','voice','dialogue','management','operations'])
    parser.add_argument('--execute',choices=['qiandengji'])
    args=parser.parse_args(argv)
    try:
        registry=read_registry()
        if args.action in ('status','doctor','snapshot'):
            if args.services or args.group or args.execute:raise ValueError('Read operations take no lifecycle targets')
            from operations_inventory_lock import inventory_lock
            with inventory_lock(ROOT) as acquired:
                if not acquired:
                    print(json.dumps({'schema':1,'project':'qiandengji','ok':False,'skipped':True,'reason':'inventory_busy'}))
                    return 75
                result=collect_snapshot();write_snapshot(result)
            print(json.dumps(result,ensure_ascii=False,indent=2))
            return 1 if args.action=='doctor' and not (result['checks']['currentServices'] and result['checks']['sharedTts']['ok']) else 0
        selected=select_services(args.services,args.group,registry)
        states=inspect_containers(['qiandengji-'+name+'-1' for name in KNOWN])
        plan=lifecycle_plan(args.action,selected,states)
        result=apply_lifecycle(plan,states) if args.execute else {'executed':False,'plan':plan}
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except Exception as exc:
        print(json.dumps({'ok':False,'errorType':type(exc).__name__,'error':'Operation was not completed; consult the named D project configuration and action records'}),file=sys.stderr)
        return 1


if __name__=='__main__':raise SystemExit(main())
