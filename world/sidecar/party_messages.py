"""Durable two-member messages, with no network, agent loop, or game actions.

The caller authenticates ``sender_agent_id`` and supplies a trusted, local
``binding_provider``. Neither message text nor a claimed body identity is used
as authority. The provider is re-read inside every transaction; the dispatcher
must also resolve the real body/session immediately before external submission.

``reserve_dispatch`` commits UNKNOWN and a party reservation before returning
``claimed=True``. Only that return authorizes one external submission. Its
stable taskKey can be used in the existing QwenTasks ledger. The party state and
party reservation are atomic together; the *external* role-budget reservation
is separate and is not claimed to be part of this SQLite transaction.

Unknown deliveries never requeue on timeout/restart. ``mark_deferred`` is only
for a trusted, definitive no-submission result, never a timeout/409 guessed
from an exception. Replies are recorded on the original request, not enqueued
as new model tasks. This is a storage API; do not expose dispatch/receipt methods
or trusted incoming-message context directly as model-controlled arguments.
"""
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import time
import uuid
from party_world import speech_event, speech_text, validate_receipt


IDENTITY_FIELDS = ('agentId', 'bodyUuid', 'ownerUuid', 'sessionId', 'userId', 'channel')
ACTIVE = ('unknown', 'submitted')
DEFER_REASONS = frozenset(('busy', 'budget_blocked', 'body_unavailable'))
TERMINAL = ('answered', 'expired', 'failed')
DEFAULT_LIMITS = {'dailyDispatchCap': 12, 'cooldownSeconds': 60, 'maxPending': 32,
                  'maxTextChars': 8000, 'maxTtlSeconds': 86400, 'maxMessages': 10000}


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _identifier(value, field, limit=160):
    _require(isinstance(value, str) and 1 <= len(value) <= limit
             and re.fullmatch(r'[A-Za-z0-9_.:-]+', value), 'invalid_party_' + field)
    return value


def _uuid(value):
    _require(isinstance(value, str), 'invalid_party_uuid')
    try:
        _require(str(uuid.UUID(value)) == value, 'invalid_party_uuid')
    except (ValueError, AttributeError):
        raise ValueError('invalid_party_uuid') from None
    return value


def _safe_path(path):
    _require(not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                     for p in (path, *path.parents)), 'linked_party_state')


def validate_binding(value):
    """Project only public identity fields; never persist tokens/extra config."""
    _require(isinstance(value, dict) and type(value.get('schema')) is int and value['schema'] == 1,
             'invalid_party_binding')
    _require(type(value.get('enabled', True)) is bool, 'invalid_party_binding')
    _require(type(value.get('revision')) is int and 1 <= value['revision'] <= 10**12,
             'invalid_party_revision')
    members = value.get('members')
    _require(isinstance(members, list) and len(members) == 2, 'party_requires_two_members')
    projected = []
    for member in members:
        _require(isinstance(member, dict), 'invalid_party_member')
        item = {key: _uuid(member.get(key)) if key.endswith('Uuid')
                else _identifier(member.get(key), key) for key in IDENTITY_FIELDS}
        _require(item['channel'] == 'console', 'invalid_party_channel')
        projected.append(item)
    _require(len({m['agentId'] for m in projected}) == 2
             and len({m['bodyUuid'] for m in projected}) == 2, 'duplicate_party_member')
    limits = dict(DEFAULT_LIMITS)
    supplied = value.get('limits', {})
    _require(isinstance(supplied, dict), 'invalid_party_limits')
    limits.update({key: supplied[key] for key in limits if key in supplied})
    bounds = {'dailyDispatchCap': (1, 10000), 'cooldownSeconds': (0, 86400),
              'maxPending': (1, 1000), 'maxTextChars': (1, 16000),
              'maxTtlSeconds': (1, 604800), 'maxMessages': (1, 100000)}
    for key, (lo, hi) in bounds.items():
        _require(type(limits[key]) is int and lo <= limits[key] <= hi, 'invalid_party_limits')
    return {'schema': 1, 'partyId': _identifier(value.get('partyId'), 'id'),
            'revision': value['revision'], 'enabled': value.get('enabled', True),
            'members': sorted(projected, key=lambda m: m['agentId']), 'limits': limits}


