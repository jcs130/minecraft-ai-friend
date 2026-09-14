"""Durable native dialogue inputs, consumed only by the original Yui life loop.

This is transport bookkeeping, never a scheduler, model client or speech queue.
The native callback does not identify the speaker, so inputs remain private.
"""
from contextlib import contextmanager
import json
from pathlib import Path
import re
import sqlite3
import time

from maid_identity import canonical_uuid
from party_role_capabilities import YUI_AGENT_ID, YUI_BODY_UUID, SURVIVOR_BODY_UUID

DELIVERY = 'perception_queue_v1'
MAX_RETAINED = 4096
MAX_TEXT = 8000
MAX_BATCH = 8
MAX_BATCH_CHARS = 10000


def binding_key(binding):
    value = {'agentId': binding['agentId'],
             'maidUuid': binding.get('maidUuid', binding.get('bodyUuid')),
             'ownerUuid': binding['ownerUuid'], 'sessionId': binding['sessionId']}
    if (value['agentId'] != YUI_AGENT_ID or value['maidUuid'] != YUI_BODY_UUID
            or value['ownerUuid'] != SURVIVOR_BODY_UUID
            or not isinstance(value['sessionId'], str) or not 1 <= len(value['sessionId']) <= 180):
        raise ValueError('perception_consumer_binding_invalid')
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


