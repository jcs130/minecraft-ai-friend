"""Correlate native background tasks without ever reissuing their Lua program."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from xml.etree import ElementTree as ET


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


def finished_tasks(text: str):
    # Parse only direct server event elements. Chat text containing XML is not a receipt.
    match = re.search(r'<events>.*?</events>', text, re.S)
    if not match:
        return []
    try:
        root = ET.fromstring(match[0])
    except ET.ParseError:
        return []
    return [(node.get('id'), node.get('status'), ''.join(node.itertext())) for node in root
            if node.tag == 'event' and node.get('kind') == 'task_finished'
            and re.fullmatch(r't\d+', node.get('id', ''))
            and node.get('status') in {'done', 'failed', 'timeout', 'interrupted', 'stopped', 'cancelled'}]


class NativeTasks:
    def __init__(self, path: Path, companion: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.body = companion
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, body TEXT, fingerprint TEXT, epoch TEXT, task TEXT, status TEXT, text TEXT)')
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
            self.db.execute('UPDATE calls SET task=?,status=?,text=? WHERE id=? AND body=?', (task, status, text, request, self.body))

    def finish(self, epoch: str, task: str, status: str, text: str):
        rows = self.db.execute("SELECT id,fingerprint FROM calls WHERE body=? AND epoch=? AND task=? AND status='accepted'",
                               (self.body, epoch, task)).fetchall()
        for request, _ in rows:
            self.save(request, 'completed' if status == 'done' else 'failed', text, task)
        return [fingerprint for _, fingerprint in rows]

    def close(self):
        self.db.close()
