"""Bounded adapter to QwenPaw's native background-task API, not another agent runtime."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
import uuid
import httpx

STATE = Path(os.environ.get('QIANDENG_OPERATIONS_STATE_DIR', '/state'))
# Only the engineer retains the operations report contract after consolidation.
# Planner and survivor work uses their existing team/planning/life entry points;
# a second background chat must not bypass the survivor's session and lease.
SPECIALISTS = ('mc-god',)
# Old task IDs/hosts remain queryable without granting new execution authority.
RECORDED_ROLES = ('default', 'mc-god', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto')
COOLDOWN = 0
DAILY_LIMIT = None
TASK_TIMEOUT = 180
TERMINAL = frozenset(('completed', 'failed', 'cancelled'))


def bind_state(role, *, native_role=None, native_runtime=None):
    """A role-bound MCP must share the scheduler's ledger despite env filtering."""
    from operations_state import state_root
    global STATE
    STATE = state_root(role, native_role=native_role, native_runtime=native_runtime)
    return STATE


def target_host(role, recorded=None):
    from world_team_hosts import migration_for, native_host, require_host
    if role not in RECORDED_ROLES:
        raise ValueError('unknown_operations_role')
    host = recorded if recorded is not None else native_host('operations:' + role)
    allowed = [{'runtime': 'operations', 'agentId': role}]
    entry = migration_for('operations:' + role)
    if entry is not None:
        allowed.append(dict(entry['target']))
    if host not in allowed: raise ValueError('invalid_operations_task_host')
    if recorded is None:
        require_host('operations:' + role, host['runtime'], host['agentId'])
    return dict(host)


def api(method, route, role, *, recorded_host=None, **kwargs):
    host = target_host(role, recorded_host)
    base = {'game': 'http://qwenpaw:8088/api', 'operations': 'http://qwenpaw-ops:8088/api'}[host['runtime']]
    headers = {'X-Agent-Id': host['agentId']}
    if host['runtime'] == 'operations':
        headers['Authorization'] = 'Bearer ' + (STATE/'secret/console-token.txt').read_text().strip()
    prefix = '/agents/' + role
    if route == prefix or route.startswith(prefix + '/'):
        route = '/agents/' + host['agentId'] + route[len(prefix):]
    with httpx.Client(base_url=base, timeout=15, trust_env=False, headers=headers) as client:
        response = client.request(method, route, **kwargs)
        response.raise_for_status()
        if len(response.content) > 2*1024*1024: raise ValueError('response_limit')
        return response.json()


@contextmanager
def ledger():
    folder = STATE/'operations-budget'; folder.mkdir(exist_ok=True)
    with (folder/'lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        file = folder/'delegations.json'
        rows = json.loads(file.read_text()) if file.exists() else []
        yield rows
        pending = folder/'delegations.tmp'
        # Never evict an unresolved submission when pruning old history.
        keep = compact_ledger(rows)
        pending.write_text(json.dumps(keep, ensure_ascii=False), encoding='utf8')
        pending.replace(file)


def compact_ledger(rows, terminal_limit=100):
    """Keep unresolved work and the newest real terminal records, not list tails.

    Pending records are stored first. A newly completed record therefore becomes
    the first terminal row, so tail slicing alone used to delete it immediately.
    Historical records need no rewriting; completion/start times determine age.
    """
    if (not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows)
            or type(terminal_limit) is not int or not 1 <= terminal_limit <= 100):
        raise ValueError('invalid_operations_ledger')
    def terminal_age(indexed):
        index, row = indexed
        for key in ('finishedAt', 'startedAt'):
            stamp = row.get(key)
            if type(stamp) in (int, float) and math.isfinite(stamp) and stamp >= 0:
                return stamp, index
        return 0, index
    unresolved = [row for row in rows if row.get('status') not in TERMINAL]
    terminal = [(index, row) for index, row in enumerate(rows) if row.get('status') in TERMINAL]
    terminal.sort(key=terminal_age)
    return unresolved + [row for _, row in terminal[-terminal_limit:]]


def budget_check(rows, now, parent_run_id=None):
    if any(r.get('status') not in TERMINAL and (parent_run_id is None or r.get('runId') != parent_run_id) for r in rows):
        return 'operations_task_unresolved'
    return None


