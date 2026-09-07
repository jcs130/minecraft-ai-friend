"""Bounded adapter to QwenPaw's native background-task API, not another agent runtime."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import time
import uuid
import httpx

STATE = Path('/state')
SPECIALISTS = ('mc-god', 'mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto')
COOLDOWN = 1800
DAILY_LIMIT = 4
TASK_TIMEOUT = 180


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
        pending.write_text(json.dumps(rows[-100:], ensure_ascii=False), encoding='utf8')
        pending.replace(file)


def budget_check(rows, now):
    recent = [r for r in rows if now-r['startedAt'] < 86400]
    if any(now-r['startedAt'] < COOLDOWN for r in recent): return 'delegation_cooldown'
    if len(recent) >= DAILY_LIMIT: return 'daily_delegation_budget'
    return None


def delegate(caller, to_role, task):
    if caller != 'default' or to_role not in SPECIALISTS:
        return {'ok': False, 'code': 'role_not_allowed'}
    if not isinstance(task, str) or not 1 <= len(task.strip()) <= 1800:
        return {'ok': False, 'code': 'invalid_task'}
    with ledger() as rows:
        now = time.time()
        blocked = budget_check(rows, now)
        if blocked: return {'ok': False, 'code': blocked, 'retryAutomatically': False}
        run_id = 'ops-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]
        request_id = run_id+'-'+to_role
        # Reserve before I/O: a lost response must never lead to an automatic paid retry.
        row = {'runId': run_id, 'requestId': request_id, 'role': to_role, 'startedAt': now,
               'status': 'reserved', 'taskId': None}
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
    try:
        value = api('GET', '/console/chat/task/'+task_id, role)
        # Full result stays in native console; this tool returns only bounded task state.
        result = value.get('result') or {}
        return {'ok': True, 'taskId': task_id, 'role': role, 'status': value.get('status'),
                'resultStatus': result.get('status'), 'reportRequestId': row['requestId']}
    except Exception as exc:
        return {'ok': False, 'code': 'task_status_unavailable', 'errorType': type(exc).__name__}
