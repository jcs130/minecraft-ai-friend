"""Verify native learning skills/MCP/cron; default never submits a model task.

--exercise qiandengji-ops reserves and triggers the existing mc-herald weekly
job once. It never changes a job, creates fake learning evidence, or retries an
uncertain submission. A completed task without a new enabled workflow is
reported as not produced, not a successful learning experiment.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from agent_learning import TOOL_NAMES
from role_learning_profiles import validate_role_skills, validate_jobs

CHECKS = ('native-role-skills', 'native-learning-mcp', 'managed-weekly-cron',
          'cron-no-evidence-skip', 'learning-role-isolation', 'learning-source-alignment')
SOURCE_FILES = ('world/ops/agent_learning.py', 'world/ops/agent_learning_mcp.py',
    'world/ops/cron_guard.py', 'world/ops/role_learning_profiles.py',
    'world/ops/game-role-skills.json', 'world/ops/operations-role-skills.json',
    'world/ops/native_role_capabilities.py', 'world/ops/native-role-skills.json')
ROLE = 'mc-herald'
JOB = 'qd-learning-mc-herald'
WORK = 'server/operations-agent-state/work'

# Runs in the existing Qwen container. No server, scheduler or model is started.
# Qwen 2.2 has list/config/policy MCP APIs, but no public tool-call endpoint.
CONTAINER_PROBE = r'''
import asyncio,hashlib,json,os,sys,tempfile,urllib.request
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,'/ops')
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
from agent_learning import LearningTools,TOOL_NAMES,managed_job,write
from role_learning_profiles import roles,role_skills,validate_jobs,validate_guard
from native_role_capabilities import NATIVE_SKILLS
from cron_guard import guarded_execute

def get(route,role=None):
    req=urllib.request.Request('http://127.0.0.1:8088/api'+route,headers={'X-Agent-Id':role} if role else {})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req,timeout=8) as r: raw=r.read(2097153)
    assert len(raw)<=2097152
    return json.loads(raw)

def decoded(result):
    assert not result.isError
    if result.structuredContent is not None:return result.structuredContent
    return json.loads(next(c.text for c in result.content if c.type=='text'))

async def boundaries():
    with tempfile.TemporaryDirectory(prefix='qd-learning-smoke-') as tmp:
        state=Path(tmp);role='mc-herald';folder=state/'workspaces'/role
        write(state/'config.json',{'agents':{'profiles':{role:{'enabled':True},'unregistered-role':{'enabled':True}}}})
        write(folder/'agent.json',{'id':role,'mcp':{'clients':{'qd_learning':{'enabled':True,'tools':list(TOOL_NAMES)}}}})
        def forbidden(*a,**k):raise AssertionError('No fixture network/model request')
        tools=LearningTools(role,'operations',state,api=forbidden,fetch=forbidden)
        async def original(*a):raise AssertionError('Empty review must not enter inference')
        executor=SimpleNamespace(_workspace=SimpleNamespace(agent_id=role,workspace_dir=folder))
        job=SimpleNamespace(id='qd-learning-'+role,meta={'project':'qiandengji'},task_type='agent',
            dispatch=SimpleNamespace(channel='console'),runtime=SimpleNamespace(timeout_seconds=180,max_concurrency=1))
        result=await guarded_execute(executor,job,original,'operations',factory=lambda *a,**k:tools)
        assert result['qiandeng']['code']=='no_new_learning_evidence' and result['qiandeng']['modelCalls']==0
        rejected=0
        for bad in ['../mc-herald','unregistered-role']:
            try:LearningTools(bad,'operations',state,api=forbidden)
            except ValueError:rejected+=1
        try:tools.read_skill('../mc-god/AGENTS')
        except ValueError:rejected+=1
        assert rejected==3
        return {'noEvidenceSkipped':True,'roleIsolationRejections':rejected,'modelCalls':0,'scope':'real guard and LearningTools in temporary state'}

async def main(runtime):
    expected=set(roles(runtime));agents=get('/agents')['agents']
    assert {a['id'] for a in agents if a.get('enabled') is True}==expected
    guard=validate_guard('/state/work',runtime)
    rows=[]
    for role in sorted(expected):
        skills={s['name'] for s in get('/skills',role) if s.get('enabled') is True}
        assert set(role_skills(role,runtime))|set(NATIVE_SKILLS)<=skills
        exposed={t['name'] for t in get('/mcp/tools/qd_learning',role) if t.get('enabled') is True}
        assert exposed==set(TOOL_NAMES)
        jobs=get('/cron/jobs',role);validate_jobs({'jobs':jobs},role,runtime)
        params=StdioServerParameters(command='python',args=['/ops/agent_learning_mcp.py','--role',role,'--runtime',runtime],env=dict(os.environ))
        async with stdio_client(params) as (reader,writer):
            async with ClientSession(reader,writer) as session:
                await session.initialize()
                listed=await session.list_tools();assert {t.name for t in listed.tools}==set(TOOL_NAMES)
                status=decoded(await session.call_tool('learning_status',{}))
                assert status['ok'] is True and status['role']==role and status['runtime']==runtime
                assert status['maxLearnedSkills']==8
        rows.append({'role':role,'enabledSkills':sorted(skills),'nativeDriverEnabled':True,'initialized':True,
            'listedTools':len(listed.tools),'statusCalled':True,'returnedOwnRole':True,
            'managedJobId':jobs[0]['id'],'jobEnabled':jobs[0]['enabled'],'taskType':jobs[0]['task_type']})
    fixture=await boundaries()
    names=['agent_learning.py','agent_learning_mcp.py','cron_guard.py','role_learning_profiles.py','game-role-skills.json','operations-role-skills.json','native_role_capabilities.py','native-role-skills.json']
    hashes={'world/ops/'+n:hashlib.sha256((Path('/ops')/n).read_bytes()).hexdigest() for n in names}
    print(json.dumps({'ok':True,'runtime':runtime,'roles':rows,'guardVerified':guard,'fixture':fixture,
        'sourceHashes':hashes,'modelTasksSubmitted':0,'mcpTransport':'official ClientSession, short-lived stdio, same fixed driver command'}))
asyncio.run(main(sys.argv[1]))
'''


def require(value, code):
    if not value: raise ValueError(code)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path, limit=2 * 1024 * 1024):
    path = Path(path)
    require(not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)), 'linked_evidence')
    require(path.stat().st_size <= limit, 'evidence_limit')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): raise ValueError('redirect_not_allowed')


def api(route, role=ROLE, *, post=False):
    require(route.startswith('/'), 'relative_native_route_required')
    if post: require(route == '/cron/jobs/' + JOB + '/run' and role == ROLE, 'only_one_managed_job_allowed')
    request = urllib.request.Request('http://127.0.0.1:18090/api' + route,
        method='POST' if post else 'GET', headers={'X-Agent-Id': role})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=12) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    require(len(raw) <= 2 * 1024 * 1024, 'native_response_limit')
    return json.loads(raw)


def probe_runtime(runtime):
    container = 'qiandengji-qwenpaw-1' if runtime == 'game' else 'qiandengji-qwenpaw-ops-1'
    result = subprocess.run(['docker', 'exec', container, 'python', '-c', CONTAINER_PROBE, runtime],
        capture_output=True, text=True, encoding='utf-8', timeout=120,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    require(result.returncode == 0, 'runtime_probe_failed_' + runtime)
    require(len(result.stdout.encode()) <= 262144, 'runtime_probe_output_limit')
    return json.loads(result.stdout.strip().splitlines()[-1])


def default_checks(runtimes, root=ROOT):
    require(set(runtimes) == {'game', 'operations'}, 'both_runtimes_required')
    hashes = {name: digest(Path(root) / name) for name in SOURCE_FILES}
    rows = [row for value in runtimes.values() for row in value['roles']]
    require(all(v.get('ok') is True and v.get('modelTasksSubmitted') == 0 for v in runtimes.values()), 'runtime_probe_not_successful')
    checks = {
        'native-role-skills': len(runtimes['game']['roles']) >= 6 and len(runtimes['operations']['roles']) == 6
            and all({'qd-skill-evolution', 'make-skill', 'file_reader', 'cron'} <= set(r['enabledSkills']) for r in rows),
        'native-learning-mcp': all(r.get('initialized') is True and r.get('statusCalled') is True
            and r.get('nativeDriverEnabled') is True and r.get('returnedOwnRole') is True and r.get('listedTools') == len(TOOL_NAMES) for r in rows),
        'managed-weekly-cron': all(v.get('guardVerified') is True and all(r['managedJobId'] == 'qd-learning-' + r['role'] for r in v['roles']) for v in runtimes.values()),
        'cron-no-evidence-skip': all(v['fixture'].get('noEvidenceSkipped') is True and v['fixture'].get('modelCalls') == 0 for v in runtimes.values()),
        'learning-role-isolation': all(v['fixture'].get('roleIsolationRejections') == 3 for v in runtimes.values()),
        'learning-source-alignment': all(v.get('sourceHashes') == hashes for v in runtimes.values()),
    }
    return [{'name': name, 'ok': checks[name], 'evidenceLevel': 'live-native-API-and-real-MCP' if name in CHECKS[:3]
        else 'real-code-temporary-fixture' if name in CHECKS[3:5] else 'live-container-source-hashes'} for name in CHECKS]


def usage(get=api):
    end = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    rows = get('/token-usage/details?start_date=1970-01-01&end_date=' + end)
    require(isinstance(rows, list), 'usage_records_required')
    selected = [r for r in rows if r.get('agent_id') == ROLE]
    result = {}
    for key in ('call_count', 'prompt_tokens', 'completion_tokens'):
        values = [r.get(key) for r in selected]
        require(all(type(v) is int and v >= 0 for v in values), 'usage_field_unknown')
        result[key] = sum(values)
    return result


def trace_tools(value):
    """Structured protocol blocks only; never infer calls from prose/JSON fences."""
    calls = []
    def visit(row):
        if isinstance(row, list):
            for item in row: visit(item)
        elif isinstance(row, dict):
            if row.get('type') in ('tool_use', 'plugin_call', 'function_call'):
                name = row.get('name') or (row.get('function') or {}).get('name')
                if isinstance(name, str):
                    matches = [tool for tool in (*TOOL_NAMES, 'materialize_skill') if name == tool or name.endswith('__' + tool)]
                    if matches: calls.append(matches[0])
            for item in row.values():
                if isinstance(item, (list, dict)): visit(item)
    visit(value.get('events', []))
    return calls


def collect_exercise(marker, root=ROOT, get=api):
    root = Path(root); state = root / WORK; folder = state / 'workspaces' / ROLE
    result = {'requested': True, 'nativeCronPostAttempts': int(marker.get('postAttempted') is True), 'retryAutomatically': False,
        'jobId': JOB, 'reservationId': marker['id'], 'submission': marker['status'], 'skillProduced': False}
    current_job = get('/cron/jobs/' + JOB)['spec']
    result['jobConfigurationPreserved'] = current_job == marker['job']
    after = usage(get)
    delta = {key: after[key] - marker['usageBefore'][key] for key in after}
    require(all(v >= 0 for v in delta.values()), 'usage_went_backwards')
    result['usageDelta'] = delta
    result['usageAttribution'] = 'mc-herald aggregate delta during bounded experiment; concurrent external requests cannot be excluded'
    last_path = folder / 'learning/last-cron.json'
    last = read(last_path) if last_path.exists() else {}
    fresh = last.get('jobId') == JOB and last.get('checkedAt', 0) >= marker['reservedAt'] - 1
    result['guardStatus'] = last.get('status') if fresh else 'not_observed'
    result['guardCode'] = last.get('code') if fresh else None
    budget_path = root / 'server/operations-agent-state/operations-budget/delegations.json'
    ledger = read(budget_path) if budget_path.exists() else []
    run = next((row for row in ledger if fresh and row.get('runId') == last.get('runId')), None)
    result['sharedBudgetReserved'] = bool(run and run.get('source') == 'native-qwen-cron' and run.get('role') == ROLE and run.get('jobId') == JOB)
    traces = []
    for path in sorted((state / 'inbox_traces').glob('*.json')):
        if path.stem in marker['priorTraces']: continue
        value = read(path)
        if value.get('meta', {}).get('job_id') != JOB or value.get('created_at', 0) < marker['reservedAt'] - 1: continue
        traces.append({'runId': value['run_id'], 'status': value['status'], 'sha256': digest(path), 'toolCalls': trace_tools(value)})
    require(len(traces) <= 1, 'concurrent_matching_cron_runs')
    result['traces'] = traces
    index_path = folder / 'learning/index.json'
    index = read(index_path) if index_path.exists() else {'skills': {}}
    changed = {name: row for name, row in index.get('skills', {}).items()
        if row.get('enabled') is True and marker['skillsBefore'].get(name, {}).get('revision') != row.get('revision')}
    manifest_path = folder / 'skill.json'
    manifest = read(manifest_path) if manifest_path.exists() else {'skills': {}}
    native_created = {name: row for name, row in manifest.get('skills', {}).items()
        if name not in marker.get('nativeSkillsBefore', {}) and row.get('enabled') is True and row.get('source') == 'agent'
        and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', name) and not name.startswith('qd-')}
    if changed or native_created:
        validate_role_skills(folder, ROLE, 'operations')
    result['skillArtifacts'] = [{'name': name, 'revision': row['revision'], 'enabled': True,
        'markdownSha256': digest(folder / 'skills' / name / 'SKILL.md'), 'behaviorVerified': False} for name, row in changed.items()]
    result['skillArtifacts'] += [{'name': name, 'source': 'native-materialize-skill', 'enabled': True,
        'markdownSha256': digest(folder / 'skills' / name / 'SKILL.md'), 'behaviorVerified': False} for name in native_created]
    calls = set(traces[0]['toolCalls']) if traces else set()
    workflow = changed and {'learning_draft', 'learning_validate', 'learning_activate'} <= calls
    native_workflow = native_created and 'materialize_skill' in calls
    result['skillProduced'] = bool((workflow or native_workflow) and traces[0]['status'] == 'success')
    result['terminal'] = fresh and last.get('status') in ('finished', 'failed_or_interrupted', 'skipped')
    result['ok'] = bool(result['skillProduced'] and result['sharedBudgetReserved'] and result['jobConfigurationPreserved'] and delta['call_count'] > 0)
    result['code'] = 'new_experimental_workflow_verified' if result['ok'] else 'no_verified_new_skill_produced'
    return result


def exercise(root=ROOT, get=api, clock=time.time, sleeper=time.sleep, wait_seconds=210):
    root = Path(root); reservation = root / 'runtime/agent-learning-smoke/exercise.json'
    if reservation.exists():
        # Re-running only collects evidence; even a timeout before the POST reply
        # cannot cause a second uncorrelated paid run.
        return collect_exercise(read(reservation), root, get)
    jobs = get('/cron/jobs')
    validate_jobs({'jobs': jobs}, ROLE, 'operations')
    job = jobs[0]
    require(job['enabled'] is True, 'weekly_job_disabled_preserved')
    status = get('/agents/' + ROLE + '/agent-status')
    require(status.get('running_task_count') == 0, 'role_busy')
    state = root / WORK; index_path = state / 'workspaces' / ROLE / 'learning/index.json'
    index = read(index_path) if index_path.exists() else {'skills': {}}
    skill_path = state / 'workspaces' / ROLE / 'skill.json'
    manifest = read(skill_path) if skill_path.exists() else {'skills': {}}
    marker = {'schema': 1, 'id': uuid.uuid4().hex, 'reservedAt': clock(), 'status': 'reserved', 'postAttempted': False,
        'job': job, 'usageBefore': usage(get), 'skillsBefore': index.get('skills', {}),
        'nativeSkillsBefore': manifest.get('skills', {}),
        'priorTraces': [p.stem for p in (state / 'inbox_traces').glob('*.json')]}
    # Exclusive creation is the durable no-retry boundary across concurrent smoke processes.
    reservation.parent.mkdir(parents=True, exist_ok=True)
    with reservation.open('x', encoding='utf-8') as stream:
        json.dump(marker, stream, ensure_ascii=False); stream.flush(); os.fsync(stream.fileno())
    marker['postAttempted'] = True
    save(reservation, marker)
    try:
        reply = get('/cron/jobs/' + JOB + '/run', post=True)
        marker['status'] = 'accepted' if reply.get('started') is True else 'submission_uncertain'
    except Exception:
        marker['status'] = 'submission_uncertain'
    save(reservation, marker)
    deadline = clock() + wait_seconds
    while True:
        result = collect_exercise(marker, root, get)
        if result['terminal'] or clock() >= deadline: return result
        sleeper(5)


def run(root=ROOT, *, exercise_enabled=False, runtime_probe=probe_runtime, exercise_fn=exercise):
    root = Path(root); runtimes = {}; errors = {}
    for runtime in ('game', 'operations'):
        try: runtimes[runtime] = runtime_probe(runtime)
        except Exception as exc: errors[runtime] = type(exc).__name__
    checks = default_checks(runtimes, root) if not errors else [
        {'name': name, 'ok': False, 'evidenceLevel': 'unavailable'} for name in CHECKS]
    report = {'schema': 1, 'project': 'qiandengji', 'finishedAt': datetime.now(timezone.utc).isoformat(),
        'checks': checks, 'runtimes': runtimes, 'errors': errors, 'modelTasksSubmittedByDefault': 0,
        'worldActions': 0, 'exercise': {'requested': False, 'skillProduced': None},
        'sourceHashes': {name: digest(root / name) for name in (*SOURCE_FILES, 'tools/smoke_agent_learning.py')},
        'scope': 'Native skills/API and actual read-only MCP protocol; guard/isolation fixtures do not prove autonomous learning quality.'}
    report['ok'] = all(row['ok'] for row in checks)
    if exercise_enabled:
        if report['ok']:
            try: report['exercise'] = exercise_fn(root)
            except Exception as exc: report['exercise'] = {'requested': True, 'ok': False, 'skillProduced': False, 'errorType': type(exc).__name__}
        else: report['exercise'] = {'requested': True, 'ok': False, 'skillProduced': False, 'code': 'live_prerequisites_failed_no_submission'}
        report['ok'] = report['ok'] and report['exercise'].get('ok') is True
    save(root / 'reports/agent-learning-smoke.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exercise', choices=['qiandengji-ops'])
    args = parser.parse_args()
    report = run(exercise_enabled=bool(args.exercise))
    print(json.dumps({'ok': report['ok'], 'checks': report['checks'], 'exercise': report['exercise'],
        'report': str(ROOT / 'reports/agent-learning-smoke.json')}, ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__ == '__main__': raise SystemExit(main())
