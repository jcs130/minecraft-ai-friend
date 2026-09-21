"""Versioned conversation commitments in the existing review SQLite store.

This module does no inference or body I/O. Reported completion is a model/user
claim, never a verified world result. The controller adopts selections through
its existing goal-change boundary, preserving actions with unknown outcomes.
"""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import time
import uuid

from review import ReviewQueue, REQUEST_ID


LIVE = ('pending', 'active')
TERMINAL = ('completed_reported', 'cancelled', 'superseded')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def require(condition, code):
    if not condition:
        raise ValueError(code)


class GoalAgenda:
    def __init__(self, state, clock=time.time):
        self.root, self.clock = Path(state), clock
        self.store = ReviewQueue(state, clock)

    def scope(self):
        settings = json.loads((self.root / 'settings.json').read_text(encoding='utf8'))
        identity = {key: settings.get(key) for key in ('bodyUuid', 'ownerUuid', 'memoryEpoch')}
        require(isinstance(identity['bodyUuid'], str) and bool(identity['bodyUuid'])
                and (identity['ownerUuid'] is None or isinstance(identity['ownerUuid'], str)), 'goal_binding_unavailable')
        return hashlib.sha256(encoded(identity).encode()).hexdigest()

    @contextmanager
    def db(self):
        with self.store._db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS conversation_goals (
                id TEXT PRIMARY KEY, scope TEXT NOT NULL, revision INTEGER NOT NULL,
                goal TEXT NOT NULL, state TEXT NOT NULL, after_id TEXT,
                created INTEGER NOT NULL, updated INTEGER NOT NULL, evidence TEXT NOT NULL DEFAULT '')''')
            db.execute('''CREATE UNIQUE INDEX IF NOT EXISTS conversation_goal_active
                ON conversation_goals(scope) WHERE state='active' ''')
            db.execute('''CREATE TABLE IF NOT EXISTS goal_requests (
                scope TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL,
                result TEXT NOT NULL, PRIMARY KEY(scope,request_id))''')
            yield db

    @staticmethod
    def public(row):
        return {'goalId': row['id'], 'revision': row['revision'], 'goal': row['goal'],
                'state': row['state'], 'afterGoalId': row['after_id'],
                'createdAt': row['created'], 'updatedAt': row['updated'],
                'evidence': row['evidence'], 'completionVerified': False}

    @staticmethod
    def text(goal):
        require(isinstance(goal, str) and 1 <= len(goal.strip()) <= 1200 and '\0' not in goal,
                'invalid_conversation_goal')
        return goal.strip()

    def transact(self, request_id, payload, operation):
        require(isinstance(request_id, str) and REQUEST_ID.fullmatch(request_id), 'invalid_goal_request_id')
        scope, packed = self.scope(), encoded(payload)
        with self.db() as db:
            old = db.execute('SELECT payload,result FROM goal_requests WHERE scope=? AND request_id=?',
                             (scope, request_id)).fetchone()
            if old:
                require(old['payload'] == packed, 'goal_request_conflict')
                return json.loads(old['result']) | {'duplicate': True}
            require(db.execute('SELECT COUNT(*) FROM goal_requests WHERE scope=?', (scope,)).fetchone()[0] < 10000,
                    'goal_history_full')
            result = operation(db, scope, int(self.clock() * 1000))
            db.execute('INSERT INTO goal_requests VALUES(?,?,?,?)', (scope, request_id, packed, encoded(result)))
            return result

    def request(self, goal, request_id=None, mode='queue', after_goal_id=None):
        goal = self.text(goal)
        require(mode in ('queue', 'replace'), 'invalid_goal_mode')
        require(after_goal_id is None or isinstance(after_goal_id, str), 'invalid_goal_dependency')
        require(mode != 'replace' or after_goal_id is None, 'invalid_goal_dependency')
        request_id = str(uuid.uuid4()) if request_id is None else request_id
        def apply(db, scope, now):
            require(db.execute("SELECT COUNT(*) FROM conversation_goals WHERE scope=? AND state IN ('pending','active')",
                               (scope,)).fetchone()[0] < 32, 'goal_queue_full')
            if after_goal_id:
                require(db.execute('SELECT 1 FROM conversation_goals WHERE scope=? AND id=?',
                                   (scope, after_goal_id)).fetchone() is not None, 'goal_dependency_unknown')
            if mode == 'replace':
                db.execute("UPDATE conversation_goals SET state='superseded',revision=revision+1,updated=? "
                           "WHERE scope=? AND state='active'", (now, scope))
            identity = str(uuid.uuid4())
            state = 'active' if mode == 'replace' else 'pending'
            db.execute('INSERT INTO conversation_goals(id,scope,revision,goal,state,after_id,created,updated) '
                       'VALUES(?,?,1,?,?,?,?,?)', (identity, scope, goal, state, after_goal_id, now, now))
            return {'ok': True, 'code': 'goal_queued', 'intentId': identity, 'goalId': identity,
                    'revision': 1, 'state': state, 'executionConfirmed': False,
                    'autonomyEnabledChanged': False, 'completionVerified': False,
                    'summary': '承诺已保存；排队或切换由原调度器处理，当前动作与暂停状态保持。'}
        return self.transact(request_id, {'operation': 'request', 'goal': goal, 'mode': mode,
                                         'afterGoalId': after_goal_id}, apply)

    def update(self, goal_id, revision, operation, request_id, *, goal='', evidence=''):
        require(operation in ('revise', 'cancel', 'finish'), 'invalid_goal_operation')
        require(isinstance(goal_id, str) and type(revision) is int and revision > 0, 'invalid_goal_revision')
        require(isinstance(evidence, str) and len(evidence) <= 1200 and '\0' not in evidence,
                'invalid_goal_evidence')
        require(operation != 'finish' or bool(evidence.strip()), 'goal_completion_evidence_required')
        goal = self.text(goal) if operation == 'revise' else ''
        def apply(db, scope, now):
            row = db.execute('SELECT * FROM conversation_goals WHERE scope=? AND id=?', (scope, goal_id)).fetchone()
            require(row is not None, 'goal_not_found')
            require(row['revision'] == revision, 'goal_revision_conflict')
            require(row['state'] in LIVE, 'goal_already_terminal')
            require(operation != 'finish' or row['state'] == 'active', 'goal_not_active')
            state = {'cancel': 'cancelled', 'finish': 'completed_reported'}.get(operation, row['state'])
            db.execute('UPDATE conversation_goals SET revision=revision+1,goal=?,state=?,evidence=?,updated=? WHERE id=?',
                       (goal if operation == 'revise' else row['goal'], state, evidence, now, goal_id))
            return {'ok': True, **self.public(db.execute('SELECT * FROM conversation_goals WHERE id=?', (goal_id,)).fetchone()),
                    'executionConfirmed': False}
        return self.transact(request_id, {'operation': operation, 'goalId': goal_id, 'revision': revision,
                                         'goal': goal, 'evidence': evidence}, apply)

    def import_legacy(self, intent, consumed_id):
        identity, goal = intent.get('id'), self.text(intent.get('goal'))
        require(isinstance(identity, str) and str(uuid.UUID(identity)) == identity, 'invalid_conversation_intent')
        # Keep the original file and record an idempotent migration, not a replay.
        def apply(db, scope, now):
            if identity != consumed_id and not db.execute('SELECT 1 FROM conversation_goals WHERE id=?', (identity,)).fetchone():
                db.execute('INSERT INTO conversation_goals(id,scope,revision,goal,state,created,updated) '
                           "VALUES(?,?,1,?,'pending',?,?)", (identity, scope, goal, now, now))
            return {'ok': True, 'legacyId': identity}
        return self.transact('legacy:' + identity, {'operation': 'legacy', 'goal': goal}, apply)

    def select(self, activate=True):
        """Durably choose one ready goal. No claim about physical execution."""
        if not self.store.path.exists():
            return None
        scope = self.scope()
        with self.db() as db:
            row = db.execute("SELECT * FROM conversation_goals WHERE scope=? AND state='active'", (scope,)).fetchone()
            if not row and activate:
                row = db.execute("SELECT g.* FROM conversation_goals g LEFT JOIN conversation_goals p ON p.id=g.after_id "
                                 "WHERE g.scope=? AND g.state='pending' AND (g.after_id IS NULL OR "
                                 "(p.scope=g.scope AND p.state='completed_reported')) ORDER BY g.created,g.rowid LIMIT 1",
                                 (scope,)).fetchone()
                if row:
                    db.execute("UPDATE conversation_goals SET state='active' WHERE id=?", (row['id'],))
                    row = db.execute('SELECT * FROM conversation_goals WHERE id=?', (row['id'],)).fetchone()
            return self.public(row) if row else None

    def snapshot(self):
        if not self.store.path.exists():
            return {'ok': True, 'version': 1, 'goals': [], 'counts': {}}
        scope = self.scope()
        require(not self.store.path.is_symlink(), 'goal_store_linked')
        db = sqlite3.connect(self.store.path.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_goals'").fetchone():
                return {'ok': True, 'version': 1, 'goals': [], 'counts': {}}
            counts = {row['state']: row['n'] for row in db.execute(
                'SELECT state,COUNT(*) n FROM conversation_goals WHERE scope=? GROUP BY state', (scope,))}
            rows = db.execute("SELECT * FROM conversation_goals WHERE scope=? ORDER BY "
                              "CASE state WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,"
                              "CASE WHEN state='pending' THEN created ELSE -created END,rowid LIMIT 32", (scope,))
            return {'ok': True, 'version': 1, 'goals': [self.public(r) for r in rows], 'counts': counts,
                    'notice': 'completed_reported 是角色/用户报告，不是独立世界验收；依赖取消或覆盖不会自动执行。'}
        finally:
            db.close()


def goal_operation(state, operation='list', *, clock=time.time, **kwargs):
    try:
        agenda = GoalAgenda(state, clock)
        if operation == 'list':
            return agenda.snapshot()
        return agenda.update(operation=operation, **kwargs)
    except (OSError, ValueError, TypeError, sqlite3.Error) as exc:
        return {'ok': False, 'code': str(exc) if isinstance(exc, ValueError) else 'goal_store_unavailable',
                'retryAutomatically': False}
