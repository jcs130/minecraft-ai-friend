"""Durable, version-bound program observations. No world IO or model evaluation."""
from contextlib import closing, contextmanager
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import time
import uuid

from numen_gateway import IDENTIFIER, TOOLS, TURN_ID
from skill_library import NAME, VERSION, _kernel_version


SCHEMA = 1
TERMINALS = ('done', 'replan', 'paused', 'completed', 'failed', 'cancelled')
RECEIPT_STATES = ('unknown', 'in_flight', 'completed', 'failed', 'rejected',
                  'observed_ended', 'effect_unconfirmed')


class PracticeError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _require(condition, code):
    if not condition:
        raise PracticeError(code)


def _identifier(value, pattern, code):
    _require(isinstance(value, str) and pattern.fullmatch(value), code)
    return value


def _json(value, limit=65536):
    try:
        encoded = json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False,
                             separators=(',', ':'))
    except (TypeError, ValueError, RecursionError) as exc:
        raise PracticeError('practice_invalid_json') from exc
    _require(len(encoded.encode()) <= limit, 'practice_data_too_large')
    return encoded


def _hash(value):
    return hashlib.sha256(_json(value).encode()).hexdigest()


def _text(value, maximum):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and not any(
        ord(c) < 32 and c not in '\n\t' for c in value)


def validate_objective(value):
    if value is None:
        return None
    _require(isinstance(value, dict) and set(value) == {'description', 'checks'}
             and _text(value['description'], 600), 'practice_invalid_objective')
    checks = value['checks']
    _require(isinstance(checks, list) and 1 <= len(checks) <= 4, 'practice_invalid_checks')
    for check in checks:
        _require(isinstance(check, dict), 'practice_invalid_check')
        kind = check.get('kind')
        if kind == 'inventory_gain':
            _require(set(check) == {'kind', 'item', 'count'}, 'practice_invalid_check')
            _identifier(check['item'], IDENTIFIER, 'practice_invalid_item')
            maximum = 4096
        elif kind == 'action_completed':
            _require(set(check) == {'kind', 'tool', 'count'} and check['tool'] in TOOLS,
                     'practice_invalid_check')
            maximum = 32
        else:
            raise PracticeError('practice_unsupported_check')
        _require(type(check['count']) is int and 1 <= check['count'] <= maximum,
                 'practice_invalid_check_count')
    return json.loads(_json(value, 8192))


def run_id(name, version, request_turn_id):
    _identifier(name, NAME, 'practice_invalid_name')
    _identifier(version, VERSION, 'practice_invalid_version')
    _identifier(request_turn_id, TURN_ID, 'practice_invalid_turn')
    return _hash({'name': name, 'version': version, 'requestTurnId': request_turn_id})


def _body(value):
    _require(isinstance(value, dict) and value.get('ok') is True, 'practice_body_unavailable')
    actor = value.get('bodyUuid')
    try:
        _require(isinstance(actor, str) and str(uuid.UUID(actor)) == actor, 'practice_invalid_body')
    except (ValueError, AttributeError) as exc:
        raise PracticeError('practice_invalid_body') from exc
    dimension = _identifier(value.get('dimension'), IDENTIFIER, 'practice_invalid_dimension')
    counts = value.get('counts')
    _require(isinstance(counts, dict) and len(counts) <= 256, 'practice_inventory_unavailable')
    for item, count in counts.items():
        _identifier(item, IDENTIFIER, 'practice_invalid_item')
        _require(type(count) is int and 0 <= count <= 2147483647, 'practice_invalid_inventory')
    result = {'ok': True, 'bodyUuid': actor, 'dimension': dimension, 'counts': dict(counts)}
    for field in ('hp', 'hunger', 'observedAt'):
        number = value.get(field)
        if type(number) in (int, float) and math.isfinite(number):
            result[field] = number
    position = value.get('position')
    if isinstance(position, dict) and all(type(position.get(k)) in (int, float)
            and math.isfinite(position[k]) for k in ('x', 'y', 'z')):
        result['position'] = {k: position[k] for k in ('x', 'y', 'z')}
    _json(result, 32768)
    return result