def engineering_overlap_evidence():
    """The existing read-only probe binds native execution, kernel lock and ledger."""
    from engineering_cron_runtime import health
    return health(include_running=True)


def daily_engineering_overlap(role, job_id, rows, now):
    """Only the steward's original daily shift may overlap a proven engineer.

    This is not a generic per-role quota relaxation. Unknown/foreign/same-role
    work remains blocking, and no record is released or reconciled by this read.
    """
    from world_operations import JOB_ID
    if role != 'default' or job_id != JOB_ID:
        return None
    pending = [row for row in rows if row.get('status') not in TERMINAL]
    if len(pending) != 1:
        return None
    row = pending[0]
    if (row.get('role') != 'mc-god' or row.get('jobId') != 'qd-team-engineer'
            or row.get('status') != 'cron_reserved' or row.get('taskId') is not None
            or row.get('nativeHost') != {'runtime': 'game', 'agentId': 'qd-engineer'}
            or row.get('source') != 'native-qwen-world-cron'
            or not isinstance(row.get('runId'), str) or row.get('requestId') != row['runId']):
        return None
    try:
        if target_host('default') != {'runtime': 'game', 'agentId': 'qd-steward'}:
            return None
        evidence = engineering_overlap_evidence()
        running = evidence.get('runningEvidence', {})
        checks = running.get('checks', {})
        stamp = running.get('checkedAt')
        if (evidence.get('ok') is not True or evidence.get('policy') != 'no_total_deadline'
                or running.get('verified') is not True
                or not all(checks.get(key) is True for key in ('nativeCronRunning', 'guardOwnsCycleLock',
                    'cycleIdentity', 'originalReservation', 'startOwnership'))
                or running.get('actor') != 'operations:mc-god'
                or running.get('jobId') != row['jobId']
                or running.get('reservationRunId') != row['runId']
                or running.get('reservationStartedAt') != row.get('startedAt')
                or type(stamp) not in (int, float) or not math.isfinite(stamp)
                or not -5 <= now - stamp <= 30):
            return None
        return {'runId': row['runId'], 'verifiedAt': stamp}
    except (OSError, ValueError, TypeError, KeyError):
        return None


def finish_run(run_id, status, **details):
    if status not in TERMINAL: raise ValueError('nonterminal_status')
    with ledger() as rows:
        for row in rows:
            if row.get('runId') == run_id and row.get('status') not in TERMINAL:
                row.update(status=status, finishedAt=time.time(), **details)
                return True
    return False


def archived_terminal(row):
    """Recover only a previously recorded exact native completion, never age."""
    try:
        run_id, role, request_id = row['runId'], row['role'], row['requestId']
        if (not isinstance(run_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,120}', run_id)
                or role not in RECORDED_ROLES[1:] or request_id != run_id+'-'+role): return False
        archive_path = STATE/'run-reports'/(run_id+'.json')
        report_path = STATE/'work/operations/reports'/role/(request_id+'.json')
        def read_evidence(path):
            if any(p.is_symlink() for p in (path, *path.parents)): raise ValueError('linked_evidence')
            if not path.is_file() or path.stat().st_size > 131072: raise ValueError('invalid_evidence')
            raw = path.read_bytes()
            return json.loads(raw), hashlib.sha256(raw).hexdigest()
        archive, digest = read_evidence(archive_path)
        report, report_digest = read_evidence(report_path)
        if (archive.get('schema') != 1 or archive.get('project') != 'qiandengji-ops'
                or archive.get('runId') != run_id or archive.get('ok') is not True
                or archive.get('backend') != 'qwenpaw-native-background-task'
                or archive.get('worldActionsExecuted') != 0): return False
        matches = [r for r in archive.get('roles', []) if r.get('role') == role
                   and r.get('requestId') == request_id and r.get('taskId') == row.get('taskId')]
        if len(matches) != 1: return False
        evidence = matches[0]
        if (evidence.get('nativeResultStatus') != 'completed' or evidence.get('reportRecorded') is not True
                or evidence.get('ok') is not True or report.get('schema') != 1 or report.get('role') != role
                or report.get('requestId') != request_id or report.get('status') != 'proposed'
                or report.get('worldActionsExecuted') != 0): return False
        finished = datetime.fromisoformat(archive['finishedAt'].replace('Z', '+00:00'))
        if finished.tzinfo is None or not row['startedAt'] <= finished.timestamp() <= time.time()+5: return False
        return finish_run(run_id, 'completed', nativeStatus='completed',
            terminalEvidence='archived_native_receipt', evidenceSha256=digest, reportSha256=report_digest,
            nativeFinishedAt=archive['finishedAt'], evidencePath='run-reports/'+run_id+'.json')
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


