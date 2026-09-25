"""Durable review signals, consumed by the existing life-task owner only.

No model or game calls. SQLite makes concurrent cron intake and controller
acknowledgement atomic; a task acknowledges its captured sequence, never the
latest signal. Request IDs remain unique across restarts and completed batches.
"""
from contextlib import contextmanager
from pathlib import Path
import re
import sqlite3
import time

REQUEST_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,159}')


class ReviewQueue:
    def __init__(self, state, clock=time.time):
        self.path = Path(state) / 'reviews.sqlite3'
        self.clock = clock

    @contextmanager
    def _db(self):
        if self.path.is_symlink():
            raise ValueError('review_store_linked')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS requests (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                       'request_id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, evidence TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS acknowledgements (watermark INTEGER PRIMARY KEY, '
                       'task_id TEXT NOT NULL, at INTEGER NOT NULL)')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _consumed(db):
        return db.execute('SELECT COALESCE(MAX(watermark),0) FROM acknowledgements').fetchone()[0]

    def request(self, request_id, reason='scheduled'):
        """Public intake cannot invent a successful game sleep."""
        if reason != 'scheduled':
            return {'ok': False, 'code': 'invalid_review_reason'}
        if isinstance(request_id, str) and request_id.startswith('sleep:'):
            return {'ok': False, 'code': 'reserved_review_request_id'}
        return self._request(request_id, reason)

    def _request(self, request_id, reason, evidence=None):
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            return {'ok': False, 'code': 'invalid_review_request_id'}
        try:
            with self._db() as db:
                previous = db.execute('SELECT seq,reason,evidence FROM requests WHERE request_id=?', (request_id,)).fetchone()
                if previous:
                    if (previous['reason'], previous['evidence']) != (reason, evidence):
                        return {'ok': False, 'code': 'review_request_conflict'}
                    return {'ok': True, 'code': 'review_already_requested',
                            'reviewId': 'review-' + str(previous['seq']), 'coalesced': True}
                pending = db.execute('SELECT 1 FROM requests WHERE seq>? LIMIT 1', (self._consumed(db),)).fetchone()
                row = db.execute('INSERT INTO requests(request_id,reason,at,evidence) VALUES(?,?,?,?)',
                                 (request_id, reason, int(self.clock() * 1000), evidence))
                return {'ok': True, 'code': 'review_queued', 'reviewId': 'review-' + str(row.lastrowid),
                        'coalesced': bool(pending)}
        except (OSError, ValueError, sqlite3.Error):
            return {'ok': False, 'code': 'review_store_unavailable'}

    def sleep_receipt(self, row):
        """Only a real, verified native sleep-action receipt can add this reason.

        It proves entering sleep, not a full night's rest or waking up.
        """
        if (not isinstance(row, dict) or row.get('schema') != 2 or row.get('tool') != 'sleep'
                or row.get('status') != 'completed'):
            return None
        result = row.get('result')
        if not isinstance(result, dict):
            return None
        native = result.get('result')
        if not isinstance(native, dict):
            return None
        data = native.get('data')
        if not isinstance(data, dict):
            return None
        action_id = row.get('actionId')
        if (row.get('schema') != 2 or row.get('tool') != 'sleep' or row.get('status') != 'completed'
                or row.get('completionConfirmed') is not True or result.get('ok') is not True
                or result.get('completionConfirmed') is not True or native.get('success') is not True
                or data.get('verified') is not True or data.get('sleeping') is not True
                or not isinstance(action_id, str) or not re.fullmatch(r'[0-9a-f]{32}', action_id)):
            return None
        return self._request('sleep:' + action_id, 'sleep_completed', action_id)

    def pending(self):
        """Bounded context snapshot; reading never acknowledges a signal."""
        with self._db() as db:
            consumed = self._consumed(db)
            row = db.execute('SELECT MAX(seq) AS watermark,COUNT(*) AS count,MIN(at) AS first_at,MAX(at) AS last_at '
                             'FROM requests WHERE seq>?', (consumed,)).fetchone()
            if not row['count']:
                return None
            reasons = [r[0] for r in db.execute('SELECT DISTINCT reason FROM requests WHERE seq>? ORDER BY reason', (consumed,))]
            sleep = db.execute('SELECT evidence FROM requests WHERE seq>? AND reason=? ORDER BY seq DESC LIMIT 1',
                               (consumed, 'sleep_completed')).fetchone()
            return {'reviewId': 'review-' + str(row['watermark']), 'watermark': row['watermark'],
                    'reasons': reasons, 'signalCount': row['count'], 'firstRequestedAt': row['first_at'],
                    'lastRequestedAt': row['last_at'], 'sleepActionId': sleep[0] if sleep else None,
                    'notice': ('sleep_completed only verifies entering sleep, not waking or sleeping through the night. '
                               'Observe actual body/rest state first; do not interrupt rest for this review.')}

    def acknowledge(self, snapshot, task_id):
        """Known native terminal only; no new signal can be swallowed by an old task."""
        watermark = snapshot.get('watermark')
        if (type(watermark) is not int or watermark < 1 or snapshot.get('reviewId') != 'review-' + str(watermark)
                or not isinstance(task_id, str) or not 1 <= len(task_id) <= 160):
            raise ValueError('invalid_review_acknowledgement')
        with self._db() as db:
            old = db.execute('SELECT task_id FROM acknowledgements WHERE watermark=?', (watermark,)).fetchone()
            if old:
                if old[0] != task_id:
                    raise ValueError('review_task_mismatch')
                return
            if not db.execute('SELECT 1 FROM requests WHERE seq=?', (watermark,)).fetchone():
                raise ValueError('review_watermark_unknown')
            db.execute('INSERT INTO acknowledgements(watermark,task_id,at) VALUES(?,?,?)',
                       (watermark, task_id, int(self.clock() * 1000)))
