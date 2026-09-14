"""Scoped no-deadline adapter for the pinned native engineering Cron executor.

QwenPaw 2.2.0 persists only positive timeout_seconds values. The explicit job
metadata is the authority for this single project's engineering deadline; an
in-memory copy gives native asyncio.wait_for a real None timeout. The persisted
schema, shared asyncio module, scheduler, model and stream watchdog stay native.
"""
from copy import copy
import hashlib
import inspect
import json
import math
import os
from pathlib import Path
import re
from types import SimpleNamespace
import time

VERSION = 1
ACTOR = 'operations:mc-god'
JOB_ID = 'qd-team-engineer'
POLICY = {'version': VERSION, 'totalTimeout': 'none', 'scope': JOB_ID}
EXECUTOR_SOURCE_SHA256 = '193bd03f2a74a46e75e5608c4ac3107ee2a9642d9182b76c1450745e8d0c7caf'


def check_native_contract(execute):
    if hashlib.sha256(inspect.getsource(execute).encode()).hexdigest() != EXECUTOR_SOURCE_SHA256:
        raise ValueError('review_engineering_native_timeout_contract')


def execution_policy(spec, actor):
    """Project the actual deadline, explicitly labeling the schema-only value."""
    unlimited = actor == ACTOR and spec.get('id') == JOB_ID
    if unlimited and spec.get('meta', {}).get('engineeringExecution') != POLICY:
        raise ValueError('engineering_execution_policy_missing')
    return {'policy': 'no_total_deadline' if unlimited else 'native_deadline',
            'effectiveTimeoutSeconds': None if unlimited else spec['runtime']['timeout_seconds'],
            'nativeSchemaTimeoutSeconds': spec['runtime']['timeout_seconds'],
            'nativeSchemaTimeoutIsEffective': not unlimited,
            'maxConcurrency': spec['runtime']['max_concurrency'],
            'streamWatchdogChanged': False}


def execution_job(job, actor):
    spec = job.model_dump(mode='json', exclude_none=True)
    policy = execution_policy(spec, actor)
    if policy['effectiveTimeoutSeconds'] is not None:
        return job
    # Only execution gets a copy. Never save it through native Cron APIs: those
    # correctly reject None. Existing job/session/model/dispatch stay identical.
    runtime = getattr(job, 'runtime', None)
    if runtime is None:
        runtime = SimpleNamespace(**spec['runtime'])  # structural test fixtures
    if callable(getattr(runtime, 'model_copy', None)):
        runtime = runtime.model_copy(update={'timeout_seconds': None})
    else:
        runtime = copy(runtime)
        runtime.timeout_seconds = None
    if callable(getattr(job, 'model_copy', None)):
        return job.model_copy(update={'runtime': runtime})
    effective = copy(job)
    effective.runtime = runtime
    return effective


def running_ownership(cycle, reservations, *, native_running, lock_owned, now):
    """Correlate the existing original cycle/lease, not merely its age or label."""
    pending = [row for row in reservations if row.get('status') not in ('completed', 'failed', 'cancelled')]
    reservation = pending[0] if len(pending) == 1 else {}
    at, started = cycle.get('at'), reservation.get('startedAt')
    numbers = all(type(value) in (int, float) and math.isfinite(value) for value in (at, started, now))
    checks = {'nativeCronRunning': native_running is True, 'guardOwnsCycleLock': lock_owned is True,
              'cycleIdentity': cycle.get('actor') == ACTOR and cycle.get('status') == 'running'
                   and cycle.get('result') == {'jobId': JOB_ID},
              'originalReservation': len(pending) == 1 and reservation.get('status') == 'cron_reserved'
                   and reservation.get('role') == 'mc-god' and reservation.get('jobId') == JOB_ID
                   and reservation.get('nativeHost') == {'runtime': 'game', 'agentId': 'qd-engineer'}
                   and reservation.get('source') == 'native-qwen-world-cron'
                   and isinstance(reservation.get('runId'), str)
                   and reservation.get('requestId') == reservation.get('runId')
                   and reservation.get('taskId') is None,
              # reserve_operation returns directly before save_cycle. This is
              # correlation between their original starts, not a run deadline.
              'startOwnership': numbers and 0 <= at - started <= 30 and -5 <= now - at}
    return {'verified': all(checks.values()), 'checks': checks, 'checkedAt': now,
            'actor': ACTOR, 'jobId': JOB_ID, 'cycleStartedAt': at,
            'reservationRunId': reservation.get('runId'), 'reservationStartedAt': started,
            'status': 'running' if all(checks.values()) else 'not_verified'}