class PartyMessages:
    def __init__(self, root, binding_provider, clock=time.time):
        _require(callable(binding_provider), 'party_binding_provider_required')
        self.root = Path(root).absolute()
        self.path = self.root / 'party-messages.sqlite3'
        self.binding_provider, self.clock = binding_provider, clock
        _safe_path(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        with self._transaction() as db:
            db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            db.execute('''CREATE TABLE IF NOT EXISTS messages (
                message_id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL,
                binding_revision INTEGER NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
                created REAL NOT NULL, expires REAL NOT NULL, next_attempt REAL NOT NULL DEFAULT 0,
                reservation_id TEXT, task_id TEXT, reply TEXT, detail TEXT)''')
            db.execute('''CREATE TABLE IF NOT EXISTS reservations (
                reservation_id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(message_id),
                recipient TEXT NOT NULL, created REAL NOT NULL, state TEXT NOT NULL,
                task_key TEXT NOT NULL, budget_receipt TEXT NOT NULL, task_id TEXT UNIQUE,
                reason TEXT, usage TEXT)''')
            db.execute('''CREATE TABLE IF NOT EXISTS world_speech (
                event_id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(message_id),
                kind TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, receipt TEXT)''')
            db.execute('CREATE INDEX IF NOT EXISTS party_pending ON messages(recipient,status,created)')
            db.execute('''CREATE UNIQUE INDEX IF NOT EXISTS party_active_recipient ON messages(recipient)
                          WHERE status IN ('unknown','submitted')''')
            self._binding(db)

    def _now(self):
        now = self.clock()
        _require(type(now) in (int, float) and math.isfinite(now) and 0 <= now < 10**14,
                 'invalid_party_clock')
        return float(now)

    @contextmanager
    def _transaction(self):
        for path in (self.root, self.path, Path(str(self.path) + '-journal'),
                     Path(str(self.path) + '-wal'), Path(str(self.path) + '-shm')):
            _safe_path(path)
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _binding(self, db):
        binding = validate_binding(self.binding_provider())
        encoded = _json(binding)
        row = db.execute("SELECT value FROM meta WHERE key='binding'").fetchone()
        if row:
            previous = json.loads(row['value'])
            _require(previous['partyId'] == binding['partyId'], 'party_id_changed')
            _require(binding['revision'] >= previous['revision'], 'party_binding_rollback')
            _require(binding['revision'] != previous['revision'] or row['value'] == encoded,
                     'party_binding_revision_collision')
        db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES ('binding',?)", (encoded,))
        # Only unsent work expires. UNKNOWN/SUBMITTED still occupy their lane.
        db.execute("UPDATE messages SET status='expired',detail='binding_changed' "
                   "WHERE status='pending' AND binding_revision<>?", (binding['revision'],))
        db.execute("UPDATE messages SET status='expired',detail='ttl_expired' "
                   "WHERE status='pending' AND expires<=?", (self._now(),))
        return binding

    @staticmethod
    def _member(binding, actor):
        for member in binding['members']:
            if member['agentId'] == actor:
                return member
        raise ValueError('party_actor_not_member')

    @staticmethod
    def _row(db, message_id):
        _uuid(message_id)
        row = db.execute('SELECT * FROM messages WHERE message_id=?', (message_id,)).fetchone()
        _require(row is not None, 'party_message_not_found')
        return row

    @staticmethod
    def _public(row, actor=None):
        result = json.loads(row['payload'])
        result.update(status=row['status'], reservationId=row['reservation_id'], taskId=row['task_id'],
                      nextAttemptAt=row['next_attempt'], detail=row['detail'],
                      reply=json.loads(row['reply']) if row['reply'] else None,
                      retryAutomatically=False)
        delivery = result.setdefault('worldDelivery', {'eventId': result['messageId'], 'state': 'unknown', 'receipt': None})
        if actor == result['recipient']['agentId'] and delivery['state'] != 'heard':
            result['text'] = None
        reply = result.get('reply')
        result['replyDelivery'] = reply.get('worldDelivery') if reply else None
        if reply and reply.get('worldDelivery', {}).get('state') != 'heard':
            result['reply'] = None
        return result

    def _visible(self, binding, row, actor):
        member = self._member(binding, actor)
        payload = json.loads(row['payload'])
        _require(member in (payload['sender'], payload['recipient']), 'party_message_not_owned')

    @staticmethod
    def _active(db, recipient):
        return db.execute("SELECT * FROM messages WHERE recipient=? AND status IN ('unknown','submitted')",
                          (recipient,)).fetchone()

    def enqueue(self, sender_agent_id, text, *, message_id=None, ttl_seconds=None, incoming_message_id=None, channel='nearby'):
        """One new request; authenticated sender/context come from the bridge.

        For transport idempotency the bridge creates and reuses message_id.
        Supplying incoming_message_id (including a reply id) forbids callbacks;
        an active incoming delivery also blocks sends even if context is absent.
        """
        _require(incoming_message_id is None, 'party_recursive_callback')
        message_id = _uuid(message_id) if message_id is not None else str(uuid.uuid4())
        with self._transaction() as db:
            binding = self._binding(db)
            sender = self._member(binding, sender_agent_id)
            recipient = next(m for m in binding['members'] if m != sender)
            _require(isinstance(text, str) and bool(text.strip()) and '\0' not in text
                     and len(text) <= binding['limits']['maxTextChars'], 'invalid_party_text')
            speech_text(text)
            _require(channel in ('nearby', 'msg'), 'invalid_party_speech_channel')
            ttl = binding['limits']['maxTtlSeconds'] if ttl_seconds is None else ttl_seconds
            _require(type(ttl) is int and 1 <= ttl <= binding['limits']['maxTtlSeconds'], 'invalid_party_ttl')
            old = db.execute('SELECT * FROM messages WHERE message_id=?', (message_id,)).fetchone()
            if old:
                payload = json.loads(old['payload'])
                _require(payload['sender'] == sender and payload['recipient'] == recipient
                         and payload['text'] == text and payload['ttlSeconds'] == ttl
                         and payload.get('channel', 'nearby') == channel
                         and payload['bindingRevision'] == binding['revision'], 'party_message_collision')
                return self._public(old)
            _require(binding['enabled'], 'party_disabled')
            _require(self._active(db, sender_agent_id) is None, 'party_recursive_callback')
            limits = binding['limits']
            pending = db.execute("SELECT count(*) FROM messages WHERE status IN ('pending','unknown','submitted')").fetchone()[0]
            _require(pending < limits['maxPending'], 'party_queue_full')
            _require(db.execute('SELECT count(*) FROM messages').fetchone()[0] < limits['maxMessages'],
                     'party_history_full')  # Never discard message-id tombstones to make space.
            now = self._now()
            payload = {'schema': 1, 'messageId': message_id, 'conversationId': message_id,
                       'taskKey': 'party-' + message_id, 'budgetReceipt': None,
                       'partyId': binding['partyId'], 'bindingRevision': binding['revision'],
                       'bindingSha256': hashlib.sha256(_json(binding).encode()).hexdigest(),
                       'sender': sender, 'recipient': recipient, 'text': text, 'channel': channel,
                       'createdAt': now, 'expiresAt': now + ttl, 'ttlSeconds': ttl,
                       'hop': 0, 'replyTo': None, 'requiresReply': True,
                       'worldDelivery': {'eventId': message_id, 'state': 'pending', 'receipt': None}}
            db.execute('''INSERT INTO messages(message_id,sender,recipient,binding_revision,payload,status,created,expires)
                          VALUES (?,?,?,?,?,'pending',?,?)''',
                       (message_id, sender_agent_id, recipient['agentId'], binding['revision'], _json(payload), now, now + ttl))
            self._insert_world(db, payload, message_id, 'request', now + min(ttl, 300))
            return self._public(self._row(db, message_id))

    def get_status(self, actor, message_id):
        with self._transaction() as db:
            binding = self._binding(db)
            self._member(binding, actor)
            row = self._row(db, message_id)
            self._visible(binding, row, actor)
            return self._public(row, actor)

    def overview(self, actor, *, limit=50):
        _require(type(limit) is int and 1 <= limit <= 200, 'invalid_party_limit')
        with self._transaction() as db:
            binding = self._binding(db)
            member = self._member(binding, actor)
            counts = {state: 0 for state in ('pending', *ACTIVE, *TERMINAL)}
            visible = []
            for row in db.execute('SELECT * FROM messages ORDER BY created DESC,rowid DESC'):
                payload = json.loads(row['payload'])
                if member not in (payload['sender'], payload['recipient']):
                    continue
                counts[row['status']] += 1
                if len(visible) < limit:
                    visible.append(self._public(row, actor))
            return {'partyId': binding['partyId'], 'bindingRevision': binding['revision'],
                    'enabled': binding['enabled'], 'members': deepcopy(binding['members']),
                    'counts': counts, 'messages': visible, 'budget': self._budget(db, binding)}

    def active_for_recipient(self, recipient_agent_id):
        """Trusted dispatcher check; an old binding's unknown task still blocks."""
        with self._transaction() as db:
            binding = self._binding(db)
            self._member(binding, recipient_agent_id)
            row = self._active(db, recipient_agent_id)
            return self._public(row) if row else None

    def next_pending(self, recipient_agent_id, *, busy=False):
        _require(type(busy) is bool, 'invalid_party_busy')
        with self._transaction() as db:
            binding = self._binding(db)
            self._member(binding, recipient_agent_id)
            if busy or not binding['enabled'] or self._active(db, recipient_agent_id):
                return None
            row = db.execute("SELECT m.* FROM messages m JOIN world_speech w ON w.event_id=m.message_id "
                             "WHERE m.recipient=? AND m.status='pending' AND m.next_attempt<=? AND w.state='heard' "
                             "ORDER BY m.created,m.rowid LIMIT 1", (recipient_agent_id, self._now())).fetchone()
            return self._public(row) if row else None

    def _budget(self, db, binding):
        now = self._now()
        rows = db.execute("SELECT created,usage FROM reservations WHERE state<>'deferred' AND created>?",
                          (now - 86400,)).fetchall()
        limits = binding['limits']
        recent = [row['created'] for row in rows]
        cooldown_until = max(recent) + limits['cooldownSeconds'] if recent else 0
        cap_until = (sorted(recent)[len(recent) - limits['dailyDispatchCap']] + 86400
                     if len(recent) >= limits['dailyDispatchCap'] else 0)
        recorded = [json.loads(row['usage']) for row in rows if row['usage'] is not None]
        known_usage = {key: sum(usage.get(key, 0) for usage in recorded)
                       for key in {key for usage in recorded for key in usage}}
        return {'reservedDispatches24h': len(recent), 'dailyDispatchCap': limits['dailyDispatchCap'],
                'remaining': max(0, limits['dailyDispatchCap'] - len(recent)),
                'blocked': len(recent) >= limits['dailyDispatchCap'] or now < cooldown_until,
                'nextDispatchAt': max(cooldown_until, cap_until),
                'usageRecordedDispatches24h': len(recorded), 'knownUsage24h': known_usage,
                'countsUnknownAsReserved': True, 'roleBudgetSeparate': True}

    def budget_status(self, actor):
        with self._transaction() as db:
            binding = self._binding(db)
            self._member(binding, actor)
            return self._budget(db, binding)

    def reserve_dispatch(self, message_id, recipient_agent_id, *, budget_receipt=None, busy=False):
        """Only claimed=True authorizes POST; existing reservations never do."""
        _require(type(busy) is bool, 'invalid_party_busy')
        with self._transaction() as db:
            binding = self._binding(db)
            self._member(binding, recipient_agent_id)
            row = self._row(db, message_id)
            self._visible(binding, row, recipient_agent_id)
            _require(row['recipient'] == recipient_agent_id, 'party_wrong_recipient')
            reason = None
            if row['status'] != 'pending': reason = 'not_pending'
            elif not self._heard(db, message_id): reason = 'not_heard'
            elif not binding['enabled']: reason = 'disabled'
            elif busy or self._active(db, recipient_agent_id): reason = 'busy'
            elif row['next_attempt'] > self._now(): reason = 'deferred'
            elif self._budget(db, binding)['blocked']: reason = 'budget_blocked'
            if reason:
                return self._public(row, recipient_agent_id) | {'claimed': False, 'dispatchStatus': reason}
            reservation_id = str(uuid.uuid4())
            task_key = 'party-' + message_id
            receipt = task_key if budget_receipt is None else _identifier(budget_receipt, 'budget_receipt', 180)
            now = self._now()
            db.execute('''INSERT INTO reservations(reservation_id,message_id,recipient,created,state,task_key,budget_receipt)
                          VALUES (?,?,?,?,'unknown',?,?)''',
                       (reservation_id, message_id, recipient_agent_id, now, task_key, receipt))
            payload = json.loads(row['payload'])
            payload['budgetReceipt'] = receipt
            db.execute("UPDATE messages SET status='unknown',reservation_id=?,payload=?,detail='submission_not_confirmed' WHERE message_id=?",
                       (reservation_id, _json(payload), message_id))
            return self._public(self._row(db, message_id)) | {'claimed': True, 'dispatchStatus': 'reserved',
                       'reservationId': reservation_id, 'taskKey': task_key, 'budgetReceipt': receipt}

    def _reservation(self, db, reservation_id):
        _uuid(reservation_id)
        reservation = db.execute('SELECT * FROM reservations WHERE reservation_id=?', (reservation_id,)).fetchone()
        _require(reservation is not None, 'party_reservation_not_found')
        row = self._row(db, reservation['message_id'])
        _require(row['reservation_id'] == reservation_id, 'party_reservation_superseded')
        return reservation, row

    def mark_deferred(self, reservation_id, reason, *, retry_after_seconds=60):
        """Use only with an explicit no-submission result from the dispatcher.

        Deferred attempts stay in the audit table but no longer reserve party
        dispatch budget. Submitted/unknown paid work and external role budgets
        are never refunded by this method. An uncertain error is not evidence.
        """
        _require(isinstance(reason, str) and reason in DEFER_REASONS, 'party_deferral_not_proven')
        _require(type(retry_after_seconds) is int and 1 <= retry_after_seconds <= 86400,
                 'invalid_party_retry_delay')
        with self._transaction() as db:
            self._binding(db)
            reservation, row = self._reservation(db, reservation_id)
            if reservation['state'] == 'deferred':
                return self._public(row)
            _require(reservation['state'] == 'unknown' and row['status'] == 'unknown'
                     and not row['task_id'] and not reservation['task_id'], 'party_cannot_defer_submitted')
            db.execute("UPDATE reservations SET state='deferred',reason=? WHERE reservation_id=?", (reason, reservation_id))
            db.execute("UPDATE messages SET status='pending',detail=?,next_attempt=? WHERE message_id=?",
                       (reason, self._now() + retry_after_seconds, row['message_id']))
            self._binding(db)  # An expired/changed binding must not regain a pending lane.
            return self._public(self._row(db, row['message_id']))

    def mark_submitted(self, reservation_id, task_id):
        """Attach a verified native task ID, also usable for manual recovery."""
        _require(isinstance(task_id, str) and re.fullmatch(r'task-[0-9a-f]{12}', task_id), 'invalid_party_task_id')
        with self._transaction() as db:
            self._binding(db)
            reservation, row = self._reservation(db, reservation_id)
            if row['task_id']:
                _require(row['task_id'] == task_id, 'party_task_collision')
                return self._public(row)  # Never downgrade a terminal receipt.
            _require(row['status'] == 'unknown' and reservation['state'] == 'unknown', 'party_not_reserved')
            _require(db.execute('SELECT 1 FROM reservations WHERE task_id=?', (task_id,)).fetchone() is None,
                     'party_task_collision')
            db.execute("UPDATE reservations SET state='submitted',task_id=? WHERE reservation_id=?", (task_id, reservation_id))
            db.execute("UPDATE messages SET status='submitted',task_id=?,detail=NULL WHERE message_id=?", (task_id, row['message_id']))
            return self._public(self._row(db, row['message_id']))

    def mark_answered(self, reservation_id, task_id, text, *, usage=None):
        """Trusted adapter calls only after a matching native completed result."""
        return self._finish(reservation_id, task_id, text=text, usage=usage)

    def mark_failed(self, reservation_id, task_id, reason, *, usage=None):
        """Only a verified terminal native failure releases the recipient lane."""
        return self._finish(reservation_id, task_id, reason=_identifier(reason, 'failure_reason', 80), usage=usage)

    def _finish(self, reservation_id, task_id, *, text=None, reason=None, usage=None):
        if usage is not None:
            _require(isinstance(usage, dict) and set(usage) <= {'modelCalls', 'inputTokens', 'outputTokens', 'totalTokens'}
                     and all(type(v) is int and 0 <= v <= 10**12 for v in usage.values()), 'invalid_party_usage')
        with self._transaction() as db:
            binding = self._binding(db)
            reservation, row = self._reservation(db, reservation_id)
            _require(isinstance(task_id, str) and row['task_id'] == task_id and reservation['task_id'] == task_id,
                     'party_task_not_owned')
            state = 'answered' if text is not None else 'failed'
            if text is not None:
                speech_text(text)
            old_reply = json.loads(row['reply']) if row['reply'] else None
            if old_reply and text is not None:
                _require(old_reply['text'] == text, 'party_terminal_collision')
                return self._public(row)
            if row['status'] in TERMINAL:
                _require(row['status'] == state and (old_reply['text'] == text if old_reply else row['detail'] == reason),
                         'party_terminal_collision')
                return self._public(row)
            _require(row['status'] == 'submitted', 'party_task_not_submitted')
            original = json.loads(row['payload'])
            reply = None
            if text is not None:
                reply = {'messageId': str(uuid.uuid5(uuid.UUID(row['message_id']), 'reply')),
                         'conversationId': original['conversationId'], 'replyTo': row['message_id'], 'hop': 1,
                         'sender': original['recipient'], 'recipient': original['sender'], 'text': text,
                         'channel': original.get('channel', 'nearby'),
                         'createdAt': self._now(), 'requiresReply': False, 'deliveryState': 'recorded',
                         'bindingCurrent': original['bindingRevision'] == binding['revision'], 'usage': usage}
                reply['worldDelivery'] = {'eventId': reply['messageId'], 'state': 'pending', 'receipt': None}
                self._insert_world(db, reply, row['message_id'], 'reply', self._now() + 300,
                                   revision=original['bindingRevision'])
                state = 'submitted'  # Native output exists; the recipient has not heard it yet.
                reason = 'reply_waiting_for_world'
            db.execute('UPDATE reservations SET state=?,reason=?,usage=? WHERE reservation_id=?',
                       (state, reason, _json(usage) if usage is not None else None, reservation_id))
            db.execute('UPDATE messages SET status=?,reply=?,detail=? WHERE message_id=?',
                       (state, _json(reply) if reply else None, reason, row['message_id']))
            return self._public(self._row(db, row['message_id']))

    @staticmethod
    def _heard(db, event_id):
        row = db.execute('SELECT state FROM world_speech WHERE event_id=?', (event_id,)).fetchone()
        return row is not None and row['state'] == 'heard'

    def _insert_world(self, db, message, message_id, kind, expires, revision=None):
        event = speech_event(message['messageId'], message['sender']['bodyUuid'],
                             message['recipient']['bodyUuid'], message['text'], message.get('channel', 'nearby'))
        event.update(bindingRevision=revision if revision is not None else message['bindingRevision'],
                     createdAt=self._now(), expiresAt=expires)
        db.execute("INSERT INTO world_speech(event_id,message_id,kind,payload,state) VALUES (?,?,?,?,'pending')",
                   (event['eventId'], message_id, kind, _json(event)))

    @staticmethod
    def _world_row(db, event_id):
        _uuid(event_id)
        row = db.execute('SELECT * FROM world_speech WHERE event_id=?', (event_id,)).fetchone()
        _require(row is not None, 'party_world_event_not_found')
        return row

    @staticmethod
    def _world_public(row):
        return json.loads(row['payload']) | {'state': row['state'],
                'receipt': json.loads(row['receipt']) if row['receipt'] else None}

    def world_event(self, event_id):
        """Trusted bridge only: contains unsaid text, never expose as a model tool."""
        with self._transaction() as db:
            self._binding(db)
            return self._world_public(self._world_row(db, event_id))

    def claim_world(self, event_id):
        """The single write grant is committed UNKNOWN before RCON is called."""
        with self._transaction() as db:
            binding = self._binding(db)
            row = self._world_row(db, event_id)
            event = self._world_public(row)
            if row['state'] != 'pending':
                return event | {'claimed': False}
            if (not binding['enabled'] or event['bindingRevision'] != binding['revision']
                    or event['expiresAt'] <= self._now()):
                self._set_world(db, row, 'expired', None)
                return self._world_public(self._world_row(db, event_id)) | {'claimed': False}
            self._set_world(db, row, 'unknown', None)
            return self._world_public(self._world_row(db, event_id)) | {'claimed': True}

    def record_world_receipt(self, event_id, receipt):
        """Only a verified world receipt can disclose text or schedule a model."""
        with self._transaction() as db:
            self._binding(db)
            row = self._world_row(db, event_id)
            event = json.loads(row['payload'])
            receipt = validate_receipt(receipt, event)
            if row['state'] in ('heard', 'rejected', 'expired'):
                _require(row['state'] == receipt['phase'], 'party_world_terminal_collision')
                return self._world_public(row)
            _require(row['state'] == 'unknown', 'party_world_not_claimed')
            state = receipt['phase'] if receipt['phase'] in ('heard', 'rejected') else 'unknown'
            self._set_world(db, row, state, receipt)
            return self._world_public(self._world_row(db, event_id))

    def _set_world(self, db, event, state, receipt):
        db.execute('UPDATE world_speech SET state=?,receipt=? WHERE event_id=?',
                   (state, _json(receipt) if receipt else None, event['event_id']))
        message = self._row(db, event['message_id'])
        column = 'payload' if event['kind'] == 'request' else 'reply'
        content = json.loads(message[column])
        content['worldDelivery'] = {'eventId': event['event_id'], 'state': state, 'receipt': receipt}
        db.execute('UPDATE messages SET ' + column + '=? WHERE message_id=?',
                   (_json(content), message['message_id']))
        if event['kind'] == 'reply' and state in ('heard', 'rejected', 'expired'):
            final = 'answered' if state == 'heard' else 'failed'
            reason = None if state == 'heard' else 'reply_world_' + state
            db.execute('UPDATE messages SET status=?,detail=? WHERE message_id=?', (final, reason, message['message_id']))
            db.execute('UPDATE reservations SET state=?,reason=? WHERE reservation_id=?',
                       (final, reason, message['reservation_id']))
        elif event['kind'] == 'request' and state in ('rejected', 'expired') and message['status'] == 'pending':
            db.execute("UPDATE messages SET status=?,detail=? WHERE message_id=?",
                       ('expired' if state == 'expired' else 'failed', 'world_' + state, message['message_id']))

    def unresolved_world(self, *, kind='request', limit=32):
        """Trusted recovery: only UNKNOWN may query status; never resend pending intent."""
        _require(kind in ('request', 'reply') and type(limit) is int and 1 <= limit <= 100,
                 'invalid_party_world_query')
        with self._transaction() as db:
            self._binding(db)
            return [self._world_public(row) for row in db.execute(
                "SELECT * FROM world_speech WHERE kind=? AND state='unknown' ORDER BY rowid LIMIT ?", (kind, limit))]