class MaidPerceptionInbox:
    def __init__(self, root, clock=time.time):
        self.root, self.clock = Path(root), clock
        self.path = self.root / 'perception-inbox.sqlite3'
        self.root.mkdir(parents=True, exist_ok=True)
        if self.root.is_symlink() or self.path.is_symlink():
            raise ValueError('linked_perception_inbox')
        with self._connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS inputs (
                seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
                body_sha TEXT NOT NULL, binding TEXT NOT NULL, payload TEXT NOT NULL,
                received_at REAL NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                batch_key TEXT, task_id TEXT, finished_at REAL)''')
            db.execute('CREATE INDEX IF NOT EXISTS pending_inputs ON inputs(binding, state, seq)')

    @contextmanager
    def _connect(self, *, readonly=False):
        if self.path.is_symlink():
            raise ValueError('linked_perception_inbox')
        db = sqlite3.connect(self.path.as_uri() + '?mode=ro' if readonly else str(self.path),
                             uri=readonly, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            if not readonly:
                db.execute('PRAGMA synchronous=FULL')
                db.execute('BEGIN IMMEDIATE')
            else:
                db.execute('BEGIN')  # Count and rows use one consistent snapshot.
            yield db
            if not readonly:
                db.commit()
        except Exception:
            if not readonly:
                db.rollback()
            raise
        finally:
            db.close()

    def accept(self, trusted, binding):
        key = binding_key(binding)
        actor, body = trusted['identity'], trusted['body']
        if (actor['maidUuid'] != YUI_BODY_UUID or actor['ownerUuid'] != SURVIVOR_BODY_UUID
                or body.get('qd_delivery') != DELIVERY):
            raise ValueError('perception_input_binding_invalid')
        event_id = canonical_uuid(trusted['requestId'])
        digest = trusted['bodySha256']
        if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError('perception_digest_invalid')
        users = [m for m in body['messages'] if m['role'] == 'user']
        if not users or not isinstance(users[-1]['content'], str):
            raise ValueError('perception_user_input_required')
        text = users[-1]['content']
        if not text.strip() or len(text) > MAX_TEXT or '\0' in text:
            raise ValueError('perception_input_size_limit')
        payload = {'eventId': event_id, 'text': text,
                   'source': 'tlm_native_dialogue', 'speakerVerified': False,
                   'visibility': 'private', 'observedAt': actor['observedAt'],
                   'receivedAt': self.clock(), 'untrustedEnvironmentData': True}
        encoded = json.dumps(payload, ensure_ascii=False)
        if len('[' + encoded + ']') > MAX_BATCH_CHARS:
            raise ValueError('perception_input_size_limit')
        with self._connect() as db:
            previous = db.execute('SELECT body_sha,binding FROM inputs WHERE event_id=?', (event_id,)).fetchone()
            if previous:
                if previous['body_sha'] != digest or previous['binding'] != key:
                    raise ValueError('perception_request_id_conflict')
            else:
                if db.execute('SELECT count(*) FROM inputs').fetchone()[0] >= MAX_RETAINED:
                    raise ValueError('perception_inbox_full')
                db.execute('INSERT INTO inputs(event_id,body_sha,binding,payload,received_at) VALUES(?,?,?,?,?)',
                           (event_id, digest, key, encoded, self.clock()))
        # This acknowledges durable receipt only, even if a previous identical
        # request has since been consumed. It is never an assistant completion.
        return {'schema': 1, 'object': 'qiandeng.maid.input_receipt', 'request_id': event_id,
                'state': 'queued', 'persisted': True, 'wake_requested': False, 'assistant_reply': False}

    def pending(self, binding, *, max_chars=MAX_BATCH_CHARS):
        key = binding_key(binding)
        max_chars = max(0, min(MAX_BATCH_CHARS, max_chars))
        with self._connect(readonly=True) as db:
            count = db.execute("SELECT count(*) FROM inputs WHERE binding=? AND state='pending'", (key,)).fetchone()[0]
            rows = db.execute("SELECT payload FROM inputs WHERE binding=? AND state='pending' ORDER BY seq LIMIT ?",
                              (key, MAX_BATCH)).fetchall()
        events = []
        for row in rows:
            event = json.loads(row['payload'])
            if len(json.dumps(events + [event], ensure_ascii=False)) > max_chars:
                break  # Keep a whole oversized head item; never silently truncate it.
            events.append(event)
        return {'events': events, 'pendingCountAtSelection': count,
                'remainingCount': count - len(events), 'wakeOnInput': False,
                'headDeferredByContextBudget': bool(rows and not events),
                'consumptionIsNotSpeech': True}

    def reserve(self, binding, event_ids, batch_key):
        key = binding_key(binding)
        if (len(event_ids) > MAX_BATCH or len(event_ids) != len(set(event_ids))
                or not re.fullmatch('party-life-[a-f0-9]{64}', batch_key)):
            raise ValueError('perception_batch_invalid')
        with self._connect() as db:
            for event_id in event_ids:
                canonical_uuid(event_id)
                row = db.execute('SELECT binding,state,batch_key FROM inputs WHERE event_id=?', (event_id,)).fetchone()
                if (not row or row['binding'] != key or
                        (row['state'] != 'pending' and row['batch_key'] != batch_key)):
                    raise ValueError('perception_batch_conflict')
                if row['state'] == 'pending':
                    db.execute("UPDATE inputs SET state='claimed',batch_key=? WHERE event_id=?", (batch_key, event_id))

    def finish(self, binding, event_ids, batch_key, task_id, status):
        key = binding_key(binding)
        if status not in ('completed', 'failed') or not re.fullmatch('task-[A-Za-z0-9_-]{1,100}', task_id or ''):
            raise ValueError('perception_terminal_task_required')
        target = 'consumed' if status == 'completed' else 'failed'
        with self._connect() as db:
            for event_id in event_ids:
                row = db.execute('SELECT * FROM inputs WHERE event_id=?', (event_id,)).fetchone()
                if (not row or row['binding'] != key or row['batch_key'] != batch_key
                        or row['state'] not in ('claimed', target)
                        or (row['state'] == target and row['task_id'] != task_id)):
                    raise ValueError('perception_consumption_conflict')
                db.execute('UPDATE inputs SET state=?,task_id=?,finished_at=? WHERE event_id=?',
                           (target, task_id, row['finished_at'] or self.clock(), event_id))
        # Failed/unknown model tasks might have executed tools. Never retry the
        # same inputs under another paid task automatically; retain the evidence.

    def summary(self, binding):
        key = binding_key(binding)
        with self._connect(readonly=True) as db:
            counts = {state: 0 for state in ('pending', 'claimed', 'consumed', 'failed')}
            for row in db.execute('SELECT state,count(*) AS total FROM inputs GROUP BY state'):
                if row['state'] not in counts:
                    raise ValueError('perception_state_invalid')
                counts[row['state']] = row['total']
            stale = db.execute("SELECT count(*) FROM inputs WHERE binding<>? AND state IN ('pending','claimed')", (key,)).fetchone()[0]
        return {'schema': 1, 'persistent': True, 'wakeOnInput': False,
                'currentBindingValid': stale == 0, 'counts': counts, 'totalRetained': sum(counts.values()),
                'capacity': MAX_RETAINED, 'maxBatch': MAX_BATCH, 'assistantReply': False}
