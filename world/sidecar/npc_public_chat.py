"""Consume a selected NPC through the existing inbox, once; no model or new worker."""
import hashlib
from contextlib import contextmanager
import json
import math
from pathlib import Path
import re
import sqlite3
import time

VERSION = 1


def profile_revision(v):
    b = v.get('entityBinding') or {}
    fields = [v['key'], v['tag'], v['display'], v['calls'], v.get('profession') or '',
              b.get('uuid') or '', b.get('dimension') or 'minecraft:overworld']
    return hashlib.sha256(json.dumps(fields, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def central_public_line(line):
    # Vanilla player chat is owned by world's single attention decision.
    # Preserve the old server-say/AI path, private trading and proximity speech.
    return bool(re.search(r'<[A-Za-z0-9_\u4e00-\u9fff]{1,16}> ', line))


class PublicNpcChat:
    def __init__(self, path, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.last_poll = 0
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS dispatches (event_id TEXT PRIMARY KEY, npc_key TEXT NOT NULL, '
                       'at REAL NOT NULL, state TEXT NOT NULL, reason TEXT)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def claim(self, rec, reason=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM dispatches WHERE event_id=?', (rec['eventId'],)).fetchone():
                return False
            if reason is None and db.execute("SELECT 1 FROM dispatches WHERE npc_key=? AND at>? AND state IN ('unknown','submitted')",
                                            (rec['npcKey'], self.clock()-3)).fetchone():
                reason = 'cooldown'
            db.execute('INSERT INTO dispatches VALUES (?,?,?,?,?)', (rec['eventId'], rec['npcKey'], self.clock(),
                       'rejected' if reason else 'unknown', reason))
            return reason is None

    def consume(self, npc, rec):
        self.last_poll = self.clock()
        if (not isinstance(rec, dict) or rec.get('schema') != 1 or rec.get('via') != 'public-routed'
                or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', str(rec.get('eventId', '')))
                or not re.fullmatch(r'[a-z0-9_-]{1,64}', str(rec.get('npcKey', '')))
                or not re.fullmatch(r'[A-Za-z0-9_\u4e00-\u9fff]{1,16}', str(rec.get('speaker', '')))
                or not isinstance(rec.get('text'), str) or not 1 <= len(rec['text']) <= 512
                or any(ord(c) < 32 for c in rec['text'])):
            return 'invalid'
        stamp = rec.get('createdAt')
        reason = None
        if type(stamp) not in (int, float) or not math.isfinite(stamp) or not 0 <= self.clock()*1000-stamp <= 15000:
            reason = 'expired'
        v = next((v for v in npc.PROFILES if v.get('key') == rec['npcKey']), None)
        if v is None or v.get('alive') is False or profile_revision(v) != rec.get('profileRevision'):
            reason = 'profile_changed'
        if not self.claim(rec, reason):
            return 'rejected_or_duplicate'
        try:
            # A selected identity is not proof that its body is loaded or can
            # hear the player. This native query performs no world mutation.
            position = npc.alive_pos(v)
            nearby = npc.R.cmd('execute at %s if entity @a[name="%s",distance=..%s]' %
                               (npc.sel(v), rec['speaker'], min(48, npc.HEAR_RADIUS))) if position else ''
            if not nearby.strip().startswith('Test passed'):
                with self.connect() as db:
                    db.execute("UPDATE dispatches SET state='rejected',reason='not_nearby_or_loaded' WHERE event_id=?", (rec['eventId'],))
                return 'not_nearby_or_loaded'
            selected, replies = npc.route(rec['speaker'], rec['text'], via='public', target_key=v['key'])
            if selected is not v or not replies:
                raise ValueError('selected_npc_not_returned')
            for reply in replies:
                npc.speak(v, reply, to=rec['speaker'])
                npc.feed_append({'kind': 'say', 'npc': v['display'], 'npcKey': v['key'], 'npcPos': list(position),
                                 'color': v.get('color', 'white'), 'to': rec['speaker'], 'text': reply[:300],
                                 'via': 'public-routed', 'eventId': rec['eventId']})
            with self.connect() as db:
                db.execute("UPDATE dispatches SET state='submitted' WHERE event_id=?", (rec['eventId'],))
            return 'submitted'  # tellraw issued; not a client hearing acknowledgement.
        except Exception:
            # Partial reply or uncertain RCON result remains unknown, never re-sent.
            return 'unknown'

    def status(self):
        with self.connect() as db:
            counts = dict(db.execute('SELECT state,COUNT(*) FROM dispatches GROUP BY state'))
            latest = db.execute('SELECT state,reason,at FROM dispatches ORDER BY at DESC LIMIT 1').fetchone()
        return {'version': VERSION, 'owner': 'world-public-chat', 'lastPoll': self.last_poll,
                'counts': counts, 'latest': list(latest) if latest else None}
