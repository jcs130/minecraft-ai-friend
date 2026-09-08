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

from world_admin_tools import ADMIN_ACTOR, AdminStore, RULES, TIMES, canonical, fingerprint, validate

ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
WEATHER_ACK = {'clear': 'Set the weather to clear', 'rain': 'Set the weather to rain',
               'thunder': 'Set the weather to rain & thunder'}


class NativeAdminRcon:
    """Project-local transport; a lost post-write response never sends again."""
    def __init__(self, host=None, port=None, password_file=None):
        self.host = host or os.environ.get('MC_RCON_HOST', 'mc')
        self.port = int(port or os.environ.get('MC_RCON_PORT', '25575'))
        self.password_file = Path(password_file or os.environ.get('MC_RCON_PASSWORD_FILE', '/world-data/rcon-secret.txt'))

    @staticmethod
    def allowed(command):
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


class WorldAdminConsumer:
    def __init__(self, root=Path('/team'), run=None, clock=time.time):
        self.store, self.run, self.clock = AdminStore(root, clock), run or NativeAdminRcon(), clock
        self.last_tick = None

    def _read_time(self):
        return time_value(self.run('time query daytime'))

    def _diagnostics(self):
        raw = clean(self.run('list'))
        match = re.fullmatch(r'There are (\d{1,6}) of a max of (\d{1,6}) players online:\s*(.*)', raw)
        if not match:
            raise ValueError('player_count_unconfirmed')
        names = [name.strip() for name in match[3].split(',') if name.strip()]
        if any(not re.fullmatch(r'[A-Za-z0-9_]{1,16}', name) for name in names) or len(names) != int(match[1]):
            raise ValueError('player_names_unconfirmed')
        return {'observedAt': self.store.stamp(), 'source': 'minecraft-1.21.1-native-rcon',
                'playerCount': int(match[1]), 'maxPlayers': int(match[2]), 'players': names[:64],
                'playersTruncated': len(names) > 64, 'daytime': self._read_time(),
                'gamerules': {rule: rule_value(self.run('gamerule ' + rule), rule) for rule in RULES},
                'weather': None, 'weatherObserved': False,
                'notice': 'Native list is the reported online roster; no physical player position or weather was inferred.'}

    def _perform(self, row):
        args = validate(row['kind'], json.loads(row['args']))
        if (fingerprint(row['actor'], row['kind'], args) != row['fingerprint']
                or (row['kind'] != 'diagnostics' and row['actor'] != ADMIN_ACTOR)):
            raise ValueError('admin_request_invalid')
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
                'retryAutomatically': False}

    def tick(self):
        """At most one request; call from the existing NPC supervised tick."""
        self.last_tick = self.store.stamp()
        row = self.store.claim()
        if row is not None:
            try:
                status, receipt = self._perform(row)
            except (ValueError, KeyError, TypeError):
                status, receipt = 'rejected', {'ok': False, 'code': 'invalid_request', 'executionConfirmed': False}
            self.store.finish(row, status, receipt)
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

    def health(self):
        with self.store.connect() as db:
            counts = dict(db.execute('SELECT status,COUNT(*) FROM requests GROUP BY status').fetchall())
        return {'schema': 1, 'protocol': 1, 'updatedAt': self.last_tick, 'actor': ADMIN_ACTOR,
                'pending': counts.get('queued', 0), 'unresolved': counts.get('claimed', 0) + counts.get('unknown', 0),
                'completed': counts.get('completed', 0), 'modelCalls': 0, 'retriesWorldWrites': False}
