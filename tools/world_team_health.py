"""Read-only world-team smoke: native APIs, private metadata and domain receipts.

Runs no model, MCP invocation, cron trigger, game action or repair. Only the
sanitized report is written. A successful tool transport is not domain success;
an engineering baseline is not evidence that an Agent's candidate was deployed.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar')]
PORTS = {'game': 18089, 'operations': 18090}
CONTENT_ID = 'content-fd5881ee422e68c006ecc176'
BASELINE_ID = 'world-team-baseline-20260909'
SOURCE_FILES = ('world/ops/world_team.py', 'world/ops/world_team_mcp.py',
    'world/ops/world_team_hosts.py', 'world/ops/cron_guard.py',
    'world/ops/world_team_profiles.py', 'world/ops/world_team_schedule.py',
    'world/ops/world_admin_tools.py', 'world/sidecar/world_admin_consumer.py',
    'world/sidecar/world_content.py', 'world/sidecar/npc_planner.py',
    'world/ops/engineering_workspace.py', 'world/ops/engineering_mcp.py', 'world/admin/engineering-runner.mjs',
    'world/ops/health/health_mon.py', 'tools/world_team_health.py', 'tools/configure_world_team.py',
    'tests/test_world_team_smoke.py', 'tests/test_world_team_hosts.py', 'tests/test_world_team_provisioning_host.py')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def safe(path):
    path = Path(path)
    require(not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                    for p in (path, *path.parents)), 'linked_smoke_input')
    return path


def read(path, maximum=262144):
    with safe(path).open('rb') as stream:
        value = stream.read(maximum + 1)
    require(len(value) <= maximum, 'smoke_input_too_large')
    return json.loads(value.decode('utf-8-sig'))


def sha(path):
    return hashlib.sha256(safe(path).read_bytes()).hexdigest()


def api(runtime, route, role):
    require(runtime in PORTS and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', role), 'invalid_native_actor')
    # There is deliberately no method/payload argument; every request is GET.
    require((route.startswith(('/agents', '/mcp/', '/skills', '/cron/jobs/'))
             or re.fullmatch(r'/console/chat/task/task-[a-f0-9]{12}', route))
            and not any(word in route for word in ('/run', '/resume', '/pause', '?', '#', '..')),
            'read_only_route_required')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('native_redirect_refused')
    request = urllib.request.Request(f'http://127.0.0.1:{PORTS[runtime]}/api' + route,
                                    headers={'X-Agent-Id': role}, method='GET')
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=8) as response:
        value = response.read(2097153)
    require(len(value) <= 2097152, 'native_response_too_large')
    return json.loads(value)


@contextmanager
def database(path):
    path = safe(path).resolve()
    require(path.is_file(), 'smoke_database_missing')
    # Never instantiate TeamStore/AdminStore: their constructors create tables.
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=3)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        yield db
    finally:
        db.close()


def session_metadata(document):
    """Ignore all text/thinking, tool arguments/outputs and private error text."""
    context = document['agent']['state']['context']
    require(isinstance(context, list) and len(context) <= 10000, 'cron_session_invalid')
    messages, tools, totals = [], [], {}
    for message in context:
        if message.get('role') != 'assistant':
            continue
        usage = message.get('usage') or {}
        projected = {}
        for key in ('input_tokens', 'output_tokens', 'cache_input_tokens', 'cache_creation_input_tokens'):
            value = usage.get(key)
            if type(value) is int and value >= 0:
                projected[key] = value
                totals[key] = totals.get(key, 0) + value
        messages.append({'createdAt': message.get('created_at'), 'finishedAt': message.get('finished_at'),
                         'hasError': bool(message.get('error')), 'usage': projected})
        for block in message.get('content', []):
            if isinstance(block, dict) and block.get('type') in ('tool_call', 'tool_result'):
                name = block.get('name')
                require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,180}', name), 'invalid_trace_tool_name')
                tools.append({'name': name, 'kind': block['type'], 'state': block.get('state'),
                              'createdAt': block.get('created_at'), 'finishedAt': block.get('finished_at')})
    require(len(tools) <= 10000, 'cron_trace_too_large')
    return {'assistantMessages': messages, 'tools': tools, 'usage': totals,
            'modelUsageObserved': any(row['usage'].get('input_tokens', 0) > 0 for row in messages),
            'toolExecutionObserved': any(row['kind'] == 'tool_result' for row in tools),
            'domainSuccessFromToolState': False,
            'scope': 'Historical dedicated cron session; usage includes its saved messages, not a new-call delta. No final answer/body result is inferred.'}


def team_metadata(path, inventory):
    with database(path) as db:
        count = db.execute('SELECT count(*) FROM cases').fetchone()[0]
        require(count <= 2000, 'team_case_limit')
        rows = [dict(r) for r in db.execute(
            'SELECT id,author,owner,status,version,updated_at FROM cases ORDER BY updated_at DESC')]
        cycles = [dict(r) for r in db.execute('SELECT actor,status,at FROM cycles')]
    for row in rows:
        require(row['author'] in inventory and row['owner'] in inventory
                and row['status'] in ('open', 'working', 'blocked', 'needs_review', 'resolved', 'duplicate')
                and type(row['version']) is int and row['version'] >= 1, 'team_case_identity_invalid')
    require(all(r['actor'] in inventory and r['status'] in ('running', 'completed', 'failed', 'unknown')
                for r in cycles), 'team_cycle_identity_invalid')
    return {'caseCount': count, 'cases': rows[:100], 'casesTruncated': count > 100, 'cycles': cycles,
            'privateCaseTextIncluded': False}


def admin_metadata(path):
    with database(path) as db:
        counts = {r['status']: r['n'] for r in db.execute('SELECT status,count(*) n FROM requests GROUP BY status')}
        rows = list(db.execute('SELECT id,actor,kind,status,receipt FROM requests ORDER BY created DESC LIMIT 1000'))
    result, confirmed = [], 0
    for row in rows:
        receipt = json.loads(row['receipt'] or '{}')
        status = 'unknown' if row['status'] == 'claimed' else row['status']
        domain = (status == 'completed' and receipt.get('ok') is True
                  and receipt.get('executionConfirmed') is True and row['actor'] == 'game:mc-god'
                  and row['kind'] in ('rule', 'time', 'weather'))
        confirmed += domain
        result.append({'requestId': row['id'], 'actor': row['actor'], 'operation': row['kind'],
            'status': status, 'code': receipt.get('code'), 'executionConfirmed': domain,
            'updatedAt': receipt.get('updatedAt')})
    return {'counts': counts, 'receipts': result[:30], 'receiptWindow': len(rows),
            'confirmedMutationsInWindow': confirmed, 'allHistoricalRowsIncluded': sum(counts.values()) <= 1000,
            'notice': 'Completed diagnostics are observations, not world mutations; claimed/unknown writes remain unresolved.'}


def content_metadata(root):
    from world_content import episode_lines
    folder = root / 'server/team-state/content'
    receipt = read(folder / 'receipts' / (CONTENT_ID + '.json'))
    published = read(folder / 'published' / (CONTENT_ID + '.json'))
    require(receipt.get('schema') == 1 and receipt.get('contentId') == CONTENT_ID
            and published.get('contentId') == CONTENT_ID and receipt.get('status') == 'published'
            and receipt.get('date') == published.get('date')
            and receipt.get('questIds') == published.get('questIds'), 'content_publication_mismatch')
    day = receipt['date']
    require(re.fullmatch(r'\d{4}-\d{2}-\d{2}', day), 'content_day_invalid')
    board = read(root / 'server/mcdata/village' / ('guild-' + day + '.json'))
    lines = episode_lines(board, state=root / 'server/team-state')
    require(lines and len(lines) <= 40 and sum(len(line) for line in lines) <= 6000, 'published_story_lines_unavailable')
    return {'contentId': CONTENT_ID, 'status': 'published', 'date': day, 'questIds': receipt['questIds'],
            'publishedAt': receipt.get('publishedAt'), 'newContracts': receipt.get('newContracts'),
            'referencedContracts': receipt.get('referencedContracts'), 'published_story_lines': lines,
            'playerCompletionVerified': False, 'receiptSha256': sha(folder / 'receipts' / (CONTENT_ID + '.json'))}


def engineering_metadata(root):
    from engineering_workspace import canonical, digest, relative
    folder = root / 'server/engineering'
    request = read(folder / 'requests' / (BASELINE_ID + '.json'))
    receipt = read(folder / 'receipts' / (BASELINE_ID + '.json'))
    config = read(folder / 'config.json')
    plan = next(p for p in config['plans'] if p['id'] == receipt['planId'])
    require(receipt.get('schema') == 1 and receipt.get('jobId') == BASELINE_ID
            and receipt.get('role') == 'mc-god'
            and all(receipt.get(k) == request.get(k) for k in
                    ('jobId', 'sourceSha256', 'planSha256', 'baseCommit', 'branch', 'head', 'planId')),
            'engineering_receipt_identity_mismatch')
    require(receipt.get('status') == 'passed' and receipt.get('exitCode') == 0
            and receipt.get('containerRemoved') is True and receipt.get('imageId') == plan['image']
            and receipt.get('planSha256') == digest(canonical(plan)), 'engineering_baseline_not_passed')
    source_sha = receipt['sourceSha256']
    require(re.fullmatch(r'[a-f0-9]{64}', source_sha), 'engineering_hash_invalid')
    snapshot = folder / 'snapshots' / source_sha
    manifest = read(snapshot / 'manifest.json', 4194304)
    require(manifest.get('sourceSha256') == source_sha and digest(canonical(manifest['entries'])) == source_sha,
            'engineering_snapshot_mismatch')
    for name, expected in plan['checks'].items():
        require(sha(snapshot / 'source' / relative(name)) == expected, 'engineering_fixed_test_mismatch')
    counts = re.findall(r'Ran ([0-9]+) tests? in ', receipt.get('log', ''))
    return {'jobId': BASELINE_ID, 'status': 'passed', 'exitCode': 0, 'fixedChecksVerified': len(plan['checks']),
            'testsReported': int(counts[-1]) if counts else None, 'sourceSha256': source_sha,
            'imageId': receipt['imageId'], 'finishedAt': receipt.get('finishedAt'),
            'candidateFixDeployed': 'not_verified',
            'scope': 'Recorded isolated baseline, matching request/plan/snapshot manifest and fixed test files; no new test or deployment was run.'}


def recent_tasks(root, request=api):
    """Last two model-task IDs from bounded append-only metadata, not chat text."""
    path = root / 'server/survival-agent-state/survival/episodes.jsonl'
    with safe(path).open('rb') as stream:
        stream.seek(0, 2); size = stream.tell()
        stream.seek(max(0, size - 2097152))
        raw = stream.read(2097152)
    if size > len(raw):
        raw = raw.partition(b'\n')[2]
    rows, seen = [], set()
    for line in reversed(raw.splitlines()):
        try:
            row = json.loads(line)
        except ValueError:
            continue  # A concurrently appended incomplete line is not evidence.
        task_id = row.get('taskId')
        if not isinstance(task_id, str) or not re.fullmatch(r'task-[a-f0-9]{12}', task_id) or task_id in seen:
            continue
        seen.add(task_id)
        result = {'taskId': task_id, 'turnId': row.get('turnId'), 'recordedAt': row.get('at'),
                  'recordedResultStatus': row.get('resultStatus')}
        try:
            native = request('game', '/console/chat/task/' + task_id, 'qd-survivor')
            terminal = native.get('result') or {}
            error = terminal.get('error') or {}
            code = error.get('code') if isinstance(error, dict) else None
            result.update(nativeAvailable=True, nativeStatus=native.get('status'),
                          resultStatus=terminal.get('status'), failureCode=code if isinstance(code, str) and
                          re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', code) else None)
        except Exception as exc:
            result.update(nativeAvailable=False, readErrorType=type(exc).__name__)
            if isinstance(exc, urllib.error.HTTPError):
                result['httpStatus'] = exc.code
        rows.append(result)
        if len(rows) == 2:
            break
    return rows


def survivor_metadata(root, clock=time.time, request=api):
    folder = root / 'server/survival-agent-state/survival'
    session, settings = read(folder / 'life-session.json'), read(folder / 'settings.json')
    control, controller = read(folder / 'control.json'), read(folder / 'controller.json', 2097152)
    public = read(root / 'server/panel-state/survivor.json', 2097152)
    require(session.get('agentId') == 'qd-survivor' and session.get('bodyUuid') == settings.get('bodyUuid')
            and session.get('userId') == 'survival-controller' and session.get('channel') == 'console'
            and re.fullmatch(r'life-[a-f0-9]{32}', session.get('primarySessionId', '')), 'survivor_life_identity_mismatch')
    active = controller.get('active') or {}
    body = public.get('body') or {}
    return {'bodyUuid': session['bodyUuid'], 'bodyName': settings.get('bodyName'),
        'agentId': session['agentId'], 'primarySessionId': session['primarySessionId'], 'chatId': session.get('chatId'),
        'userId': session['userId'], 'channel': session['channel'], 'enabled': control.get('enabled') is True,
        'pauseReason': control.get('pauseReason'), 'status': controller.get('status'), 'consecutiveFailures': controller.get('failures'),
        'activeTask': {key: active.get(key) for key in ('taskId', 'turnId', 'submittedAt', 'deadline')} if active else None,
        'bodyOnline': body.get('online'), 'bodyObservedAt': body.get('observedAt'),
        'leaseStatus': read(folder / 'lease.json').get('status'), 'unknownActionRecorded': (folder / 'unknown.json').exists(),
        'recentNativeTasks': recent_tasks(root, request),
        'stateSampledAt': clock(), 'notice': 'Point-in-time metadata; idle or active alone does not establish successful autonomous gameplay.'}


def process_probe(root):
    spec = importlib.util.spec_from_file_location('qd_team_existing_health', root / 'world/ops/health/health_mon.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.probe_world_team()


def member_identity(actor, inventory):
    """Names follow the current trusted roster; never infer identity from a name."""
    return {'actor': actor, 'displayName': inventory[actor][0]}


def collect(root=ROOT, request=api, probe=process_probe):
    from world_team import members
    from world_team_hosts import native_inventory, host_config
    from world_team_profiles import check_api
    from world_team_schedule import SCHEDULES, team_job, validate_team_job
    from role_learning_profiles import role_skills
    from native_role_capabilities import NATIVE_SKILLS
    root = Path(root)
    os.environ.setdefault('MAID_ROLES_MANIFEST_FILE', str(root / 'server/mcdata/village/maid-agents/public/roles.json'))
    os.environ.setdefault('PARTY_ROLES_MANIFEST_FILE', str(root / 'server/mcdata/village/party/public/roles.json'))
    os.environ.setdefault('TEAM_RUNTIME_HOSTS_FILE', str(root / 'server/team-state/runtime-hosts.json'))
    inventory = members()
    hosts = native_inventory(inventory)
    report = {'schema': 1, 'project': 'qiandengji', 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'modelRequests': 0, 'worldActions': 0, 'cronTriggers': 0, 'mcpInvocations': 0,
        'checks': {}, 'roles': [], 'nativeSchedules': [], 'sections': {}, 'errors': {},
        'nativeHostPhase': host_config()['phase'],
        'sourceHashes': {name: sha(root / name) for name in SOURCE_FILES}}
    def stage(name, fn):
        try:
            value = fn(); report['checks'][name] = True; return value
        except Exception as error:
            report['checks'][name] = False
            # Exception messages can contain private tool outputs or paths.
            report['errors'][name] = type(error).__name__
            return None
    refs = {runtime: stage(runtime + '-agents', lambda runtime=runtime:
            request(runtime, '/agents', 'mc-god' if runtime == 'game' else 'default')['agents']) for runtime in PORTS}
    for runtime, rows in refs.items():
        expected = {row['agentId'] for row in hosts.values() if row['runtime'] == runtime}
        report['checks'][runtime + '-agents'] = isinstance(rows, list) and {
            row['id'] for row in rows if row.get('enabled') is True} == expected
    for actor in inventory:
        runtime, role = hosts[actor]['runtime'], hosts[actor]['agentId']
        def role_check():
            require(any(r['id'] == role and r.get('enabled') is True for r in refs[runtime] or []), 'role_not_enabled')
            check_api(lambda route: request(runtime, route, role), role, runtime)
            skills = request(runtime, '/skills', role)
            required = set(role_skills(role, runtime)) | set(NATIVE_SKILLS)
            actual = sorted(s['name'] for s in skills if s.get('enabled') is True)
            require(required <= set(actual), 'role_skills_missing')
            return member_identity(actor, inventory) | {'nativeHost': hosts[actor],
                'nativeBindingsVerified': True, 'enabledSkills': actual}
        result = stage('role:' + actor, role_check)
        report['roles'].append(result or member_identity(actor, inventory) | {'nativeBindingsVerified': False})
    for actor in SCHEDULES:
        runtime, role = hosts[actor]['runtime'], hosts[actor]['agentId']
        def schedule_check():
            expected = team_job(actor); job_id = expected['id']
            row = request(runtime, '/cron/jobs/' + job_id, role)
            validate_team_job(row['spec'], actor)
            require(row['spec']['enabled'] is True, 'team_schedule_disabled')
            history = request(runtime, '/cron/jobs/' + job_id + '/history', role)
            require(isinstance(history, list) and len(history) <= 10000, 'cron_history_invalid')
            state = row['state']
            folder = root / ('server/agents' if runtime == 'game' else 'server/operations-agent-state') / 'work/workspaces' / role
            target = expected['dispatch']['target']
            filename = target['user_id'] + '_' + target['session_id'] + '--cron--' + job_id + '.json'
            session = folder / 'sessions/console' / filename
            trace = session_metadata(read(session, 4194304)) if session.exists() else None
            return member_identity(actor, inventory) | {'nativeHost': hosts[actor], 'jobId': job_id, 'enabled': True, 'specExact': True,
                'schedule': row['spec']['schedule'], 'sessionId': target['session_id'], 'userId': target['user_id'],
                'nativeState': {k: state.get(k) for k in ('next_run_at', 'last_run_at', 'last_status')}
                    | {'hasError': bool(state.get('last_error'))},
                'history': [{k: h.get(k) for k in ('run_at', 'status', 'trigger')} | {'hasError': bool(h.get('error'))}
                            for h in history[:30]], 'historyTruncated': len(history) > 30, 'dedicatedSession': trace}
        result = stage('schedule:' + actor, schedule_check)
        report['nativeSchedules'].append(result or member_identity(actor, inventory) | {'specExact': False})
    for name, fn in (('team-ledger', lambda: team_metadata(root / 'server/team-state/team.sqlite3', inventory)),
                     ('admin-receipts', lambda: admin_metadata(root / 'server/team-state/admin/requests.sqlite3')),
                     ('published-story', lambda: content_metadata(root)), ('engineering-baseline', lambda: engineering_metadata(root)),
                     ('survivor-life', lambda: survivor_metadata(root, request=request)), ('process-health', lambda: probe(root))):
        report['sections'][name] = stage(name, fn)
    report['checks']['process-health'] = report['checks']['process-health'] and report['sections']['process-health'].get('ok') is True
    report['configurationReady'] = all(v for k, v in report['checks'].items()
                                       if k.startswith(('role:', 'schedule:')) or k.endswith('-agents'))
    report['historicalModelAndToolsObserved'] = all((row.get('dedicatedSession') or {}).get('modelUsageObserved')
        and (row.get('dedicatedSession') or {}).get('toolExecutionObserved') for row in report['nativeSchedules'])
    report['survivorAutonomousEnabled'] = (report['sections'].get('survivor-life') or {}).get('enabled')
    report['ok'] = all(report['checks'].values())
    report['scope'] = 'Configuration, current supervised consumers, historical native tool/usage metadata and separate domain receipts. No assertion that all candidate fixes are deployed or all agents act autonomously.'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'reports/world-team-smoke.json')
    args = parser.parse_args()
    report = collect()
    output = safe(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'roles': len(report['roles']), 'configurationReady': report['configurationReady'],
        'historicalModelAndToolsObserved': report['historicalModelAndToolsObserved'],
        'survivorAutonomousEnabled': report['survivorAutonomousEnabled'],
        'failedChecks': [k for k, v in report['checks'].items() if not v], 'output': str(output),
        'modelRequests': 0, 'worldActions': 0}, ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