# 一次"占位但从未提交"的预留，多久之后可以按证据收尾。
# 它没有 taskId，所以永远问不到原生终态 —— 不设这条，一本账会被一行永久堵死
# （2026-09-19：world-e8636ffbee91435da52054ed659cfdf7 就这样堵了 45.7 小时，
#   期间五个角色的学习班次每小时都答 operations_task_unresolved）。
# 门槛给足：只在远超任何合理提交延迟后才动手。
NEVER_SUBMITTED_GRACE_SECONDS = 1800


def reconcile_never_submitted(now=None):
    """收尾"预留了但从未提交"的行：无 taskId ⇒ 物理上不可能有终态。

    这不是放宽预算，而是把一本账从"永远读不到终态"里救出来：
    只动 taskId 为空、且已超过宽限期的行，逐行写明证据与原因。
    """
    now = time.time() if now is None else now
    released = []
    with ledger() as rows:
        stale = [dict(r) for r in rows
                 if r.get('status') not in TERMINAL and not r.get('taskId')
                 and now - (r.get('startedAt') or now) > NEVER_SUBMITTED_GRACE_SECONDS]
    for row in stale:
        if finish_run(row['runId'], 'failed', nativeStatus='never_submitted',
                      resultStatus='reservation_without_task',
                      note='cron_reserved 且无 taskId：从未提交原生任务，不可能有终态；'
                           '超过 %d 秒宽限期后按证据收尾' % NEVER_SUBMITTED_GRACE_SECONDS):
            released.append(row['runId'])
    return {'released': released}


def reconcile_pending():
    """Read only known native tasks; missing/unknown receipts never free a lease."""
    never = reconcile_never_submitted()
    with ledger() as rows:
        pending = [dict(r) for r in rows if r.get('status') not in TERMINAL and r.get('taskId')]
    reconciled = list(never.get('released') or [])
    for row in pending:
        try:
            value = api('GET', '/console/chat/task/' + row['taskId'], row['role'],
                        recorded_host=row.get('nativeHost') or {'runtime': 'operations', 'agentId': row['role']})
            native_status = value.get('status')
            if native_status in ('finished', 'completed', 'failed', 'error', 'cancelled', 'canceled', 'timeout', 'timed_out'):
                result = value.get('result') or {}
                status = 'completed' if native_status in ('finished', 'completed') and result.get('status') == 'completed' else 'failed'
                if finish_run(row['runId'], status, nativeStatus=native_status, resultStatus=result.get('status')):
                    reconciled.append(row['runId'])
        except Exception:
            # Unavailability is not completion. A previously captured exact
            # native success can, separately, resolve the old ledger entry.
            if archived_terminal(row): reconciled.append(row['runId'])
    return {'reconciled': reconciled}


def reserve_operation(role, job_id):
    reconcile_pending()
    with ledger() as rows:
        now = time.time()
        overlap = daily_engineering_overlap(role, job_id, rows, now)
        blocked = budget_check(rows, now, overlap['runId'] if overlap else None)
        if blocked: return {'ok': False, 'code': blocked}
        run_id = 'world-' + uuid.uuid4().hex
        rows.append({'runId': run_id, 'requestId': run_id, 'role': role, 'jobId': job_id,
                     'startedAt': time.time(), 'status': 'cron_reserved', 'taskId': None,
                     'nativeHost': target_host(role),
                     'source': 'native-qwen-world-cron'})
        if overlap:
            rows[-1]['parallelWithVerifiedRun'] = overlap
    return {'ok': True, 'runId': run_id}


