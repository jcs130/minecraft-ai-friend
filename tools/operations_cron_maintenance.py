"""Pause, inspect or rearm the four existing native model shifts; never restart services."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from contextlib import closing
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
JOBS = {'mc-god': 'qd-team-goddess', 'qd-engineer': 'qd-team-engineer',
        'qd-guild-planner': 'qd-team-designer', 'qd-steward': 'qd-world-daily-default'}
ACTORS = {'mc-god': 'game:mc-god', 'qd-engineer': 'operations:mc-god',
          'qd-guild-planner': 'game:qd-guild-planner'}


def api(method, role, route, body=None):
    request = urllib.request.Request('http://127.0.0.1:18089/api' + route, method=method,
        headers={'X-Agent-Id': role, 'Content-Type': 'application/json'},
        data=json.dumps(body, ensure_ascii=False).encode('utf8') if body is not None else b'' if method == 'POST' else None)
    with urllib.request.urlopen(request, timeout=20) as response:
        raw=response.read(2*1024*1024+1)
    if len(raw)>2*1024*1024: raise ValueError('native_response_too_large')
    return json.loads(raw)


def save(path, value):
    if any(p.is_symlink() for p in (path,*path.parents)): raise ValueError('linked_maintenance_manifest')
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    temporary.replace(path)


def load(path):
    rows=json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(rows,list) or len(rows)!=4 or {r['role']:r['jobId'] for r in rows}!=JOBS:
        raise ValueError('maintenance_manifest_identity_mismatch')
    for row in rows:
        if row['spec']['id']!=row['jobId'] or type(row['spec']['enabled']) is not bool:
            raise ValueError('maintenance_manifest_invalid_spec')
    return rows


def readiness(original, view, active, history, captured_at):
    reasons=[]
    if view['spec'] | {'enabled': original['spec']['enabled']} != original['spec']:
        reasons.append('native_spec_changed')
    if view['spec']['enabled']: reasons.append('schedule_not_paused')
    if view['state'].get('last_status')=='running': reasons.append('native_cron_running')
    if active.get('status')!='idle' or active.get('running_task_count')!=0:
        reasons.append('native_agent_not_idle')
    if original.get('beforeState',{}).get('last_status')=='running':
        terminal=[r for r in history if r.get('status') in ('success','error','cancelled')
            and datetime.fromisoformat(r['run_at'].replace('Z','+00:00')).timestamp()>=captured_at-2]
        if not terminal: reasons.append('inflight_native_terminal_not_observed')
    return reasons


def status(path, call=api):
    rows=load(path)
    result={'schema':1,'checkedAt':datetime.now(timezone.utc).isoformat(),'ready':False,'jobs':[],
            'scope':'Only the four model Crons; other background/life tasks must be checked separately.'}
    ledger=json.loads((ROOT/'server/operations-agent-state/operations-budget/delegations.json').read_text(encoding='utf8'))
    result['pendingReservations']=[{k:r.get(k) for k in ('runId','role','jobId','status','taskId')}
        for r in ledger if r.get('status') not in ('completed','failed','cancelled')]
    with closing(sqlite3.connect((ROOT/'server/team-state/team.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
        cycles={r[0]:{'status':r[1],'at':r[2]} for r in db.execute('SELECT actor,status,at FROM cycles')}
    for row in rows:
        role=row['role']; route='/cron/jobs/'+row['jobId']
        try:
            view=call('GET',role,route)
            active=call('GET',role,'/agents/'+role+'/agent-status')
            history=call('GET',role,route+'/history')
            reasons=readiness(row,view,active,history,path.stat().st_mtime)
            cycle=cycles.get(ACTORS.get(role))
            if cycle and cycle['status'] in ('running','unknown'): reasons.append('cycle_unresolved')
            result['jobs'].append({'role':role,'jobId':row['jobId'],'ready':not reasons,'reasons':reasons,
                'state':view['state'],'active':active,'cycle':cycle,'latestHistory':history[:2]})
        except Exception as error:
            result['jobs'].append({'role':role,'jobId':row['jobId'],'ready':False,'errorType':type(error).__name__})
    result['ready']=all(row['ready'] for row in result['jobs']) and not result['pendingReservations']
    return result


def pause(path, call=api):
    if path.exists(): raise ValueError('manifest_exists_use_status_or_new_manifest')
    rows=[]
    for role,job in JOBS.items():
        view=call('GET',role,'/cron/jobs/'+job)
        rows.append({'role':role,'jobId':job,'spec':view['spec'],'beforeState':view['state']})
    save(path,rows)
    journal={'pauseIntents':[],'acknowledged':[],'errors':[]}
    journal_path=path.with_suffix('.pause.json')
    for row in rows:
        if not row['spec']['enabled']:continue
        journal['pauseIntents'].append(row['role']);save(journal_path,journal)
        try:
            call('POST',row['role'],'/cron/jobs/'+row['jobId']+'/pause')
            journal['acknowledged'].append(row['role'])
        except Exception as error:
            journal['errors'].append({'role':row['role'],'errorType':type(error).__name__})
        finally:save(journal_path,journal)
    return journal


def resume(path, call=api):
    before=status(path,call)
    if not before['ready']:raise ValueError('native_operations_not_quiescent')
    report={'rearmed':[],'errors':[],'modelRequests':0,'serviceRestarts':0}
    report_path=path.with_suffix('.resume.json')
    for row in load(path):
        if not row['spec']['enabled']:continue
        role=row['role']; route='/cron/jobs/'+row['jobId']
        try:
            call('PUT',role,route,row['spec'])
            current=call('GET',role,route)
            if current['spec']!=row['spec'] or current['state'].get('next_run_at') is None:
                raise ValueError('native_cron_not_rearmed')
            report['rearmed'].append({'role':role,'jobId':row['jobId'],'nextRunAt':current['state']['next_run_at']})
        except Exception as error:
            report['errors'].append({'role':role,'errorType':type(error).__name__})
        finally:save(report_path,report)
    report['ok']=not report['errors']
    save(report_path,report)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=('pause','status','resume'))
    parser.add_argument('--manifest',type=Path,required=True)
    args=parser.parse_args()
    value=globals()[args.phase](args.manifest.resolve())
    print(json.dumps(value,ensure_ascii=False))
    raise SystemExit(0 if value.get('ready',value.get('ok',not value.get('errors'))) else 1)