def guard_owns_cycle_lock(path, marker, proc):
    """Kernel lock ownership ties the live guarded Qwen PID to this cycle file."""
    path, proc = Path(path), Path(proc)
    if not path.is_file() or path.is_symlink():
        return False
    stat = path.stat()
    expected = (os.major(stat.st_dev), os.minor(stat.st_dev), stat.st_ino)

    def matches(line, kind):
        fields = line.split()
        if len(fields) != 8 or fields[1:4] != [kind, 'ADVISORY', 'WRITE']:
            return False
        device = fields[5].split(':')
        try:
            return (len(device) == 3 and int(fields[4]) == marker['pid']
                and (int(device[0], 16), int(device[1], 16), int(device[2])) == expected
                and fields[6:8] == ['0', 'EOF'])
        except ValueError:
            return False

    global_locks = (proc / 'locks').read_text().splitlines()
    if any(matches(line, 'FLOCK') for line in global_locks):
        return True
    # Docker Desktop's production /team mount reports our fcntl.flock as a
    # POSIX lock. Require both the global kernel record AND lock evidence on
    # an open descriptor of this exact guarded process/file. Merely opening
    # the lock file, another process's lock or a byte-range lock is not proof.
    if not any(matches(line, 'POSIX') for line in global_locks):
        return False
    process = proc / str(marker['pid'])
    for descriptor in (process / 'fd').iterdir():
        if not descriptor.name.isdecimal():
            continue
        try:
            def same_file():
                current = descriptor.stat()
                return (os.major(current.st_dev), os.minor(current.st_dev), current.st_ino) == expected
            if not same_file():
                continue
            lines = (process / 'fdinfo' / descriptor.name).read_text().splitlines()
            held = any(matches(line.removeprefix('lock:').strip(), 'POSIX')
                       for line in lines if line.startswith('lock:'))
            if held and same_file():
                return True
        except (FileNotFoundError, ProcessLookupError):
            # Descriptor closure/reuse during observation is not ownership.
            continue
    return False


def native_job_view():
    import urllib.request
    request = urllib.request.Request('http://127.0.0.1:8088/api/cron/jobs/' + JOB_ID,
        headers={'X-Agent-Id': 'qd-engineer', 'Accept': 'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise ValueError('engineering_native_state_too_large')
    return json.loads(raw)


def native_running_marker(state):
    """Qwen 2.2 overwrites running with skipped when APS rejects overlap.

    This marker alone is never proof of a live run. The same guard PID must
    still hold the original cycle lock and own its original reservation.
    """
    if state.get('last_status') == 'running':
        return 'running'
    error = state.get('last_error')
    if (state.get('last_status') == 'skipped' and isinstance(error, str)
            and re.fullmatch(r'skipped scheduled run at \S+: maximum running instances reached \(1\)', error)):
        return 'max_instances_while_cycle_owned'
    return None


def health(state=Path('/state/work'), proc=Path('/proc'), *, include_running=False,
           team=Path('/team'), ledger=Path('/operations-state/operations-budget/delegations.json'),
           native=native_job_view, clock=time.time):
    from role_learning_profiles import read_safe, validate_guard
    state = Path(state)
    validate_guard(state, 'game', proc)
    marker = read_safe(state / 'learning-runtime.json')
    if marker.get('engineeringCronRuntimeVersion') != VERSION:
        raise ValueError('engineering_no_deadline_adapter_not_loaded')
    document = read_safe(state / 'workspaces/qd-engineer/jobs.json')
    job = next(row for row in document['jobs'] if row['id'] == JOB_ID)
    from world_team_schedule import validate_team_job
    validate_team_job(job, ACTOR)
    result = {'ok': True, 'jobId': JOB_ID, 'agentId': 'qd-engineer', 'enabled': job['enabled'],
              'adapterVersion': VERSION, **execution_policy(job, ACTOR), 'modelCalls': 0, 'worldActions': 0}
    if include_running:
        import sqlite3
        from contextlib import closing
        path = Path(team) / 'team.sqlite3'
        if any(p.is_symlink() for p in (path, *path.parents)):
            raise ValueError('linked_engineering_cycle')
        with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            db.execute('PRAGMA query_only=ON')
            db.row_factory = sqlite3.Row
            row = db.execute('SELECT actor,status,at,result FROM cycles WHERE actor=?', (ACTOR,)).fetchone()
        cycle = dict(row) if row is not None else {}
        if cycle:
            cycle['result'] = json.loads(cycle['result'])
        reservations = read_safe(ledger)
        if not isinstance(reservations, list) or not all(isinstance(row, dict) for row in reservations):
            raise ValueError('invalid_engineering_reservations')
        current = native()
        validate_team_job(current['spec'], ACTOR)
        if current['spec'] != job:
            raise ValueError('engineering_native_job_not_current')
        owned = guard_owns_cycle_lock(Path(team) / 'cycle-operations-mc-god.lock', marker, proc)
        native_marker = native_running_marker(current.get('state', {}))
        result['runningEvidence'] = running_ownership(cycle, reservations,
            native_running=native_marker is not None,
            lock_owned=owned, now=clock())
        result['runningEvidence']['nativeStateMarker'] = native_marker
    return result


if __name__ == '__main__':
    import sys
    print(json.dumps(health(include_running='--running' in sys.argv[1:]), ensure_ascii=False))