def _observed_navigation(receipt, before, after, navigation):
    """Validate the gateway's epoch-less, body-observed arrival contract.

    This is evidence of the original goto's observed endpoint, not a native
    epoch terminal or proof of the encompassing program's objective.
    """
    error = 'practice_observed_navigation_mismatch'
    number = lambda value: type(value) in (int, float) and math.isfinite(value)
    point = lambda value: isinstance(value, dict) and all(number(value.get(k)) for k in ('x', 'y', 'z'))
    result = receipt.get('result') if isinstance(receipt.get('result'), dict) else {}
    native = result.get('result') if isinstance(result.get('result'), dict) else {}
    admission = native.get('data') or {}
    _require(isinstance(after, dict) and after.get('ok') is True
        and isinstance(after.get('task'), dict) and after['task'].get('busy') is False
        and not after['task'].get('task_id')
        and before.get('navigationEpoch') is None and after.get('navigationEpoch') is None
        and navigation.get('navigation_epoch') is None
        and isinstance(receipt.get('nativeTaskId'), str) and bool(receipt['nativeTaskId'])
        and navigation.get('task_id') == receipt['nativeTaskId']
        and navigation.get('state') == 'ended' and type(navigation.get('success')) is bool
        and receipt.get('status') == ('completed' if navigation['success'] else 'failed')
        and receipt.get('completionConfirmed') is True
        and result.get('ok') is True and result.get('code') == 'accepted'
        and result.get('actionId') == receipt['actionId'] and result.get('tool') == 'goto'
        and native.get('success') is True and isinstance(admission, dict)
        and admission.get('async') is True and admission.get('task_id') == receipt['nativeTaskId'], error)
    _body(after)
    _require(all(number(value) for value in (before.get('observedAt'), receipt.get('acceptedAt'),
        after.get('observedAt'), receipt.get('observedAt')))
        and before['observedAt'] <= receipt['acceptedAt'] <= after['observedAt'] <= receipt['observedAt'], error)
    position, args = after.get('position'), receipt['args']
    _require(point(position) and number(args.get('x')) and number(args.get('z'))
        and ('y' not in args or number(args['y']))
        and all(number(navigation.get('final_' + k)) and navigation['final_' + k] == position[k]
                for k in ('x', 'y', 'z')), error)
    target_y = receipt.get('resolvedNavigationY', args.get('y'))
    _require(target_y is None or number(target_y), error)
    requested = {k: args[k] for k in ('x', 'y', 'z') if k in args}
    if target_y is not None:
        requested['y'] = target_y
    distance = math.hypot(position['x'] - args['x'], position['z'] - args['z'])
    arrived = distance <= 1.5 and (target_y is None or math.floor(position['y']) == math.floor(target_y))
    _require(isinstance(navigation.get('requested'), dict)
        and all(number(value) for value in navigation['requested'].values())
        and navigation['requested'] == requested and math.isfinite(distance)
        and number(navigation.get('horizontalDistance'))
        and navigation['horizontalDistance'] == round(distance, 2)
        and navigation['success'] is arrived, error)
    return arrived


