"""Explicit recovery of pre-process Cron leases; never replay or certify old work.

Run once inside the existing game QwenPaw container, first without --apply.
Native schedules are paused only during the locked, evidence-backed transition.
The old records stay in the audit and are classified interrupted_without_result.
"""
import argparse
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import uuid

from world_team import TeamStore
from world_team_hosts import native_host
from world_team_schedule import SCHEDULES
from world_operations import JOB_ID


def require(value, reason):
    if not value:
        raise ValueError(reason)


def native(method, route, role, payload=None):
    request = urllib.request.Request('http://127.0.0.1:8088/api' + route,
        headers={'X-Agent-Id': role, 'Content-Type': 'application/json'}, method=method,
        data=json.dumps(payload).encode('utf8') if payload is not None else b'' if method == 'POST' else None)
    with urllib.request.urlopen(request, timeout=15) as response:
        body = response.read(2 * 1024 * 1024 + 1)
    require(len(body) <= 2 * 1024 * 1024, 'native_response_too_large')
    return json.loads(body)


def process_evidence(path=Path('/state/work/learning-runtime.json')):
    marker = json.loads(path.read_text())
    require(marker['runtime'] == 'game', 'wrong_runtime')
    stat = Path('/proc') / str(marker['pid']) / 'stat'
    ticks = int(stat.read_text().rsplit(')', 1)[1].split()[19])
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    require(ticks == marker['processStartTicks'] and boot == marker['bootId'], 'runtime_process_changed')
    command = (stat.parent / 'cmdline').read_bytes().split(b'\0')
    require(b'/survival/game_service.py' in command, 'not_native_game_qwen_process')
    return {key: marker[key] for key in ('pid', 'startedAt', 'processStartTicks', 'bootId')}


def verify_abandoned(record, started_at, live, *, cycle=False):
    require(live.get('status') == 'idle' and live.get('running_task_count') == 0, 'native_role_not_idle')
    if cycle:
        require(record.get('status') in ('running', 'unknown'), 'cycle_not_unresolved')
        stamp = record.get('at')
    else:
        require(record.get('status') == 'cron_reserved' and record.get('taskId') is None,
                'native_task_requires_separate_reconciliation')
        require(record.get('source') == 'native-qwen-world-cron', 'unsupported_reservation')
        stamp = record.get('startedAt')
    require(type(stamp) in (int, float) and stamp < started_at, 'work_not_from_previous_process')


def verify_native_cancelled(trace, record, job, *, cycle=False):
    """Match the native executor's exact job, target session and run interval."""
    require(trace.get('status') == 'cancelled' and trace.get('error') == 'execution cancelled',
            'native_cancellation_not_confirmed')
    verify_native_interval(trace, record, job, cycle=cycle)


def verify_native_rate_limit(trace, record, job, *, cycle=False):
    require(trace.get('status') == 'error'
            and trace.get('error') == "_AcquireTimeoutError('Rate limit exceeded')",
            'native_rate_limit_terminal_not_confirmed')
    verify_native_interval(trace, record, job, cycle=cycle)


def verify_native_interval(trace, record, job, *, cycle=False):
    meta = trace.get('meta', {})
    target = job['dispatch']['target']
    require(meta.get('job_id') == job['id'] and meta.get('task_type') == 'agent'
            and meta.get('target_session_id') == target['session_id']
            and meta.get('target_user_id') == target['user_id'], 'native_cancellation_wrong_job')
    start, end = trace.get('created_at'), trace.get('completed_at')
    require(type(start) in (int, float) and type(end) in (int, float) and start <= end,
            'native_cancellation_invalid_interval')
    if cycle:
        require(record.get('status') == 'unknown' and 0 <= record['at'] - end <= 5,
                'native_cancellation_wrong_cycle')
    else:
        require(record.get('status') == 'cron_reserved' and record.get('taskId') is None
                and record.get('jobId') == job['id'] and 0 <= start - record['startedAt'] <= 5,
                'native_cancellation_wrong_reservation')