def delegate(caller, to_role, task):
    if caller != 'default' or to_role not in SPECIALISTS:
        return {'ok': False, 'code': 'role_not_allowed'}
    if not isinstance(task, str) or not 1 <= len(task.strip()) <= 1800:
        return {'ok': False, 'code': 'invalid_task'}
    caller_host = target_host(caller)
    reconcile_pending()
    with ledger() as rows:
        now = time.time()
        # A fixed coordinator cron may own one native specialist child. It is
        # the only permitted parent exception; a second child remains blocked.
        from world_operations import JOB_ID
        parents = [r for r in rows if r.get('status') == 'cron_reserved'
                   and r.get('role') == caller and r.get('jobId') == JOB_ID
                   and r.get('source') == 'native-qwen-world-cron']
        parent = parents[0]['runId'] if len(parents) == 1 else None
        blocked = budget_check(rows, now, parent)
        if blocked: return {'ok': False, 'code': blocked, 'retryAutomatically': False}
        run_id = 'ops-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]
        request_id = run_id+'-'+to_role
        # Reserve before I/O: a lost response must never lead to an automatic paid retry.
        row = {'runId': run_id, 'requestId': request_id, 'role': to_role, 'startedAt': now,
               'status': 'reserved', 'taskId': None, 'parentRunId': parent,
               'nativeHost': target_host(to_role)}
        rows.append(row)
    from qwenpaw.agents.tools.agent_management import build_agent_chat_request
    text = ('处理司灯的一次委托。调用 operations_snapshot 后使用与你职责相关的 Skill。'
            '提交 submit_operations_report，request_id 必须为 '+request_id+'。最多3条发现和3条建议；'
            '无实时证据的结论标待验证，不能执行世界修改。完成后简短返回，不回调司灯。任务：'+task)
    _, payload, _ = build_agent_chat_request(row['nativeHost']['agentId'], text, session_id=request_id,
        from_agent=caller_host['agentId'])
    payload['timeout'] = TASK_TIMEOUT
    try:
        result = api('POST', '/console/chat/task', to_role, recorded_host=row['nativeHost'], json=payload)
        task_id = result.get('task_id')
        if not isinstance(task_id, str) or not task_id: raise ValueError('missing_native_task_id')
        row.update(taskId=task_id, status='submitted')
    except Exception as exc:
        row.update(status='submission_uncertain', errorType=type(exc).__name__)
    with ledger() as rows:
        for index, saved in enumerate(rows):
            if saved['runId'] == run_id: rows[index] = row; break
    return {'ok': row['status']=='submitted', **row, 'backend': 'qwenpaw-native-background-task',
            'timeoutSeconds': TASK_TIMEOUT, 'pollAfterSeconds': 30, 'retryAutomatically': False}


def task_status(caller, task_id):
    if caller != 'default': return {'ok': False, 'code': 'role_not_allowed'}
    with ledger() as rows:
        row = next((r for r in rows if r.get('taskId') == task_id), None)
        if row is None: return {'ok': False, 'code': 'unknown_task'}
        now = time.time()
        if now-row.get('lastPollAt', 0) < 30: return {'ok': False, 'code': 'poll_cooldown'}
        row['lastPollAt'] = now
        role = row['role']
        if row.get('status') in TERMINAL:
            return {'ok': True, 'taskId': task_id, 'role': role, 'status': row['status'], 'cached': True}
    try:
        value = api('GET', '/console/chat/task/'+task_id, role,
                    recorded_host=row.get('nativeHost') or {'runtime': 'operations', 'agentId': role})
        # Full result stays in native console; this tool returns only bounded task state.
        result = value.get('result') or {}
        if value.get('status') in ('finished', 'completed', 'failed', 'error', 'cancelled', 'canceled', 'timeout', 'timed_out'):
            final = 'completed' if value.get('status') in ('finished', 'completed') and result.get('status') == 'completed' else 'failed'
            finish_run(row['runId'], final, nativeStatus=value.get('status'), resultStatus=result.get('status'))
        return {'ok': True, 'taskId': task_id, 'role': role, 'status': value.get('status'),
                'resultStatus': result.get('status'), 'reportRequestId': row['requestId']}
    except Exception as exc:
        return {'ok': False, 'code': 'task_status_unavailable', 'errorType': type(exc).__name__}
