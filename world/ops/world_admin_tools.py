"""Typed Goddess administration mailbox. Qwen submits; the existing NPC executes.

No model calls, host commands, RCON credentials or scheduler live in this module.
The actor comes from the managed MCP process, never from a tool argument.
"""
from contextlib import contextmanager
import asyncio
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time

from party_role_capabilities import is_bound_yui

ADMIN_ACTOR = 'game:mc-god'
TOOL_NAMES = ('world_admin_diagnostics', 'world_admin_rule', 'world_admin_time',
              'world_admin_weather', 'world_admin_receipt',
              'world_admin_rescue_inspect', 'world_admin_rescue')
READ_OPERATIONS = ('diagnostics', 'rescue_inspect')
RULES = ('keepInventory', 'mobGriefing', 'doDaylightCycle', 'doWeatherCycle',
         'doFireTick', 'doMobSpawning', 'showDeathMessages', 'doInsomnia')
TIMES = {'day': 1000, 'noon': 6000, 'night': 13000, 'midnight': 18000}
WEATHER = ('clear', 'rain', 'thunder')
REQUEST_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}\Z')
ACTOR = re.compile(r'(?:game|operations):[A-Za-z0-9_-]{1,80}\Z')
TTL_MS = 120_000


def authorized_admin(actor):
    return actor == ADMIN_ACTOR or is_bound_yui(actor)


def validate(kind, args):
    if not isinstance(args, dict):
        raise ValueError('invalid_admin_arguments')
    fields = {'diagnostics': set(), 'rule': {'rule', 'value'},
              'time': {'time'}, 'weather': {'weather', 'durationSeconds'},
              'rescue_inspect': set(), 'rescue': {'observationRequestId', 'target', 'reason'}}
    if kind not in fields or set(args) != fields[kind]:
        raise ValueError('invalid_admin_operation')
    if kind == 'rule':
        if not isinstance(args['rule'], str) or args['rule'] not in RULES or type(args['value']) is not bool:
            raise ValueError('invalid_admin_rule')
        if args['rule'] == 'keepInventory' and args['value'] is not True:
            raise ValueError('keep_inventory_required')
    if kind == 'time' and (not isinstance(args['time'], str) or args['time'] not in TIMES):
        raise ValueError('invalid_admin_time')
    if kind == 'weather' and (not isinstance(args['weather'], str) or args['weather'] not in WEATHER
            or type(args['durationSeconds']) is not int or not 1 <= args['durationSeconds'] <= 600):
        raise ValueError('invalid_admin_weather')
    if kind == 'rescue':
        if not isinstance(args['observationRequestId'], str) or not REQUEST_ID.fullmatch(args['observationRequestId']):
            raise ValueError('invalid_rescue_observation')
        if args['target'] not in ('kirito', 'yui'):
            raise ValueError('invalid_rescue_target')
        reason = args['reason']
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 1200 or any(ord(c) < 32 for c in reason):
            raise ValueError('invalid_rescue_reason')
    return dict(args)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def fingerprint(actor, kind, args):
    return hashlib.sha256(canonical({'actor': actor, 'operation': kind, 'args': args}).encode()).hexdigest()