def reconciliation_evidence(record, job, started_at, live, trace=None, *, cycle=False):
    require(live.get('status') == 'idle' and live.get('running_task_count') == 0, 'native_role_not_idle')
    if trace and trace.get('meta', {}).get('job_id') == job['id']:
        if trace.get('status') == 'error':
            verify_native_rate_limit(trace, record, job, cycle=cycle)
            return {'terminalEvidence': 'exact_native_rate_limit_trace_and_current_idle',
                    'nativeTraceId': trace['run_id']}
        verify_native_cancelled(trace, record, job, cycle=cycle)
        return {'terminalEvidence': 'exact_native_cancelled_trace_and_current_idle', 'nativeTraceId': trace['run_id']}
    verify_abandoned(record, started_at, live, cycle=cycle)
    return {'terminalEvidence': 'previous_native_process_ended_and_current_idle'}


def save_audit(path, value):
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'linked_audit_path')
    body = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf8') as handle:
        import os
        handle.write(body)
        handle.flush()
        os.fsync(handle.fileno())
    temp.replace(path)


@contextmanager
def read_reservations():
    import fcntl
    from operations_native_tasks import STATE
    with (STATE / 'operations-budget/lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield json.loads((STATE / 'operations-budget/delegations.json').read_text())


def restore_schedules(intents, jobs, roles, specs, call=native):
    restored, errors = [], []
    for actor in intents:
        role, route = roles[actor]['agentId'], '/cron/jobs/' + jobs[actor]
        try:
            observed = call('GET', route, role)
            original = specs[actor]['spec']
            require(observed['spec'] | {'enabled': True} == original, 'schedule_changed_during_reconciliation')
            # Qwen 2.2 resume only updates an already registered scheduler job.
            # A workspace reloaded while paused needs the same ID/spec rearmed.
            call('PUT', route, role, original)
            verified = call('GET', route, role)
            require(verified['spec'] == original and verified['state'].get('next_run_at') is not None,
                    'native_schedule_not_rearmed')
            restored.append({'host': roles[actor], 'jobId': jobs[actor],
                             'nextRunAt': verified['state']['next_run_at']})
        except Exception as error:
            # Try each other schedule once, without retrying an uncertain PUT.
            errors.append({'host': roles[actor], 'jobId': jobs[actor], 'errorType': type(error).__name__})
    return restored, errors


def pause_schedule(actor, jobs, roles, intents, checkpoint, call=native):
    intents.append(actor)
    checkpoint()
    call('POST', '/cron/jobs/' + jobs[actor] + '/pause', roles[actor]['agentId'])


def reconcile(apply=False, cancelled_trace=None, terminal_trace=None):
    import fcntl
    from operations_native_tasks import ledger, TERMINAL
    process = process_evidence()
    jobs = {actor: SCHEDULES[actor][0] for actor in SCHEDULES}
    jobs['operations:default'] = JOB_ID
    roles = {actor: native_host(actor) for actor in jobs}
    require(all(host['runtime'] == 'game' for host in roles.values()), 'team_not_on_game_runtime')
    specs = {actor: native('GET', '/cron/jobs/' + job, roles[actor]['agentId']) for actor, job in jobs.items()}
    audit = {'schema': 1, 'purpose': 'operator-operations-cron-reconciliation',
        'createdAt': datetime.now(timezone.utc).isoformat(), 'process': process, 'applied': False,
        'oldResult': 'unknown', 'oldWorkReplayed': False, 'modelRequests': 0, 'worldActions': 0,
        'cycles': [], 'reservations': [], 'native': {}, 'restoredJobs': [], 'restoreErrors': [],
        'pauseIntents': [], 'pauseAcknowledged': [], 'evidenceByRecord': {}}
    trace = None
    require(not (cancelled_trace and terminal_trace), 'choose_one_native_trace')
    trace_id = cancelled_trace or terminal_trace
    if trace_id:
        require(str(uuid.UUID(trace_id)) == trace_id, 'invalid_native_trace_id')
        path = Path('/state/work/inbox_traces') / (trace_id + '.json')
        require(not any(p.is_symlink() for p in (path, *path.parents)), 'linked_native_trace')
        trace = json.loads(path.read_text())
        require(trace.get('run_id') == trace_id, 'native_trace_identity_mismatch')
        audit['nativeCancellationTrace' if cancelled_trace else 'nativeTerminalTrace'] = trace
    paused = audit['pauseIntents']
    report = None
    if apply:
        recovery_id = 'operations-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8]
        folder = Path('/state/recovery/operations-cycles')
        folder.mkdir(parents=True, exist_ok=True)
        report = folder / (recovery_id + '.json')
        audit['recoveryId'] = recovery_id
        save_audit(report, audit)
    try:
        if apply:
            for actor, spec in specs.items():
                if spec['spec']['enabled']:
                    pause_schedule(actor, jobs, roles, paused, lambda: save_audit(report, audit))
                    audit['pauseAcknowledged'].append(actor)
        with ExitStack() as stack:
            for actor in SCHEDULES:
                lock = stack.enter_context((Path('/team') / ('cycle-' + actor.replace(':', '-') + '.lock')).open('a+b'))
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for actor in jobs:
                role = roles[actor]['agentId']
                status = native('GET', '/agents/' + role + '/agent-status', role)
                state = native('GET', '/cron/jobs/' + jobs[actor] + '/state', role)
                require(status.get('status') == 'idle' and status.get('running_task_count') == 0,
                        'native_role_not_idle')
                require(state.get('last_status') != 'running', 'native_cron_still_running')
                audit['native'][actor] = {'host': roles[actor], 'status': status, 'cronState': state}
            require(process_evidence() == process, 'runtime_process_changed')
            for actor in SCHEDULES:
                value = TeamStore(actor).cycle_state()
                if value and value['status'] in ('running', 'unknown'):
                    evidence = reconciliation_evidence(value, specs[actor]['spec'], process['startedAt'],
                        audit['native'][actor]['status'], trace, cycle=True)
                    audit['evidenceByRecord']['cycle:' + actor] = evidence
                    audit['cycles'].append(value)
            with (ledger() if apply else read_reservations()) as rows:
                for row in rows:
                    if row.get('status') in TERMINAL:
                        continue
                    actor = 'operations:' + row['role']
                    require(actor in jobs and row.get('jobId') == jobs[actor], 'unsupported_pending_job')
                    require(row.get('nativeHost') == roles[actor], 'reservation_host_not_verified')
                    evidence = reconciliation_evidence(row, specs[actor]['spec'], process['startedAt'],
                        audit['native'][actor]['status'], trace)
                    audit['evidenceByRecord']['reservation:' + row['runId']] = evidence
                    audit['reservations'].append(dict(row))
                if apply:
                    before = report.with_suffix('.before.json')
                    save_audit(before, audit)
                    evidence_sha = hashlib.sha256(before.read_bytes()).hexdigest()
                    details = {'operatorReconciliation': recovery_id, 'executionOutcome': 'interrupted_without_result',
                        'originalResultKnown': False, 'oldWorkReplayed': False,
                        'beforeEvidenceSha256': evidence_sha, 'beforeEvidencePath': str(before)}
                    for old in audit['cycles']:
                        per_record = details | audit['evidenceByRecord']['cycle:' + old['actor']]
                        TeamStore(old['actor']).save_cycle(old['fingerprint'], 'failed', dict(per_record,
                            originalStatus=old['status'], originalAt=old['at'], jobId=jobs[old['actor']]))
                    pending_ids = {r['runId'] for r in audit['reservations']}
                    for row in rows:
                        if row.get('runId') in pending_ids:
                            per_record = details | audit['evidenceByRecord']['reservation:' + row['runId']]
                            row.update(status='failed', finishedAt=time.time(), **per_record)
            if apply:
                audit['applied'] = True
    except BaseException as error:
        audit['errorType'] = type(error).__name__
        raise
    finally:
        audit['restoredJobs'], audit['restoreErrors'] = restore_schedules(paused, jobs, roles, specs)
        if report:
            save_audit(report, audit)
    require(not audit['restoreErrors'], 'native_schedule_restore_incomplete')
    audit['auditFile'] = str(report) if report else None
    return audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--cancelled-trace', help='Exact native cancelled trace UUID for a current-process reload')
    parser.add_argument('--terminal-trace', help='Exact finalized native model-permit timeout trace UUID')
    args = parser.parse_args()
    print(json.dumps(reconcile(args.apply, args.cancelled_trace, args.terminal_trace), ensure_ascii=False))
