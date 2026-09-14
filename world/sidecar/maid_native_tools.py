"""Seven fixed-self tools over the installed maid addon. No chat/LLM loops."""
import base64
import json
import os
from pathlib import Path
import re
import socket
import struct
import threading
import time
import uuid

from maid_identity import canonical_uuid, identity
from qwen_tasks import read_json, write_json, state_lock

READS = ('identity', 'context', 'task_catalog')
WRITES = ('sit', 'follow', 'schedule', 'work')
TOOL_NAMES = (*READS, *WRITES)
TASK_SEARCH_VERSION = 1
TASK_SEARCH_MAX_PAGES = 16


def validate(operation, args):
    if operation not in TOOL_NAMES or not isinstance(args, dict):
        raise ValueError('invalid_maid_operation')
    expected = {'identity': set(), 'context': {'category'}, 'task_catalog': {'offset', 'query'},
                'sit': {'sit'}, 'follow': {'follow'}, 'schedule': {'schedule'}, 'work': {'taskId'}}[operation]
    if set(args) - expected or (operation != 'task_catalog' and set(args) != expected):
        raise ValueError('invalid_maid_arguments')
    if operation in ('sit', 'follow') and type(args[operation]) is not bool:
        raise ValueError('invalid_maid_boolean')
    if operation == 'schedule' and args['schedule'] not in ('DAY', 'NIGHT', 'ALL'):
        raise ValueError('invalid_maid_schedule')
    if operation == 'context' and (not isinstance(args['category'], str) or not 1 <= len(args['category']) <= 64 or '\0' in args['category']):
        raise ValueError('invalid_context_category')
    if operation == 'task_catalog' and (type(args.get('offset', 0)) is not int or not 0 <= args.get('offset', 0) <= 4096):
        raise ValueError('invalid_task_offset')
    if operation == 'task_catalog' and 'query' in args:
        query = args['query']
        if (not isinstance(query, str) or not query.strip() or len(query) > 80
                or any(ord(c) < 32 or ord(c) == 127 for c in query)):
            raise ValueError('invalid_task_query')
    if operation == 'work' and (not isinstance(args['taskId'], str) or len(args['taskId']) > 128
                              or not re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+', args['taskId'])):
        raise ValueError('invalid_task_id')
    return dict(args)


class NativeRcon:
    """A fresh, bounded connection per command; never retries a write."""
    def __init__(self, host=None, port=None, password_file=None):
        self.host = host or os.environ['MC_RCON_HOST']
        self.port = int(port or os.environ['MC_RCON_PORT'])
        self.password_file = Path(password_file or os.environ['MC_RCON_PASSWORD_FILE'])

    def __call__(self, command):
        if (not isinstance(command, str) or not command.startswith(
                ('qdmaid invoke ', 'qdmaid list ', 'qdmaid party_say ', 'qdmaid party_speech_status '))
                or len(command) > 1500 or any(c in command for c in ('\n', '\r', '\0'))):
            raise ValueError('maid_command_not_allowed')
        password = self.password_file.read_text(encoding='utf-8-sig').strip()
        def packet(rid, kind, text):
            payload = struct.pack('<ii', rid, kind) + text.encode() + b'\0\0'
            return struct.pack('<i', len(payload)) + payload
        with socket.create_connection((self.host, self.port), timeout=5) as connection:
            def exact(count):
                value = b''
                while len(value) < count:
                    part = connection.recv(count - len(value))
                    if not part:
                        raise ConnectionError('rcon_closed')
                    value += part
                return value
            def receive():
                length = struct.unpack('<i', exact(4))[0]
                if not 10 <= length <= 4096:
                    raise ValueError('rcon_packet_limit')
                raw = exact(length)
                return *struct.unpack('<ii', raw[:8]), raw[8:-2].decode('utf8')
            connection.sendall(packet(1, 3, password))
            for _ in range(3):
                rid, kind, _ = receive()
                if rid == -1:
                    raise PermissionError('rcon_auth_failed')
                if rid == 1 and kind == 2:
                    break
            else:
                raise PermissionError('rcon_auth_unconfirmed')
            connection.sendall(packet(2, 2, command))
            for _ in range(4):
                rid, kind, text = receive()
                if rid == 2 and kind == 0:
                    return text
            raise ValueError('rcon_reply_unconfirmed')


def parse_reply(raw):
    if not isinstance(raw, str) or len(raw.encode('utf8')) > 4096:
        raise ValueError('maid_reply_invalid')
    prefix = 'QD_MAID_JSON '
    if not raw.startswith(prefix):
        raise ValueError('maid_reply_missing')
    row = json.loads(raw[len(prefix):])
    if (not isinstance(row, dict) or row.get('schema') != 1 or row.get('engine') != 'qiandeng_maid_bridge'
            or type(row.get('ok')) is not bool or row.get('phase') not in ('observed', 'applied', 'rejected', 'outcome_unknown')):
        raise ValueError('maid_reply_invalid')
    return row


class MaidNativeTools:
    def __init__(self, registry, run=None, clock=time.time):
        self.registry, self.run, self.clock = registry, run or NativeRcon(), clock
        self.gate = threading.BoundedSemaphore(4)

    def invoke(self, binding, operation, args, request_id=None):
        args = validate(operation, args)
        if operation == 'task_catalog' and 'query' in args:
            return self._search_tasks(binding, args)
        actor = self.registry.resolve(binding['maidUuid'], binding['ownerUuid'])
        if actor['agentId'] != binding['agentId']:
            raise ValueError('maid_binding_changed')
        request_id = request_id or 'maid-' + uuid.uuid4().hex
        if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', request_id):
            raise ValueError('invalid_maid_request_id')
        payload = {'schema': 1, 'requestId': request_id, 'maidUuid': actor['maidUuid'],
                   'ownerUuid': actor['ownerUuid'], 'operation': operation, 'args': args}
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
        if len(raw) > 1024:
            raise ValueError('maid_request_limit')
        command = 'qdmaid invoke ' + base64.urlsafe_b64encode(raw).decode().rstrip('=')
        path = self.registry.root / 'actions' / (request_id + '.json')
        if not self.gate.acquire(blocking=False):
            return {'ok': False, 'code': 'maid_bridge_busy', 'phase': 'rejected'}
        try:
            if operation in WRITES:
                with state_lock(self.registry.root):
                    if path.exists():
                        saved = read_json(path)
                        if saved.get('request') != payload:
                            raise ValueError('maid_request_conflict')
                        return {**saved['result'], 'replayedReceipt': True, 'historicalReceipt': True}
                    # A lost response cannot be silently repeated as another action.
                    write_json(path, {'request': payload, 'result': {'ok': False, 'code': 'outcome_unknown',
                        'phase': 'outcome_unknown', 'requestId': request_id, 'retryAutomatically': False}})
            try:
                result = parse_reply(self.run(command))
                if any(result.get(k) != payload[k] for k in ('requestId', 'maidUuid', 'ownerUuid', 'operation')):
                    raise ValueError('maid_reply_identity_mismatch')
                if result.get('identity'):
                    observed = identity(result['identity'])
                    if observed['maidUuid'] != actor['maidUuid'] or observed['ownerUuid'] != actor['ownerUuid']:
                        raise ValueError('maid_reply_identity_mismatch')
                if result['ok'] and operation in WRITES:
                    after = result.get('after', {})
                    field = {'sit': 'sitting', 'follow': 'following', 'schedule': 'schedule', 'work': 'taskId'}[operation]
                    target = args[{'work': 'taskId'}.get(operation, operation)]
                    if result['phase'] != 'applied' or after.get(field) != target or result.get('workCompleted') is not False:
                        raise ValueError('maid_write_not_confirmed')
                if result['ok'] and operation in READS and result['phase'] != 'observed':
                    raise ValueError('maid_observation_not_confirmed')
                result['retryAutomatically'] = False
            except Exception:
                result = {'ok': False, 'code': 'outcome_unknown' if operation in WRITES else 'observation_unavailable',
                          'phase': 'outcome_unknown' if operation in WRITES else 'rejected',
                          'requestId': request_id, 'retryAutomatically': False}
            if operation in WRITES:
                with state_lock(self.registry.root):
                    write_json(path, {'request': payload, 'result': result})
            return result
        finally:
            self.gate.release()

    def _search_tasks(self, binding, args):
        """Read the same body's native pages; a partial scan never proves absence.

        The addon still receives its original offset-only protocol. Each page
        goes through the normal identity/reply validation; no game writes or
        independent task selection occur here.
        """
        query, offset = args['query'].strip(), args.get('offset', 0)
        first_offset, total, searched, pages = offset, None, 0, 0
        matches, observed, seen = [], [], set()
        complete, error = False, None
        for _ in range(TASK_SEARCH_MAX_PAGES):
            try:
                page = self.invoke(binding, 'task_catalog', {'offset': offset})
                pages += 1
                if page.get('ok') is not True:
                    error = page.get('code', 'observation_unavailable')
                    break
                rows, following, native_total = page.get('tasks'), page.get('nextOffset'), page.get('total')
                if (not isinstance(rows, list) or len(rows) > 4
                        or type(native_total) is not int or not 0 <= native_total <= 4096
                        or page.get('offset') != offset or type(following) is not int
                        or following != min(offset, native_total) + len(rows)
                        or not 0 <= following <= native_total
                        or type(page.get('truncated')) is not bool
                        or page['truncated'] != (following < native_total)
                        or (page['truncated'] and following <= offset)):
                    raise ValueError('task_catalog_pagination_invalid')
                if total is not None and total != native_total:
                    raise ValueError('task_catalog_changed_during_search')
                ids = []
                for row in rows:
                    if (not isinstance(row, dict) or not isinstance(row.get('taskId'), str)
                            or not re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+', row['taskId'])
                            or len(row['taskId']) > 128 or type(row.get('enabled')) is not bool
                            or not isinstance(row.get('name'), str) or len(row['name']) > 100
                            or not isinstance(row.get('summary'), str) or len(row['summary']) > 200):
                        raise ValueError('task_catalog_entry_invalid')
                    ids.append(row['taskId'])
                if len(set(ids)) != len(ids) or seen.intersection(ids):
                    raise ValueError('task_catalog_changed_during_search')
                total = native_total
                seen.update(ids)
                searched += len(rows)
                matches.extend(row for row in rows if any(query.casefold() in row[key].casefold()
                                                          for key in ('taskId', 'name', 'summary')))
                observed.append({'offset': offset, 'nextOffset': following, 'observedAt': page.get('observedAt')})
                offset = following
                if not page['truncated']:
                    complete = True
                    break
            except (OSError, ValueError, TypeError, KeyError) as exc:
                # Preserve earlier observations, not a fabricated empty result.
                error = str(exc) if isinstance(exc, ValueError) else 'observation_unavailable'
                break
        return {'schema': 1, 'engine': 'qiandeng_maid_catalog_search', 'searchVersion': TASK_SEARCH_VERSION,
                'ok': error is None, 'phase': 'observed' if error is None else 'rejected',
                'code': 'task_catalog_search_complete' if complete else 'task_catalog_search_partial',
                'query': query, 'offset': first_offset, 'nextOffset': offset, 'total': total,
                'searchedEntries': searched, 'pagesRead': pages, 'tasks': matches,
                'searchComplete': complete, 'truncated': not complete,
                'absenceConfirmed': complete and first_offset == 0 and not matches,
                'error': error, 'observations': observed, 'retryAutomatically': False,
                'notice': 'Only observed taskId/name/summary substrings are matched. Empty matches do not prove '
                          'a gameplay capability is unavailable; inspect other terms/pages when needed. '
                          'truncated means the scan is incomplete; nextOffset resumes the same query.'}

    def discover(self):
        rows, offset = [], 0
        for _ in range(64):
            result = parse_reply(self.run('qdmaid list ' + str(offset)))
            if not result['ok'] or result['phase'] != 'observed' or not isinstance(result.get('maids'), list):
                raise ValueError('maid_discovery_unavailable')
            for row in result['maids']:
                # Unowned are reported as waiting for real adoption, never invented.
                if row.get('ownerUuid') is None:
                    rows.append({'maidUuid': canonical_uuid(row.get('maidUuid')), 'ownerUuid': None,
                                 'status': 'unowned_waiting_for_adoption'})
                else:
                    rows.append(identity(row))
            if not result.get('truncated'):
                return rows
            following = result.get('nextOffset')
            if type(following) is not int or not offset < following <= 4096:
                raise ValueError('maid_discovery_pagination_invalid')
            offset = following
        raise ValueError('maid_discovery_limit')
