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


def validate(operation, args):
    if operation not in TOOL_NAMES or not isinstance(args, dict):
        raise ValueError('invalid_maid_operation')
    expected = {'identity': set(), 'context': {'category'}, 'task_catalog': {'offset'},
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
