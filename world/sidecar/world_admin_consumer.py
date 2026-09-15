"""One-tick admin executor inside mc_npc; no model, daemon or arbitrary command API.

The legacy NPC Rcon.cmd retries after ambiguous writes. Do not pass it here.
NativeAdminRcon uses one fresh, request-ID-matched connection and never retries.
"""
import json
import os
from pathlib import Path
import re
import socket
import struct
import time
import uuid

from world_admin_tools import ADMIN_ACTOR, AdminStore, RULES, TIMES, authorized_admin, canonical, fingerprint, validate
from world_rescue import NativeRescue

ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
WEATHER_ACK = {'clear': 'Set the weather to clear', 'rain': 'Set the weather to rain',
               'thunder': 'Set the weather to rain & thunder'}
# Live offline-mode usernames include CJK names (e.g. 桐人/鸣人 bodies); this mirrors
# the project-wide chat/speaker charset in mc_npc instead of ASCII-only usernames.
NAME = re.compile(r'[A-Za-z0-9_\u4e00-\u9fff]{1,16}')
# Vanilla /list wording changed across server versions ("of a max of N" -> "(max N)").
# The integration rig and the live world run different versions; accept both so a
# version gap cannot blank admin diagnostics (case-04ad7313f7e6110fd212).
LIST_FORMATS = (
    re.compile(r'There are (\d{1,6}) of a max of (\d{1,6}) players online:\s*(.*)'),
    re.compile(r'There are (\d{1,6}) players online \(max (\d{1,6})\):\s*(.*)'),
)


class NativeAdminRcon:
    """Project-local transport; a lost post-write response never sends again."""
    def __init__(self, host=None, port=None, password_file=None):
        self.host = host or os.environ.get('MC_RCON_HOST', 'mc')
        self.port = int(port or os.environ.get('MC_RCON_PORT', '25575'))
        self.password_file = Path(password_file or os.environ.get('MC_RCON_PASSWORD_FILE', '/world-data/rcon-secret.txt'))

    @staticmethod
    def allowed(command):
        uid = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        if re.fullmatch(r'qdmaid (?:rescue_inspect|rescue_status) ' + uid, command):
            return True
        if re.fullmatch(r'qdmaid rescue ' + uid + ' ' + uid + r' (?:kirito|yui)', command):
            return True
        if command == 'numen_act invoke "Kirito" task_status {}':
            return True
        if command in ('list', 'time query daytime', 'time query gametime', 'time query day'):
            return True
        if command in {'gamerule ' + rule for rule in RULES}:
            return True
        for rule in RULES:
            for value in ('true', 'false'):
                if command == 'gamerule ' + rule + ' ' + value:
                    return rule != 'keepInventory' or value == 'true'
        if command in {'time set ' + name for name in TIMES}:
            return True
        match = re.fullmatch(r'weather (clear|rain|thunder) ([1-9]\d{0,2})s', command)
        return bool(match and int(match[2]) <= 600)

    def __call__(self, command):
        if not isinstance(command, str) or not self.allowed(command):
            raise ValueError('admin_command_not_allowed')
        if (self.host, self.port) not in (('mc', 25575), ('127.0.0.1', 25577), ('localhost', 25577)):
            raise ValueError('admin_rcon_target_not_allowed')
        password = self.password_file.read_text(encoding='utf-8-sig').strip()

        def packet(rid, kind, text):
            payload = struct.pack('<ii', rid, kind) + text.encode('utf8') + b'\0\0'
            return struct.pack('<i', len(payload)) + payload

        with socket.create_connection((self.host, self.port), timeout=5) as connection:
            def exact(count):
                value = b''
                while len(value) < count:
                    chunk = connection.recv(count - len(value))
                    if not chunk:
                        raise ConnectionError('rcon_closed')
                    value += chunk
                return value

            def receive():
                size, = struct.unpack('<i', exact(4))
                if not 10 <= size <= 8192:
                    raise ValueError('rcon_frame_limit')
                data = exact(size)
                if data[-2:] != b'\0\0':
                    raise ValueError('rcon_frame_invalid')
                return *struct.unpack('<ii', data[:8]), data[8:-2].decode('utf8', 'strict')

            connection.sendall(packet(1, 3, password))
            for _ in range(4):
                rid, kind, _ = receive()
                if rid == -1:
                    raise PermissionError('rcon_auth_failed')
                if (rid, kind) == (1, 2):
                    break
            else:
                raise ConnectionError('rcon_auth_unconfirmed')
            connection.sendall(packet(2, 2, command))
            for _ in range(16):
                rid, kind, text = receive()
                if (rid, kind) == (2, 0):
                    return text
            raise ConnectionError('rcon_response_unconfirmed')


