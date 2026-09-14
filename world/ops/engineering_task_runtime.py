"""One admitted engineering help task shares the native Cron's execution lock.

Only the existing active game/qd-engineer help lane may omit its total deadline.
The native task, session, cancellation, stream-idle watchdog and result stay
QwenPaw-owned. Busy admission never creates a task or calls a model.
"""
import hashlib
import json
from pathlib import Path
import re

VERSION = 1
ACTOR = 'operations:mc-god'
AGENT_ID = 'qd-engineer'
POLICY = {'version': VERSION, 'totalTimeout': 'none', 'maxConcurrency': 1,
          'scope': 'game/qd-engineer/native-team-help'}
CONTEXT_KEY = 'qiandeng_engineering_help'


class EngineeringBusy(Exception):
    """Exact no-start rejection, safe to reconsider in a later normal turn."""
    detail = {'code': 'engineering_busy', 'taskStarted': False, 'modelCalls': 0,
              'status': 'deferred', 'sameCaseVersionCanRetry': True}

    def __init__(self, code='engineering_busy'):
        self.detail = dict(type(self).detail, code=code)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def read(path, limit=32768):
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
           for p in (path, *path.parents)):
        raise ValueError('linked_engineering_help_admission')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('engineering_help_admission_too_large')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('invalid_engineering_help_admission')
    return value


class Admission:
    def __init__(self, stream):
        self.stream = stream
        self.attached = False

    def close(self, *_):
        if self.stream is not None:
            stream, self.stream = self.stream, None
            stream.close()  # Releases this descriptor's kernel lock only.

    def attach(self, task):
        if self.attached:
            raise ValueError('engineering_task_already_attached')
        self.attached = True
        task.add_done_callback(self.close)

    def release_unattached(self):
        if not self.attached:
            self.close()


def admit(request_data, workspace, *, root=Path('/team'), state=Path('/state'), require_host=None):
    context = request_data.get('request_context')
    policy = context.get(CONTEXT_KEY) if isinstance(context, dict) else None
    if policy is None:
        return None  # Other native/background requests retain their own timeout.
    if (getattr(workspace, 'agent_id', None) != AGENT_ID
            or not isinstance(policy, dict) or set(policy) != {'version', 'helpId'}
            or policy.get('version') != VERSION):
        raise ValueError('invalid_engineering_task_scope')
    if Path(workspace.workspace_dir).resolve() != (Path(state) / 'work/workspaces' / AGENT_ID).resolve():
        raise ValueError('invalid_engineering_task_workspace')
    runtime = read(Path(state) / 'work/learning-runtime.json')
    if runtime.get('runtime') != 'game' or runtime.get('engineeringTaskRuntimeVersion') != VERSION:
        raise ValueError('engineering_task_runtime_not_ready')
    if require_host is None:
        from world_team_hosts import require_host
    require_host(ACTOR, 'game', AGENT_ID)
    help_id = policy.get('helpId')
    if not isinstance(help_id, str) or not re.fullmatch(r'help-[0-9a-f]{24}', help_id):
        raise ValueError('invalid_engineering_help_id')
    record = read(Path(root) / 'native-help' / (help_id + '.json'))
    case_id, actor, version = record.get('caseId'), record.get('actor'), record.get('caseVersion')
    if (not isinstance(case_id, str) or not re.fullmatch(r'case-[0-9a-f]{20}', case_id)
            or not isinstance(actor, str) or type(version) is not int or version < 1
            or record.get('helpId') != help_id
            or help_id != 'help-' + fingerprint([actor, case_id, version, ACTOR])[:24]
            or record.get('recipient') != ACTOR
            or record.get('nativeHost') != {'runtime': 'game', 'agentId': AGENT_ID}
            or record.get('status') != 'unknown' or record.get('taskId') is not None
            or record.get('engineeringExecution') != POLICY
            or record.get('requestSha256') != fingerprint(request_data)
            or request_data.get('session_id') != 'world-case:' + case_id + ':' + AGENT_ID
            or record.get('sessionId') != request_data['session_id']
            or request_data.get('user_id') != 'world-team:' + actor
            or context.get('root_agent_id') != AGENT_ID):
        raise ValueError('engineering_help_intent_mismatch')
    import fcntl
    path = Path(root) / 'cycle-operations-mc-god.lock'
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_engineering_cycle_lock')
    stream = path.open('a+b')
    try:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        stream.close()
        raise EngineeringBusy() from None
    except BaseException:
        stream.close()
        raise
    try:
        import sqlite3
        from contextlib import closing
        database = Path(root) / 'team.sqlite3'
        if database.is_symlink():
            raise ValueError('linked_engineering_cycle_database')
        with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            row = db.execute('SELECT status FROM cycles WHERE actor=?', (ACTOR,)).fetchone()
        if row and row[0] in ('running', 'unknown'):
            raise EngineeringBusy('engineering_cycle_unresolved')
    except BaseException:
        stream.close()
        raise
    return Admission(stream)


def check_native_contract():
    from qwenpaw.app.routers import console
    if getattr(console, 'QIANDENG_ENGINEERING_TASK_RUNTIME_VERSION', None) != VERSION:
        raise ValueError('review_engineering_native_task_contract')
    return VERSION
