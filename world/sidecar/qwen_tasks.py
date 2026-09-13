"""Bounded native QwenPaw task client; never chooses a model or runs an agent.

Reservations precede network I/O. An uncertain POST is never replayed. Polling
only reads an already-owned native task, so callers never block on inference.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.request
import uuid

ROLES = {'npc_dialogue': 'qd-villager-dialogue', 'guild_quest': 'qd-guild-planner',
         'maid_dialogue': 'qd-maid-dialogue'}
BASE = 'http://qwenpaw:8088/api'
LIMITS = {purpose: (None, 0) for purpose in ROLES}
_LOCK = threading.RLock()
MAX_BYTES = 262144


def read_json(path, *, max_bytes=MAX_BYTES):
    if path.is_symlink() or path.stat().st_size > max_bytes:
        raise ValueError('invalid_qwen_state')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf8') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def state_lock(root):
    root.mkdir(parents=True, exist_ok=True)
    with _LOCK, (root / 'lock').open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0); stream.write(b'0'); stream.flush(); stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('qwen_redirect_refused')


def final_text(value):
    """Only native completed assistant messages, never tool/thinking blocks."""
    result = value.get('result')
    if (not isinstance(result, dict) or value.get('status') not in ('finished', 'completed')
            or result.get('status') != 'completed' or not isinstance(result.get('output'), list)):
        return None
    answer = None
    for message in result.get('output', []):
        if (not isinstance(message, dict) or message.get('role') != 'assistant'
                or message.get('type') != 'message' or message.get('status') != 'completed'):
            continue
        content = message.get('content') if isinstance(message.get('content'), list) else []
        parts = [row['text'] for row in content if isinstance(row, dict)
                 and row.get('type') == 'text' and isinstance(row.get('text'), str)]
        text = '\n'.join(parts).strip()
        # Native IterationGate reports an ordinary completed/message sentinel.
        # Earlier narration is not a final answer when that message ends a task.
        answer = text
    if answer and re.fullmatch(r'Max iterations \([0-9]+\) reached', answer):
        return None
    return answer if answer and len(answer) <= 16000 else None


class QwenTasks:
    def __init__(self, root, routes=None, token=None, transport=None, clock=time.time, maid_registry=None):
        self.root, self.clock = Path(root), clock
        self.routes = Path(routes or '/etc/qiandeng/model-task-routes.json')
        self.token = Path(token or os.environ.get('QWENPAW_CONSOLE_TOKEN_FILE', '/run/secrets/qwenpaw-console-token'))
        self.transport = transport or self._http
        self.maid_registry = maid_registry

    def _route(self, purpose):
        if purpose not in ROLES:
            raise ValueError('qwen_purpose_not_allowed')
        doc = read_json(self.routes)
        row = doc.get('routes', {}).get(purpose)
        if (doc.get('schema') != 1 or not isinstance(row, dict) or row.get('runtime') != 'game'
                or row.get('agentId') != ROLES[purpose] or row.get('apiUrl') != BASE):
            raise ValueError('qwen_route_invalid')
        return row

    def _http(self, method, path, role, payload=None):
        token = self.token.read_text(encoding='utf-8-sig').strip()
        if not token or len(token) > 8192 or any(c.isspace() for c in token):
            raise ValueError('qwen_token_unavailable')
        headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-Agent-Id': role}
        request = urllib.request.Request(BASE + path, method=method, headers=headers,
            data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf8') if payload is not None else None)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=10) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('qwen_response_too_large')
        result = json.loads(raw)
        if not isinstance(result, dict) and not (method == 'GET' and isinstance(result, list)
                and (path == '/mcp' or re.fullmatch(r'/mcp/tools/[A-Za-z0-9_-]+', path))):
            raise ValueError('qwen_response_invalid')
        return result

    def _path(self, purpose, key):
        if purpose not in ROLES or not isinstance(key, str) or not 1 <= len(key) <= 180:
            raise ValueError('qwen_request_key_invalid')
        return self.root / 'requests' / (hashlib.sha256((purpose + '\0' + key).encode()).hexdigest() + '.json')

    def _save(self, path, row):
        write_json(path, row)
        return row | {'retryAutomatically': False}

    def _maid_binding(self, purpose, maid_uuid, owner_uuid):
        if maid_uuid is None and owner_uuid is None:
            return None
        if purpose != 'maid_dialogue':
            raise ValueError('maid_purpose_required')
        if self.maid_registry is None:
            from maid_registry import MaidRegistry
            self.maid_registry = MaidRegistry()
        return self.maid_registry.resolve(maid_uuid, owner_uuid)

    def _refresh_role_active(self, role, purpose, maid_uuid, owner_uuid):
        # The native caller may stop waiting before inference finishes. Reconcile
        # its known task before the next input, without ever replaying an unknown
        # POST or making this gate depend on that caller returning to the game.
        active_path = self.root / 'active-roles' / (hashlib.sha256(role.encode()).hexdigest() + '.json')
        with state_lock(self.root):
            if not active_path.exists():
                # Upgrade pre-gate roles without expiring unknown submissions.
                # The append-only request records, not the rolling usage window,
                # are authoritative for work which might still be executing.
                unresolved = []
                for path in (self.root / 'requests').glob('*.json'):
                    saved = read_json(path)
                    if (saved.get('agentId') == role
                            and saved.get('status') not in ('completed', 'failed', 'not_submitted')):
                        unresolved.append(path.stem)
                if len(unresolved) > 1:
                    raise ValueError('qwen_legacy_role_overlap_requires_review')
                if not unresolved:
                    return
                write_json(active_path, {'agentId': role, 'stateKey': unresolved[0]})
            active = read_json(active_path)
            key = active.get('stateKey', '')
            if not isinstance(key, str) or not re.fullmatch('[a-f0-9]{64}', key):
                raise ValueError('qwen_role_gate_invalid')
            prior = read_json(self.root / 'requests' / (key + '.json'))
            if (prior.get('agentId') != role or prior.get('purpose') != purpose
                    or prior.get('maidUuid') != maid_uuid or prior.get('ownerUuid') != owner_uuid):
                raise ValueError('qwen_role_gate_invalid')
            if prior.get('status') not in ('submitted', 'running', 'poll_unavailable'):
                return
        # poll takes its own short ledger lock; never wait on HTTP inside it.
        self.poll(purpose, prior['key'], maid_uuid=maid_uuid, owner_uuid=owner_uuid)

    def submit(self, purpose, key, text, *, maid_uuid=None, owner_uuid=None, allowed_tools=None,
               expected_binding=None):
        route = self._route(purpose)
        binding = self._maid_binding(purpose, maid_uuid, owner_uuid)
        role = binding['agentId'] if binding else route['agentId']
        if expected_binding is not None:
            actual = {'agentId': role, 'bodyUuid': maid_uuid, 'ownerUuid': owner_uuid,
                      'sessionId': binding.get('sessionId') if binding else None,
                      'userId': 'maid-' + maid_uuid if binding else None, 'channel': 'console'}
            if not binding or expected_binding != actual:
                raise ValueError('qwen_dispatch_binding_changed')
        if not isinstance(text, str) or not 1 <= len(text) <= 24000:
            raise ValueError('qwen_prompt_invalid')
        if allowed_tools is not None and (not binding or not isinstance(allowed_tools, list)
                or len(allowed_tools) > 256 or any(not isinstance(t, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', t) for t in allowed_tools)):
            raise ValueError('qwen_tool_scope_invalid')
        path = self._path(purpose, key)
        digest = hashlib.sha256(text.encode('utf8')).hexdigest()
        if not path.exists():
            self._refresh_role_active(role, purpose, maid_uuid, owner_uuid)
        with state_lock(self.root):
            if path.exists():
                saved = read_json(path)
                if (saved.get('promptSha256') != digest or saved.get('agentId') != role
                        or saved.get('maidUuid') != maid_uuid or saved.get('ownerUuid') != owner_uuid
                        or (binding and saved.get('sessionId') != binding['sessionId'])
                        or saved.get('allowedTools') != allowed_tools):
                    raise ValueError('qwen_request_conflict')
                return saved | {'retryAutomatically': False}
            # Native chat, party input and future wakeups for this character use
            # one durable gate. Unknown submissions never age out of this gate.
            active_path = self.root / 'active-roles' / (hashlib.sha256(role.encode()).hexdigest() + '.json')
            if active_path.exists():
                active = read_json(active_path)
                prior = read_json(self.root / 'requests' / (active['stateKey'] + '.json'))
                if prior.get('agentId') != role:
                    raise ValueError('qwen_role_gate_invalid')
                if prior.get('status') not in ('completed', 'failed', 'not_submitted'):
                    return {'status': 'busy', 'purpose': purpose, 'retryAutomatically': False}
            budget_path = self.root / 'budget.json'
            rows = read_json(budget_path, max_bytes=8 * 1024 * 1024) if budget_path.exists() else []
            if not isinstance(rows, list):
                raise ValueError('qwen_budget_invalid')
            now = self.clock()
            # A backwards clock is conservative: future reservations still count.
            recent = [row for row in rows if now - row['startedAt'] < 86400]
            owned = [row for row in recent if row['purpose'] == purpose]
            cap, cooldown = LIMITS[purpose]
            if ((cap is not None and len(owned) >= cap)
                    or (cooldown > 0 and any(now - row['startedAt'] < cooldown for row in owned))):
                return {'status': 'budget_blocked', 'purpose': purpose, 'retryAutomatically': False}
            row = {'schema': 1, 'purpose': purpose, 'agentId': role, 'key': key,
                   'requestId': 'npc-' + uuid.uuid4().hex, 'startedAt': now, 'status': 'reserved', 'taskId': None,
                   'promptSha256': digest}
            if binding:
                row.update(maidUuid=maid_uuid, ownerUuid=owner_uuid, sessionId=binding['sessionId'],
                           userId='maid-' + maid_uuid, channel='console')
            if allowed_tools is not None:
                row['allowedTools'] = list(allowed_tools)
            # Both documents commit before POST. A crash between writes may cost
            # a reservation but cannot permit a duplicate paid request.
            write_json(budget_path, recent + [{**{k: row[k] for k in ('purpose', 'requestId', 'startedAt')}, 'stateKey': path.stem}])
            self._save(path, row)
            write_json(active_path, {'agentId': role, 'stateKey': path.stem})
        payload = {'channel': 'console', 'session_id': row.get('sessionId', row['requestId']),
            'user_id': row.get('userId', 'npc-service'), 'timeout': 180,
            'input': [{'role': 'user', 'content': [{'type': 'text', 'text': text}]}],
            'request_context': {'root_agent_id': 'npc-service'}}
        if allowed_tools is not None:
            payload['request_context']['subagent_allowed_tools'] = list(allowed_tools)
        try:
            value = self.transport('POST', '/console/chat/task', row['agentId'], payload)
            task_id = value.get('task_id')
            if not isinstance(task_id, str) or not re.fullmatch(r'task-[0-9a-f]{12}', task_id):
                raise ValueError('qwen_task_id_invalid')
            row.update(status='submitted', taskId=task_id)
        except Exception as exc:
            row.update(status='submission_uncertain', errorType=type(exc).__name__)
        with state_lock(self.root):
            return self._save(path, row)

    def poll(self, purpose, key, *, maid_uuid=None, owner_uuid=None):
        self._route(purpose)
        binding = self._maid_binding(purpose, maid_uuid, owner_uuid)
        role = binding['agentId'] if binding else ROLES[purpose]
        path = self._path(purpose, key)
        with state_lock(self.root):
            if not path.exists():
                return {'status': 'not_submitted', 'retryAutomatically': False}
            row = read_json(path)
            if (row.get('purpose') != purpose or row.get('key') != key or row.get('agentId') != role
                    or row.get('maidUuid') != maid_uuid or row.get('ownerUuid') != owner_uuid
                    or (binding and row.get('sessionId') != binding['sessionId'])):
                raise ValueError('qwen_task_not_owned')
            if row.get('status') not in ('submitted', 'running', 'poll_unavailable'):
                return row | {'retryAutomatically': False}
            if not re.fullmatch(r'task-[0-9a-f]{12}', row.get('taskId', '')):
                raise ValueError('qwen_task_not_owned')
            if self.clock() - row.get('lastPollAt', 0) < 10:
                return row | {'retryAutomatically': False}
            row['lastPollAt'] = self.clock()
            self._save(path, row)
        try:
            value = self.transport('GET', '/console/chat/task/' + row['taskId'], row['agentId'])
            if value.get('status') in ('finished', 'completed', 'failed', 'cancelled', 'canceled', 'error', 'timeout', 'timed_out'):
                answer = final_text(value)
                row.update(status='completed' if answer else 'failed', finishedAt=self.clock())
                if answer:
                    row['text'] = answer
            elif value.get('status') in ('running', 'queued', 'pending'):
                row['status'] = 'running'
            else:
                raise ValueError('qwen_task_status_invalid')
        except Exception as exc:
            row.update(status='poll_unavailable', errorType=type(exc).__name__)
        with state_lock(self.root):
            # Another process may have polled while this GET was in flight.
            # A stale running/error reply cannot erase a saved terminal answer.
            latest = read_json(path)
            if any(latest.get(k) != row.get(k) for k in ('requestId', 'taskId', 'promptSha256')):
                raise ValueError('qwen_task_changed')
            if (latest.get('status') in ('completed', 'failed')
                    or (row.get('status') not in ('completed', 'failed')
                        and latest.get('lastPollAt', 0) > row.get('lastPollAt', 0))):
                return latest | {'retryAutomatically': False}
            return self._save(path, row)