def clean(raw):
    if not isinstance(raw, str) or len(raw.encode('utf8')) > 8192:
        raise ValueError('admin_reply_invalid')
    return ANSI.sub('', raw).strip()


def rule_value(raw, rule):
    match = re.fullmatch(r'Gamerule ' + re.escape(rule) + r' is currently set to: (true|false)', clean(raw))
    if not match:
        raise ValueError('gamerule_observation_unconfirmed')
    return match[1] == 'true'


def time_value(raw):
    match = re.fullmatch(r'The time is (\d{1,12})', clean(raw))
    if not match:
        raise ValueError('time_observation_unconfirmed')
    return int(match[1])


def roster(raw):
    """Parse one native /list reply into (count, max, names); unknown wording fails closed."""
    text = clean(raw)
    for pattern in LIST_FORMATS:
        match = pattern.fullmatch(text)
        if match:
            names = [name.strip() for name in match[3].split(',') if name.strip()]
            return int(match[1]), int(match[2]), names
    # Carry a bounded raw prefix so a future wording drift names itself in the receipt.
    raise ValueError('player_count_unconfirmed: ' + text[:80])


class WorldAdminConsumer:
    def __init__(self, root=Path('/team'), run=None, clock=time.time, rescue_guard=None):
        self.store, self.run, self.clock = AdminStore(root, clock), run or NativeAdminRcon(), clock
        self.rescue = NativeRescue(self.store, self.run, rescue_guard)
        self.last_tick = None

    def _read_time(self):
        return time_value(self.run('time query daytime'))

    def _diagnostics(self):
        count, maximum, names = roster(self.run('list'))
        if any(not NAME.fullmatch(name) for name in names) or len(names) != count:
            raise ValueError('player_names_unconfirmed')
        return {'observedAt': self.store.stamp(), 'source': 'minecraft-native-rcon',
                'playerCount': count, 'maxPlayers': maximum, 'players': names[:64],
                'playersTruncated': len(names) > 64, 'daytime': self._read_time(),
                'gamerules': {rule: rule_value(self.run('gamerule ' + rule), rule) for rule in RULES},
                'weather': None, 'weatherObserved': False,
                'notice': 'Native list is the reported online roster; no physical player position or weather was inferred.'}

    def _perform(self, row):
        args = validate(row['kind'], json.loads(row['args']))
        if (fingerprint(row['actor'], row['kind'], args) != row['fingerprint']
                or (row['kind'] != 'diagnostics' and not authorized_admin(row['actor']))):
            raise ValueError('admin_request_invalid')
        if row['kind'] in ('rescue_inspect', 'rescue'):
            return self.rescue.perform(row, args)
        before, mutation_sent = {}, False
        try:
            kind = row['kind']
            if kind == 'diagnostics':
                return 'completed', {'ok': True, 'code': 'observed', 'executionConfirmed': False,
                                     'observation': self._diagnostics()}
            if kind == 'rule':
                rule, value = args['rule'], args['value']
                before = {'rule': rule, 'value': rule_value(self.run('gamerule ' + rule), rule)}
                command = 'gamerule ' + rule + ' ' + str(value).lower()
            elif kind == 'time':
                before = {'daytime': self._read_time()}
                command = 'time set ' + args['time']
            else:
                before = {'daytime': self._read_time(), 'weather': None, 'weatherObserved': False}
                command = 'weather %s %ds' % (args['weather'], args['durationSeconds'])
            before['observedAt'] = self.store.stamp()
            if self.store.stamp() > row['expires']:
                return 'rejected', {'ok': False, 'code': 'expired_before_write', 'executionConfirmed': False, 'before': before}
            self.store.prepared(row, before)
            if not authorized_admin(row['actor']):
                return 'rejected', {'ok': False, 'code': 'admin_actor_required', 'executionConfirmed': False}
            # The claim has been durably committed before even the precondition.
            # It remains unresolved if the process dies anywhere after this point.
            mutation_sent = True
            native = clean(self.run(command))
            if kind == 'rule':
                expected = 'Gamerule %s is now set to: %s' % (rule, str(value).lower())
                if native != expected:
                    raise ValueError('rule_command_unconfirmed')
                current = rule_value(self.run('gamerule ' + rule), rule)
                if current != value:
                    raise ValueError('rule_postcondition_changed')
                after = {'rule': rule, 'value': current, 'source': 'native-gamerule-query'}
            elif kind == 'time':
                target = TIMES[args['time']]
                if native != 'Set the time to ' + str(target):
                    raise ValueError('time_command_unconfirmed')
                current = self._read_time()
                # Time can advance while the independent read round-trip runs.
                elapsed = max(0, self.store.stamp() - before['observedAt']) / 1000
                if not 0 <= (current - target) % 24000 <= min(1200, 40 + int(elapsed * 20)):
                    raise ValueError('time_postcondition_changed')
                after = {'daytime': current, 'targetDaytime': target, 'source': 'native-time-query'}
            else:
                if native != WEATHER_ACK[args['weather']]:
                    raise ValueError('weather_command_unconfirmed')
                # Actual 1.21.1 WeatherCommand calls setWeatherParameters BEFORE
                # sendSuccess. This is execution evidence, not a later independent
                # observation or a promise that subsequent commands cannot change it.
                after = {'requestedWeather': args['weather'], 'requestedDurationSeconds': args['durationSeconds'],
                         'source': 'native-WeatherCommand-setWeatherParameters-ack',
                         'weatherObserved': False, 'currentWeather': None}
            after['observedAt'] = self.store.stamp()
            return 'completed', {'ok': True, 'code': 'applied', 'executionConfirmed': True,
                                 'before': before, 'after': after, 'nativeReceipt': native}
        except Exception as error:
            return ('unknown' if mutation_sent else 'rejected'), {
                'ok': False, 'code': 'outcome_unknown' if mutation_sent else 'precondition_unavailable',
                'executionConfirmed': False, 'before': before, 'errorType': type(error).__name__,
                'errorDetail': str(error)[:200], 'retryAutomatically': False}

    def tick(self):
        """At most one request; call from the existing NPC supervised tick."""
        self.last_tick = self.store.stamp()
        self._reconcile_rescues()
        row = self.store.claim()
        if row is not None:
            try:
                status, receipt = self._perform(row)
            except (ValueError, KeyError, TypeError):
                status, receipt = 'rejected', {'ok': False, 'code': 'invalid_request', 'executionConfirmed': False}
            if status == 'deferred':
                self.store.defer(row, receipt)
            else:
                self.store.finish(row, status, receipt)
        self._rescue_feedback()
        result = self.health()
        path = self.store.root / 'consumer.json'
        if path.is_symlink():
            raise ValueError('linked_admin_health')
        temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('x', encoding='utf8') as stream:
                stream.write(canonical(result))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        return result

    def _reconcile_rescues(self):
        with self.store.connect() as db:
            rows = [dict(row) for row in db.execute("SELECT * FROM requests WHERE kind='rescue' AND status IN ('claimed','unknown') ORDER BY created LIMIT 4")]
        for row in rows:
            try:
                self.rescue.reconcile(row)
            except Exception:
                # The original receipt stays unknown. This is not permission
                # to send a second teleport, even after a process restart.
                pass

    def _rescue_feedback(self):
        from world_team import record_admin_feedback
        with self.store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS feedback (id TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(id,status))')
            rows = [dict(row) for row in db.execute("SELECT * FROM requests r WHERE kind='rescue' AND (status IN ('completed','rejected','unknown') OR (status='claimed' AND claimed<?)) AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.id=r.id AND f.status=CASE WHEN r.status='claimed' THEN 'unknown' ELSE r.status END) ORDER BY created LIMIT 4", (self.store.stamp() - 30_000,))]
        for row in rows:
            try:
                receipt = self.store.view(row)
                result = record_admin_feedback(self.store.root.parent, row['actor'], row['id'], receipt)
                if result.get('ok'):
                    with self.store.connect() as db:
                        db.execute('INSERT OR IGNORE INTO feedback VALUES (?,?,?)', (row['id'], receipt['status'], canonical(result)))
            except Exception:
                # Retry only durable engineering documentation next tick.
                # The original admin request can never be executed again.
                pass

    def health(self):
        with self.store.connect() as db:
            counts = dict(db.execute('SELECT status,COUNT(*) FROM requests GROUP BY status').fetchall())
        return {'schema': 1, 'protocol': 1, 'updatedAt': self.last_tick, 'actor': ADMIN_ACTOR,
                'sharedAdminQueue': True,
                'authorizedActors': [actor for actor in (ADMIN_ACTOR, 'game:5swvhK') if authorized_admin(actor)],
                'pending': counts.get('queued', 0), 'unresolved': counts.get('claimed', 0) + counts.get('unknown', 0),
                'completed': counts.get('completed', 0), 'modelCalls': 0, 'retriesWorldWrites': False}
