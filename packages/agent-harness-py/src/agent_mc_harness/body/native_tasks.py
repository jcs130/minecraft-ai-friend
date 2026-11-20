"""Correlate native background tasks without ever reissuing their Lua program."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from xml.etree import ElementTree as ET

HOSTED_STOP = 'hosted:stop'


def background_task(text: str) -> str | None:
    stopped = re.match(r'The script stopped at line \d+ \((numen(?:_hosted)?\.[\w.]+)\).*?; (t\d+) keeps running\.', text)
    if not stopped:
        return None
    node = re.search(r'<current_task\s+[^>]*>', text)
    if not node:
        return stopped[2]  # It may have finished between the interruption and runtime snapshot.
    try:
        attrs = ET.fromstring(node[0][:-1] + '/>').attrib
    except ET.ParseError:
        return None
    return stopped[2] if attrs.get('id') == stopped[2] and attrs.get('tool') == stopped[1] and attrs.get('state') == 'running' else None


def finished_task_details(text: str):
    # Parse only direct server event elements. Chat text containing XML is not a receipt.
    match = re.search(r'<events>.*?</events>', text, re.S)
    if not match:
        return []
    try:
        root = ET.fromstring(match[0])
    except ET.ParseError:
        return []
    return [(node.get('id'), node.get('task'), node.get('status'), ''.join(node.itertext())) for node in root
            if node.tag == 'event' and node.get('kind') == 'task_finished'
            and re.fullmatch(r't\d+', node.get('id', ''))
            and node.get('status') in {'done', 'failed', 'timeout', 'interrupted', 'stopped', 'cancelled'}]


def finished_tasks(text: str):
    return [(task, status, detail) for task, _, status, detail in finished_task_details(text)]


class NativeTasks:
    def __init__(self, path: Path, companion: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.body = companion
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, body TEXT, fingerprint TEXT, epoch TEXT, task TEXT, status TEXT, text TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS early_task_finishes (request TEXT, event TEXT, task TEXT, tool TEXT, status TEXT, detail TEXT, PRIMARY KEY(request,event,task,tool))')
        self.db.execute('CREATE TABLE IF NOT EXISTS hosted_stops (id TEXT PRIMARY KEY, boot TEXT NOT NULL, pause_epoch INTEGER NOT NULL, pause_confirmed INTEGER NOT NULL DEFAULT 0)')
        self.db.commit()

    def get(self, request: str, epoch: str | None):
        row = self.db.execute('SELECT body,fingerprint,epoch,task,status,text FROM calls WHERE id=?', (request,)).fetchone()
        if not row:
            return None
        if row[0] != self.body:
            raise ValueError('native_receipt_body_mismatch')
        _, fingerprint, connection, task, status, text = row
        if status == 'accepted' and connection != epoch:
            status, text = 'unknown', 'Native connection changed; original task outcome requires reconciliation. Do not replay.'
        return dict(status=status, text=text, execution_id=task, data={'fingerprint': fingerprint, 'connection': connection})

    def begin(self, request: str, fingerprint: str, epoch: str | None):
        with self.db:
            self.db.execute('INSERT INTO calls VALUES (?,?,?,?,NULL,?,?)',
                            (request, self.body, fingerprint, epoch, 'unknown', 'Dispatch recorded; outcome not yet received.'))

    def save(self, request: str, status: str, text: str, task: str | None):
        with self.db:
            updated = self.db.execute("UPDATE calls SET task=?,status=?,text=? WHERE id=? AND body=? AND status IN ('unknown','accepted')",
                                      (task, status, text, request, self.body))
            if updated.rowcount and status not in ('unknown', 'accepted'):
                self.db.execute('DELETE FROM early_task_finishes WHERE request=?', (request,))

    def remember_early_finish(self, request, epoch, event, task, tool, status, detail):
        # A task number can recur after a server restart. Bind the observation
        # only to calls *already reserved* for this body in this task window.
        with self.db:
            stored = self.db.execute("INSERT OR IGNORE INTO early_task_finishes SELECT id,?,?,?,?,? FROM calls "
                                     "WHERE body=? AND id=? AND epoch=? AND status='unknown' AND task IS NULL "
                                     "AND fingerprint!=? AND NOT EXISTS "
                                     "(SELECT 1 FROM calls WHERE body=? AND epoch=? AND task=?) RETURNING request",
                                     (event, task, tool, status, detail, self.body, request, epoch, HOSTED_STOP,
                                      self.body, epoch, task))
            return stored.fetchone() is not None

    def bind_background(self, request, epoch, task, launch):
        saved = self.get(request, epoch)
        if not saved or saved['status'] not in ('unknown', 'accepted'):
            return saved
        if saved['execution_id'] not in (None, task):
            return saved
        name = re.match(r'The script stopped at line \d+ \((numen(?:_hosted)?\.[\w.]+)\)', launch)
        if not name:
            return saved
        finishes = self.db.execute('SELECT status,detail FROM early_task_finishes WHERE request=? AND task=? AND tool=?',
                                   (request, task, name[1])).fetchall()
        if len(finishes) == 1:
            self.save(request, *finishes[0], task)
        elif not finishes and saved['data']['connection'] == epoch and saved['execution_id'] is None:
            self.save(request, 'accepted', launch, task)
        return self.get(request, epoch)

    def begin_stop(self, request: str, boot: str, pause_epoch: int):
        # Use the original fence, not the native task connection. Draining old
        # walks during this pause must not wait for the stop that is draining them.
        with self.db:
            self.db.execute('INSERT INTO calls VALUES (?,?,?,?,NULL,?,?)',
                            (request, self.body, HOSTED_STOP, f'{boot}:{pause_epoch}', 'unknown',
                             'Stop recorded; the original pause has not yet been confirmed.'))
            self.db.execute('INSERT INTO hosted_stops(id,boot,pause_epoch) VALUES (?,?,?)',
                            (request, boot, pause_epoch))

    def stop_fence(self, request: str):
        return self.db.execute('SELECT s.boot,s.pause_epoch,s.pause_confirmed FROM hosted_stops s '
                               'JOIN calls c ON c.id=s.id WHERE c.body=? AND s.id=?',
                               (self.body, request)).fetchone()

    def confirm_stop(self, request: str):
        with self.db:
            self.db.execute('UPDATE hosted_stops SET pause_confirmed=1 WHERE id=? AND id IN '
                            '(SELECT id FROM calls WHERE body=?)', (request, self.body))

    def pending(self, epoch: str):
        return [row[0] for row in self.db.execute(
            "SELECT id FROM calls WHERE body=? AND epoch=? AND status IN ('accepted','unknown')", (self.body, epoch))]

    def unsettled(self):
        return self.db.execute("SELECT id,epoch FROM calls WHERE body=? AND status IN ('accepted','unknown')",
                               (self.body,)).fetchall()

    def finish(self, epoch: str, task: str, status: str, text: str, *, tool=None, eligible=None):
        rows = self.db.execute("SELECT id,fingerprint,text FROM calls WHERE body=? AND epoch=? AND task=? AND status='accepted'",
                               (self.body, epoch, task)).fetchall()
        if len(rows) != 1:
            return []
        request, fingerprint, launch = rows[0]
        if eligible is not None and request not in eligible:
            return []
        if tool is not None and not re.match(r'The script stopped at line \d+ \(' + re.escape(tool) + r'\)', launch):
            return []
        self.save(request, 'completed' if status == 'done' else 'failed', text, task)
        return [fingerprint]

    def close(self):
        self.db.close()
