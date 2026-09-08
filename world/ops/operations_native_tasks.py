"""Bounded adapter to QwenPaw's native background-task API, not another agent runtime."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import time
import uuid
import httpx

STATE = Path('/state')
SPECIALISTS = ('mc-god', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto')
COOLDOWN = 0
DAILY_LIMIT = None
TASK_TIMEOUT = 180
TERMINAL = frozenset(('completed', 'failed', 'cancelled'))


def api(method, route, role, **kwargs):
    token = (STATE/'secret/console-token.txt').read_text().strip()
    with httpx.Client(base_url='http://127.0.0.1:8088/api', timeout=15, trust_env=False,
                      headers={'Authorization': 'Bearer '+token, 'X-Agent-Id': role}) as client:
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
        keep = [r for r in rows if r.get('status') not in TERMINAL]
        keep += [r for r in rows if r.get('status') in TERMINAL][-100:]
        pending.write_text(json.dumps(keep, ensure_ascii=False), encoding='utf8')
        pending.replace(file)


def budget_check(rows, now, parent_run_id=None):
    if any(r.get('status') not in TERMINAL and (parent_run_id is None or r.get('runId') != parent_run_id) for r in rows):
        return 'operations_task_unresolved'
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
                or role not in SPECIALISTS or request_id != run_id+'-'+role): return False
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


def reconcile_pending():
    """Read only known native tasks; missing/unknown receipts never free a lease."""
    with ledger() as rows:
        pending = [dict(r) for r in rows if r.get('status') not in TERMINAL and r.get('taskId')]
    reconciled = []
    for row in pending:
        try:
            value = api('GET', '/console/chat/task/' + row['taskId'], row['role'])
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
        blocked = budget_check(rows, time.time())
        if blocked: return {'ok': False, 'code': blocked}
        run_id = 'world-' + uuid.uuid4().hex
        rows.append({'runId': run_id, 'requestId': run_id, 'role': role, 'jobId': job_id,
                     'startedAt': time.time(), 'status': 'cron_reserved', 'taskId': None,
                     'source': 'native-qwen-world-cron'})
    return {'ok': True, 'runId': run_id}


def delegate(caller, to_role, task):
    if caller != 'default' or to_role not in SPECIALISTS:
        return {'ok': False, 'code': 'role_not_allowed'}
    if not isinstance(task, str) or not 1 <= len(task.strip()) <= 1800:
        return {'ok': False, 'code': 'invalid_task'}
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
               'status': 'reserved', 'taskId': None, 'parentRunId': parent}
        rows.append(row)
    from qwenpaw.agents.tools.agent_management import build_agent_chat_request
    text = ('处理司灯的一次委托。调用 operations_snapshot 后使用与你职责相关的 Skill。'
            '提交 submit_operations_report，request_id 必须为 '+request_id+'。最多3条发现和3条建议；'
            '无实时证据的结论标待验证，不能执行世界修改。完成后简短返回，不回调司灯。任务：'+task)
    _, payload, _ = build_agent_chat_request(to_role, text, session_id=request_id, from_agent=caller)
    payload['timeout'] = TASK_TIMEOUT
    try:
        result = api('POST', '/console/chat/task', to_role, json=payload)
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
        value = api('GET', '/console/chat/task/'+task_id, role)
        # Full result stays in native console; this tool returns only bounded task state.
        result = value.get('result') or {}
        if value.get('status') in ('finished', 'completed', 'failed', 'error', 'cancelled', 'canceled', 'timeout', 'timed_out'):
            final = 'completed' if value.get('status') in ('finished', 'completed') and result.get('status') == 'completed' else 'failed'
            finish_run(row['runId'], final, nativeStatus=value.get('status'), resultStatus=result.get('status'))
        return {'ok': True, 'taskId': task_id, 'role': role, 'status': value.get('status'),
                'resultStatus': result.get('status'), 'reportRequestId': row['requestId']}
    except Exception as exc:
        return {'ok': False, 'code': 'task_status_unavailable', 'errorType': type(exc).__name__}