class AdminStore:
    def __init__(self, state=Path('/team'), clock=time.time):
        self.root, self.clock = Path(state) / 'admin', clock
        self.file = self.root / 'requests.sqlite3'
        self._check_paths()
        self.root.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY, actor TEXT NOT NULL, kind TEXT NOT NULL, args TEXT NOT NULL,
                fingerprint TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL,
                expires INTEGER NOT NULL, claimed INTEGER, receipt TEXT)''')

    def _check_paths(self):
        for path in (self.file, self.file.with_name(self.file.name + '-journal'),
                     self.file.with_name(self.file.name + '-wal'), self.file.with_name(self.file.name + '-shm'),
                     self.root, *self.root.parents):
            if path.is_symlink():
                raise ValueError('linked_admin_state')

    @contextmanager
    def connect(self):
        self._check_paths()
        db = sqlite3.connect(self.file, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA synchronous=FULL')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def stamp(self):
        return int(self.clock() * 1000)

    @staticmethod
    def view(row):
        if row is None:
            return {'ok': False, 'code': 'request_not_found', 'status': 'not_found'}
        receipt = json.loads(row['receipt']) if row['receipt'] else {}
        status = 'unknown' if row['status'] == 'claimed' else row['status']
        return {'schema': 1, 'requestId': row['id'], 'actor': row['actor'], 'operation': row['kind'],
                'args': json.loads(row['args']), 'createdAt': row['created'], 'expiresAt': row['expires'],
                'claimedAt': row['claimed'], 'ok': status in ('queued', 'completed'), 'status': status,
                'code': 'outcome_unknown' if status == 'unknown' else status,
                'executionConfirmed': False, 'retryAutomatically': False, **receipt}

    def submit(self, actor, request_id, kind, args):
        if not isinstance(actor, str) or not ACTOR.fullmatch(actor):
            raise ValueError('invalid_admin_actor')
        if kind != 'diagnostics' and not authorized_admin(actor):
            return {'ok': False, 'code': 'admin_actor_required', 'status': 'rejected'}
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise ValueError('invalid_admin_request_id')
        args = validate(kind, args)
        digest, now = fingerprint(actor, kind, args), self.stamp()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM requests WHERE id=?', (request_id,)).fetchone()
            if row is not None:
                if row['fingerprint'] != digest:
                    raise ValueError('admin_request_conflict')
                return {**self.view(row), 'replayedReceipt': True}
            if db.execute("SELECT COUNT(*) FROM requests WHERE status='queued'").fetchone()[0] >= 32:
                return {'ok': False, 'code': 'admin_queue_full', 'status': 'rejected'}
            db.execute('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (request_id, actor, kind, canonical(args), digest, 'queued', now, now + TTL_MS, None, None))
            return self.view(db.execute('SELECT * FROM requests WHERE id=?', (request_id,)).fetchone())

    def receipt(self, actor, request_id):
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise ValueError('invalid_admin_request_id')
        with self.connect() as db:
            row = db.execute('SELECT * FROM requests WHERE id=? AND actor=?', (request_id, actor)).fetchone()
            return self.view(row)

    def wait_receipt(self, actor, request_id, wait_seconds=0):
        if type(wait_seconds) is not int or not 0 <= wait_seconds <= 50:
            raise ValueError('invalid_receipt_wait')
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise ValueError('invalid_admin_request_id')
        deadline = time.monotonic() + wait_seconds
        while True:
            with self.connect() as db:
                row = db.execute('SELECT * FROM requests WHERE id=? AND actor=?', (request_id, actor)).fetchone()
            # A live claimed operation is still being observed by the worker.
            # At timeout it is honestly projected as unknown; never re-sent.
            if row is None or row['status'] not in ('queued', 'claimed') or time.monotonic() >= deadline:
                return self.view(row)
            time.sleep(min(1, max(0, deadline - time.monotonic())))

    def claim(self):
        """One cross-process claim. An unresolved write blocks later mutations."""
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            now = self.stamp()
            db.execute("UPDATE requests SET status='expired' WHERE status='queued' AND expires<?", (now,))
            blocked = db.execute("SELECT 1 FROM requests WHERE kind NOT IN ('diagnostics','rescue_inspect') AND status IN ('claimed','unknown') LIMIT 1").fetchone()
            query = "SELECT * FROM requests WHERE status='queued'"
            if blocked:
                query += " AND kind IN ('diagnostics','rescue_inspect')"
            row = db.execute(query + ' ORDER BY created,id LIMIT 1').fetchone()
            if row is None:
                return None
            db.execute("UPDATE requests SET status='claimed',claimed=? WHERE id=? AND status='queued'", (now, row['id']))
            return dict(db.execute('SELECT * FROM requests WHERE id=?', (row['id'],)).fetchone())

    def finish(self, row, status, receipt):
        if status not in ('completed', 'rejected', 'unknown'):
            raise ValueError('invalid_admin_terminal')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            cursor = db.execute("UPDATE requests SET status=?,receipt=? WHERE id=? AND fingerprint=? AND status='claimed'",
                                (status, canonical({**receipt, 'updatedAt': self.stamp()}), row['id'], row['fingerprint']))
            if cursor.rowcount != 1:
                raise ValueError('admin_claim_changed')

    def prepared(self, row, before):
        """Persist observations before the one permitted world write."""
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            receipt = {'ok': False, 'code': 'outcome_unknown', 'before': before,
                       'executionConfirmed': False, 'retryAutomatically': False, 'preparedAt': self.stamp()}
            cursor = db.execute("UPDATE requests SET receipt=? WHERE id=? AND fingerprint=? AND status='claimed'",
                                (canonical(receipt), row['id'], row['fingerprint']))
            if cursor.rowcount != 1:
                raise ValueError('admin_claim_changed')

    def defer(self, row, receipt):
        """Only for a proven busy precondition, before any world write was sent."""
        with self.connect() as db:
            cursor = db.execute("UPDATE requests SET status='queued',claimed=NULL,receipt=? WHERE id=? AND fingerprint=? AND status='claimed'",
                                (canonical(receipt), row['id'], row['fingerprint']))
            if cursor.rowcount != 1:
                raise ValueError('admin_claim_changed')

    def reconcile_rescue(self, row, status, receipt):
        """A native durable receipt proves the original request, never a replay."""
        if row['kind'] != 'rescue' or status not in ('completed', 'rejected'):
            raise ValueError('invalid_rescue_reconciliation')
        with self.connect() as db:
            cursor = db.execute("UPDATE requests SET status=?,receipt=? WHERE id=? AND fingerprint=? AND kind='rescue' AND status IN ('claimed','unknown')",
                                (status, canonical({**receipt, 'updatedAt': self.stamp(), 'reconciledBy': 'native-rescue-status'}), row['id'], row['fingerprint']))
            return cursor.rowcount == 1


class WorldAdminTools:
    def __init__(self, actor, state=Path('/team'), clock=time.time):
        if not isinstance(actor, str) or not ACTOR.fullmatch(actor):
            raise ValueError('invalid_admin_actor')
        self.actor, self.store = actor, AdminStore(state, clock)

    def submit(self, request_id, operation, args):
        return self.store.submit(self.actor, request_id, operation, args)

    def receipt(self, request_id, wait_seconds=0):
        result = self.store.wait_receipt(self.actor, request_id, wait_seconds)
        if result.get('operation') == 'rescue':
            with self.store.connect() as db:
                if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='feedback'").fetchone():
                    row = db.execute('SELECT result FROM feedback WHERE id=? AND status=?',
                                     (request_id, result['status'])).fetchone()
                    if row is not None:
                        # Read-time projection only; the native/admin receipt is
                        # immutable and feedback retries never repeat a rescue.
                        result['engineeringFeedback'] = json.loads(row['result'])
        return result


def register_admin_tools(app, actor, state=Path('/team')):
    service = WorldAdminTools(actor, state)

    @app.tool()
    def world_admin_diagnostics(request_id: str) -> dict:
        """Request live player count, time and allowed gamerules. Queued is not observed; read its receipt."""
        return service.submit(request_id, 'diagnostics', {})

    @app.tool()
    def world_admin_rule(request_id: str, rule: str, value: bool) -> dict:
        """Goddess/bound Yui: set one allowed camelCase gamerule. keepInventory must stay true. Never replay an unknown request."""
        return service.submit(request_id, 'rule', {'rule': rule, 'value': value})

    @app.tool()
    def world_admin_time(request_id: str, time: str) -> dict:
        """Goddess/bound Yui: request day/noon/night/midnight. This affects world time, not just the viewer."""
        return service.submit(request_id, 'time', {'time': time})

    @app.tool()
    def world_admin_weather(request_id: str, weather: str, duration_seconds: int = 300) -> dict:
        """Goddess/bound Yui: clear/rain/thunder for 1..600 seconds; inspect the native execution receipt."""
        return service.submit(request_id, 'weather', {'weather': weather, 'durationSeconds': duration_seconds})

    @app.tool()
    async def world_admin_receipt(request_id: str, wait_seconds: int = 0) -> dict:
        """Read your exact receipt; optionally wait 0..50 seconds for the existing worker. Use 50 after submitting rescue/inspection instead of rapid polling. Never dispatches or replays world writes."""
        return await asyncio.to_thread(service.receipt, request_id, wait_seconds)

    @app.tool()
    def world_admin_rescue_inspect(request_id: str) -> dict:
        """Observe the original Kirito/Yui pair and safe loaded landings. Read world_admin_receipt; queued is not an observation."""
        return service.submit(request_id, 'rescue_inspect', {})

    @app.tool()
    def world_admin_rescue(request_id: str, observation_request_id: str, target: str = 'kirito', reason: str = '') -> dict:
        """Goddess/bound Yui: one safe same-dimension rescue of kirito or yui, using your own fresh completed inspection. State the problem. Read the receipt; never retry an unknown request with a new ID. Creates engineering feedback, grants no items or skills."""
        return service.submit(request_id, 'rescue', {'observationRequestId': observation_request_id,
                                                  'target': target, 'reason': reason})

    return service