class PracticeStore:
    def __init__(self, state, clock=time.time):
        self.path = Path(state).resolve() / 'practice.sqlite3'
        self.clock = clock

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with closing(sqlite3.connect(self.path, timeout=5)) as db:
                # WAL：写不再独占读、写-写锁大幅减少（原只 timeout=5 仍频繁 database is locked）
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('PRAGMA synchronous=NORMAL')
                schema = db.execute('PRAGMA user_version').fetchone()[0]
                _require(schema in (0, SCHEMA), 'practice_schema_mismatch')
                if schema == SCHEMA:
                    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                    _require({'runs', 'steps', 'receipts', 'refinements'} <= tables, 'practice_schema_mismatch')
                    return {'available': True, 'schema': SCHEMA}
                db.executescript('''
                    CREATE TABLE IF NOT EXISTS runs (
                      run_id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
                      binding TEXT NOT NULL, initial TEXT NOT NULL, final TEXT,
                      status TEXT NOT NULL, created REAL NOT NULL, finished REAL);
                    CREATE TABLE IF NOT EXISTS steps (
                      run_id TEXT NOT NULL, step_id TEXT NOT NULL, turn_id TEXT NOT NULL UNIQUE,
                      tool TEXT NOT NULL, args TEXT NOT NULL, created REAL NOT NULL,
                      PRIMARY KEY(run_id, step_id));
                    CREATE TABLE IF NOT EXISTS receipts (
                      action_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, turn_id TEXT NOT NULL,
                      identity TEXT NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL,
                      complete INTEGER NOT NULL, success INTEGER NOT NULL);
                    CREATE TABLE IF NOT EXISTS refinements (
                      id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
                      content TEXT NOT NULL, created REAL NOT NULL);
                    PRAGMA user_version=1;
                ''')
        except sqlite3.Error as exc:
            raise PracticeError('practice_store_unavailable') from exc
        return {'available': True, 'schema': SCHEMA}

    @contextmanager
    def _db(self, write=False):
        _require(self.path.is_file(), 'practice_store_uninitialized')
        db = None
        try:
            db = sqlite3.connect(self.path.as_uri() + ('?mode=rw' if write else '?mode=ro'),
                                 uri=True, timeout=5)
            db.row_factory = sqlite3.Row
            _require(db.execute('PRAGMA user_version').fetchone()[0] == SCHEMA,
                     'practice_schema_mismatch')
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            if write:
                db.commit()
        except sqlite3.Error as exc:
            raise PracticeError('practice_store_unavailable') from exc
        finally:
            if db is not None:
                db.close()

    def _run(self, db, identity):
        _identifier(identity, VERSION, 'practice_invalid_run_id')
        row = db.execute('SELECT * FROM runs WHERE run_id=?', (identity,)).fetchone()
        _require(row is not None, 'practice_run_missing')
        return row

    def begin(self, job, body):
        _require(isinstance(job, dict), 'practice_invalid_job')
        identity = run_id(job.get('name'), job.get('version'), job.get('turnId'))
        _require(job.get('practiceRunId') == identity, 'practice_run_binding_mismatch')
        objective = validate_objective(job.get('objective'))
        snapshot = _body(body)
        kernel = _kernel_version()
        _require(job.get('kernelVersion', kernel) == kernel, 'practice_kernel_mismatch')
        binding = {'name': job['name'], 'version': job['version'], 'requestTurnId': job['turnId'],
                   'bodyUuid': snapshot['bodyUuid'], 'dimension': snapshot['dimension'],
                   'kernelVersion': kernel, 'objective': objective, 'objectiveSha256': _hash(objective)}
        encoded = _json(binding)
        with self._db(True) as db:
            existing = db.execute('SELECT * FROM runs WHERE run_id=?', (identity,)).fetchone()
            if existing:
                _require(existing['binding'] == encoded, 'practice_run_binding_mismatch')
            else:
                db.execute('INSERT INTO runs VALUES (?,?,?,?,?,NULL,?,?,NULL)',
                           (identity, job['name'], job['version'], encoded, _json(snapshot),
                            'running', self.clock()))
            return self._summary(db, self._run(db, identity)) | {'created': existing is None}

    def step(self, run_id, step_id, turn_id, tool, args):
        _require(isinstance(step_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', step_id),
                 'practice_invalid_step_id')
        _identifier(turn_id, TURN_ID, 'practice_invalid_turn')
        _require(isinstance(tool, str) and tool in TOOLS and isinstance(args, dict), 'practice_invalid_action')
        encoded = _json(args, 16384)
        with self._db(True) as db:
            run = self._run(db, run_id)
            old = db.execute('SELECT * FROM steps WHERE run_id=? AND step_id=?', (run_id, step_id)).fetchone()
            if old:
                _require((old['turn_id'], old['tool'], old['args']) == (turn_id, tool, encoded),
                         'practice_step_binding_mismatch')
            else:
                _require(run['status'] == 'running', 'practice_run_terminal')
                _require(db.execute('SELECT COUNT(*) FROM steps WHERE run_id=?', (run_id,)).fetchone()[0] < 128,
                         'practice_step_limit')
                _require(db.execute('SELECT 1 FROM steps WHERE turn_id=?', (turn_id,)).fetchone() is None,
                         'practice_turn_already_bound')
                db.execute('INSERT INTO steps VALUES (?,?,?,?,?,?)',
                           (run_id, step_id, turn_id, tool, encoded, self.clock()))
            return self._summary(db, run) | {'changed': old is None}

    def capture(self, run_id, turn_id, receipts):
        _identifier(turn_id, TURN_ID, 'practice_invalid_turn')
        _require(isinstance(receipts, list) and len(receipts) <= 1, 'practice_invalid_receipts')
        with self._db(True) as db:
            run = self._run(db, run_id)
            binding = json.loads(run['binding'])
            step = db.execute('SELECT * FROM steps WHERE run_id=? AND turn_id=?', (run_id, turn_id)).fetchone()
            _require(step is not None, 'practice_step_missing')
            changed = False
            for receipt in receipts:
                _require(isinstance(receipt, dict), 'practice_invalid_receipt')
                action = _identifier(receipt.get('actionId'), re.compile(r'[0-9a-f]{32}\Z'), 'practice_invalid_action_id')
                _require(receipt.get('turnId') == turn_id and receipt.get('tool') == step['tool']
                         and _json(receipt.get('args')) == step['args'], 'practice_receipt_binding_mismatch')
                before = receipt.get('before')
                _require(isinstance(before, dict) and before.get('ok') is True
                         and before.get('bodyUuid') == binding['bodyUuid']
                         and before.get('dimension') == binding['dimension'], 'practice_receipt_body_mismatch')
                _body(before)
                after = receipt.get('after')
                if after is not None:
                    _require(isinstance(after, dict) and type(after.get('ok')) is bool,
                             'practice_receipt_body_mismatch')
                    # The gateway may have a definite native reply followed by
                    # an unavailable snapshot. Keep that original receipt; only
                    # a separate valid final observation can establish inventory.
                    for field in ('bodyUuid', 'dimension'):
                        _require((not after['ok'] and field not in after) or after.get(field) == binding[field],
                                 'practice_receipt_body_mismatch')
                state = receipt.get('status')
                _require(state in RECEIPT_STATES and type(receipt.get('completionConfirmed')) is bool,
                         'practice_invalid_receipt_state')
                result = receipt.get('result') if isinstance(receipt.get('result'), dict) else {}
                native = result.get('result') if isinstance(result.get('result'), dict) else {}
                uncertain = result.get('code') == 'outcome_unknown'
                success = (not uncertain and state == 'completed' and receipt['completionConfirmed']
                           and result.get('ok') is True and native.get('success') is True)
                terminal_success = None
                navigation = receipt.get('navigationOutcome')
                if navigation is not None:
                    _require(step['tool'] == 'goto' and isinstance(navigation, dict),
                             'practice_native_identity_mismatch')
                    if navigation.get('navigation_mode') == 'observed_from_body':
                        terminal_success = _observed_navigation(receipt, before, after, navigation)
                    else:
                        _require(bool(receipt.get('nativeTaskId')) and bool(before.get('navigationEpoch'))
                                 and navigation.get('task_id') == receipt['nativeTaskId']
                                 and navigation.get('navigation_epoch') == before['navigationEpoch']
                                 and type(navigation.get('success')) is bool, 'practice_native_identity_mismatch')
                        if 'state' in navigation:
                            _require(navigation['state'] in ('success', 'failed', 'timeout', 'cancelled')
                                     and navigation['success'] == (navigation['state'] == 'success'),
                                     'practice_invalid_native_terminal')
                        terminal_success = navigation['success']
                food = receipt.get('nativeFoodOutcome')
                if food is not None:
                    expected = native.get('nativeFoodReceipt')
                    _require(step['tool'] == 'eat' and isinstance(food, dict) and isinstance(expected, dict)
                             and all(food.get(k) == expected.get(k) for k in
                                     ('epoch', 'actorUuid', 'requestId', 'tool', 'args', 'nativeTaskId'))
                             and food.get('requestId') == action and food.get('actorUuid') == binding['bodyUuid']
                             and food.get('args') == json.loads(step['args'])
                             and food.get('nativeTaskId') == receipt.get('nativeTaskId')
                             and bool(food.get('epoch')) and food.get('status') == 'terminal'
                             and food.get('nativeState') in ('SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED')
                             and isinstance(food.get('result'), dict)
                             and type(food['result'].get('success')) is bool
                             and food['result']['success'] == (food['nativeState'] == 'SUCCESS'),
                             'practice_native_identity_mismatch')
                    terminal_success = food['result']['success']
                if terminal_success is not None:
                    success = success and terminal_success
                if step['tool'] == 'goto' and receipt.get('nativeTaskId') and navigation is None:
                    success = False
                if step['tool'] == 'eat' and receipt.get('nativeTaskId') and food is None:
                    success = False
                failure = (state == 'failed' and receipt['completionConfirmed']
                           and (terminal_success is False or result.get('ok') is False and native.get('success') is False))
                complete = not uncertain and (success or failure
                    or state == 'rejected' and result.get('ok') is False and native.get('success') is False)
                immutable = _json({'runId': run_id, 'turnId': turn_id, 'tool': step['tool'],
                                   'args': json.loads(step['args']), 'before': before})
                content = _json(receipt)
                sha = hashlib.sha256(content.encode()).hexdigest()
                old = db.execute('SELECT * FROM receipts WHERE action_id=?', (action,)).fetchone()
                other = db.execute('SELECT action_id FROM receipts WHERE run_id=? AND turn_id=?',
                                   (run_id, turn_id)).fetchone()
                _require(other is None or other['action_id'] == action, 'practice_action_changed')
                if old:
                    _require(old['identity'] == immutable, 'practice_receipt_identity_changed')
                    if old['sha256'] == sha:
                        continue
                    _require(not old['complete'], 'practice_terminal_receipt_changed')
                    prior = json.loads(old['content'])
                    for field in ('nativeTaskId',):
                        _require(not prior.get(field) or prior.get(field) == receipt.get(field),
                                 'practice_receipt_identity_changed')
                    previous_result = prior.get('result') if isinstance(prior.get('result'), dict) else {}
                    previous_native = previous_result.get('result') if isinstance(previous_result.get('result'), dict) else {}
                    previous_food = previous_native.get('nativeFoodReceipt')
                    if isinstance(previous_food, dict):
                        incoming_food = native.get('nativeFoodReceipt')
                        _require(isinstance(incoming_food, dict) and all(incoming_food.get(k) == previous_food.get(k)
                            for k in ('epoch', 'actorUuid', 'requestId', 'tool', 'args', 'nativeTaskId')),
                            'practice_receipt_identity_changed')
                    _require(state not in ('unknown',) or prior['status'] == 'unknown', 'practice_receipt_regressed')
                db.execute('INSERT OR REPLACE INTO receipts VALUES (?,?,?,?,?,?,?,?)',
                           (action, run_id, turn_id, immutable, content, sha, int(complete), int(success)))
                changed = True
            return self._summary(db, run) | {'changed': changed}

    def capture_turn(self, turn_id, receipts):
        _identifier(turn_id, TURN_ID, 'practice_invalid_turn')
        if not self.path.is_file():
            return {'matched': False}
        with self._db() as db:
            row = db.execute('SELECT run_id FROM steps WHERE turn_id=?', (turn_id,)).fetchone()
        return {'matched': False} if row is None else self.capture(row['run_id'], turn_id, receipts) | {'matched': True}

    def turns(self, run_id):
        """Original turns for bounded receipt recovery, never action redispatch."""
        _identifier(run_id, VERSION, 'practice_invalid_run_id')
        with self._db() as db:
            self._run(db, run_id)
            rows = db.execute('SELECT turn_id FROM steps WHERE run_id=? '
                              'ORDER BY created,rowid LIMIT 128', (run_id,)).fetchall()
            return [row['turn_id'] for row in rows]

    def finish(self, run_id, job, body):
        _require(isinstance(job, dict), 'practice_invalid_job')
        with self._db(True) as db:
            run = self._run(db, run_id)
            binding = json.loads(run['binding'])
            _require(job.get('practiceRunId') == run_id and all(job.get(k) == binding[k]
                     for k in ('name', 'version')) and job.get('turnId') == binding['requestTurnId']
                     and validate_objective(job.get('objective')) == binding['objective'], 'practice_run_binding_mismatch')
            status = job.get('status')
            _require(status in TERMINALS and run['status'] in ('running', status), 'practice_invalid_terminal')
            snapshot = _body(body)
            _require(all(snapshot[k] == binding[k] for k in ('bodyUuid', 'dimension')), 'practice_body_mismatch')
            # Capture the finish observation once. Later receipts can settle, but
            # unrelated later inventory changes cannot rewrite the run's outcome.
            final = run['final'] or _json(snapshot)
            changed = run['status'] != status or run['final'] is None
            if changed:
                db.execute('UPDATE runs SET status=?, final=?, finished=COALESCE(finished,?) WHERE run_id=?',
                           (status, final, self.clock(), run_id))
            return self._summary(db, self._run(db, run_id)) | {'changed': changed}

    def _summary(self, db, run):
        rows = db.execute('SELECT s.tool,r.complete,r.success FROM steps s LEFT JOIN receipts r '
                          'ON r.run_id=s.run_id AND r.turn_id=s.turn_id WHERE s.run_id=?', (run['run_id'],)).fetchall()
        complete = bool(rows) and all(row['complete'] == 1 for row in rows)
        binding = json.loads(run['binding'])
        checks = []
        final = json.loads(run['final']) if run['final'] else None
        initial = json.loads(run['initial'])
        objective = binding['objective']
        if objective and final:
            for check in objective['checks']:
                observed = (final['counts'].get(check['item'], 0) - initial['counts'].get(check['item'], 0)
                    if check['kind'] == 'inventory_gain' else sum(row['success'] == 1 and row['tool'] == check['tool'] for row in rows))
                checks.append({'kind': check['kind'], 'observed': observed, 'required': check['count'],
                               'met': observed >= check['count'], 'causalAttributionVerified': False})
        observed = None if objective is None else bool(final and complete and checks and all(c['met'] for c in checks))
        return {'available': True, 'runId': run['run_id'], 'name': run['name'], 'version': run['version'],
                'kernelVersion': binding['kernelVersion'], 'status': run['status'],
                'createdAt': run['created'], 'finishedAt': run['finished'], 'stepCount': len(rows),
                'ownConfirmedActions': sum(row['success'] == 1 for row in rows),
                'evidenceComplete': complete, 'programReportedDone': run['status'] == 'done',
                'objectiveObserved': observed, 'masteryVerified': False, 'checks': checks}

    def _read(self, name, version, limit, details):
        if name is not None:
            _identifier(name, NAME, 'practice_invalid_name')
        if version is not None:
            _identifier(version, VERSION, 'practice_invalid_version')
        _require(type(limit) is int and 1 <= limit <= 3, 'practice_invalid_limit')
        if not self.path.is_file():
            return {'available': False, 'runs': []}
        with self._db() as db:
            where, args = [], []
            for column, value in (('name', name), ('version', version)):
                if value is not None:
                    where.append(column + '=?')
                    args.append(value)
            query = 'SELECT * FROM runs' + (' WHERE ' + ' AND '.join(where) if where else '')
            runs = db.execute(query + ' ORDER BY created DESC,run_id DESC LIMIT ?', (*args, limit)).fetchall()
            results = []
            for run in runs:
                item = self._summary(db, run)
                if details:
                    item.update(binding=json.loads(run['binding']), initialObservation=json.loads(run['initial']),
                                finalObservation=json.loads(run['final']) if run['final'] else None)
                    steps = db.execute('SELECT s.*,r.content,r.sha256,r.complete,r.success FROM steps s '
                        'LEFT JOIN receipts r ON r.run_id=s.run_id AND r.turn_id=s.turn_id '
                        'WHERE s.run_id=? ORDER BY s.created DESC,s.rowid DESC LIMIT 8', (run['run_id'],)).fetchall()
                    item['steps'] = [self._step_view(row) for row in reversed(steps)]
                    item['stepsTruncated'] = item['stepCount'] > 8
                    item['refinements'] = [json.loads(row[0]) for row in db.execute(
                        'SELECT content FROM refinements WHERE name=? AND version=? ORDER BY created DESC,id DESC LIMIT 3',
                        (run['name'], run['version']))]
                results.append(item)
            output = {'available': True, 'runs': results}
            if details:
                output['refinements'] = [json.loads(row[0]) for row in db.execute(
                    'SELECT content FROM refinements WHERE name=? AND version=? ORDER BY created DESC,id DESC LIMIT 3',
                    (name, version))]
            return output

    @staticmethod
    def _step_view(row):
        result = {'stepId': row['step_id'], 'turnId': row['turn_id'], 'tool': row['tool'],
                  'args': json.loads(row['args']), 'receiptSha256': row['sha256'],
                  'evidenceComplete': row['complete'] == 1, 'confirmedSuccess': row['success'] == 1}
        if row['content']:
            receipt = json.loads(row['content'])
            result.update(actionId=receipt['actionId'], status=receipt['status'])
            reply = receipt.get('result') if isinstance(receipt.get('result'), dict) else {}
            native = reply.get('result') if isinstance(reply.get('result'), dict) else {}
            result['code'] = str(reply.get('code', ''))[:100]
            result['message'] = str(native.get('message', ''))[:600]
            result['before'] = _body(receipt['before'])
            if isinstance(receipt.get('after'), dict) and receipt['after'].get('ok') is True:
                result['after'] = _body(receipt['after'])
        else:
            result['status'] = 'missing_receipt'
        return result

    def summarize(self, name=None, version=None, limit=3):
        return self._read(name, version, limit, False)

    def read(self, name, version, limit=3):
        return self._read(name, version, limit, True)

    def validate_refinement(self, name, refinement):
        _identifier(name, NAME, 'practice_invalid_name')
        if refinement is None:
            return None
        _require(isinstance(refinement, dict) and set(refinement) == {'run_ids', 'hypothesis', 'expected_outcome'}
                 and _text(refinement['hypothesis'], 800) and _text(refinement['expected_outcome'], 600),
                 'practice_invalid_refinement')
        ids = refinement['run_ids']
        _require(isinstance(ids, list) and 1 <= len(ids) <= 3 and all(isinstance(i, str) for i in ids)
                 and len(set(ids)) == len(ids), 'practice_invalid_refinement_runs')
        with self._db() as db:
            for identity in ids:
                run = self._run(db, identity)
                _require(run['name'] == name, 'practice_refinement_skill_mismatch')
        return json.loads(_json(refinement, 8192))

    def save_refinement(self, name, version, refinement):
        _identifier(name, NAME, 'practice_invalid_name')
        _identifier(version, VERSION, 'practice_invalid_version')
        normalized = self.validate_refinement(name, refinement)
        if normalized is None:
            return {'saved': False, 'available': self.path.is_file()}
        with self._db(True) as db:
            parents = []
            for identity in normalized['run_ids']:
                run = self._run(db, identity)
                _require(run['name'] == name, 'practice_refinement_skill_mismatch')
                parents.append({'runId': identity, 'version': run['version']})
            value = {'name': name, 'version': version, **normalized, 'parentRuns': parents,
                     'evidenceType': 'agent_reported', 'independentlyVerified': False,
                     'expectedOutcomeObserved': False}
            encoded = _json(value, 8192)
            identity = _hash(value)
            changed = db.execute('INSERT OR IGNORE INTO refinements VALUES (?,?,?,?,?)',
                                 (identity, name, version, encoded, self.clock())).rowcount == 1
            return {'available': True, 'saved': True, 'changed': changed, 'refinementId': identity,
                    'evidenceType': 'agent_reported', 'expectedOutcomeObserved': False}

    def health(self):
        if not self.path.is_file():
            return {'available': False, 'schema': None, 'runCount': 0, 'stepCount': 0,
                    'receiptCount': 0, 'refinementCount': 0}
        with self._db() as db:
            return {'available': True, 'schema': SCHEMA, **{label: db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                for label, table in (('runCount', 'runs'), ('stepCount', 'steps'),
                                     ('receiptCount', 'receipts'), ('refinementCount', 'refinements'))}}
