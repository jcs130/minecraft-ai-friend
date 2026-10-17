"""Optional host-neutral speech outbox; never calls a model or the game.

The planner may provide a short line in its existing response. A host explicitly
subscribes to the current body/actor, then claims each fresh line at most once.
Unknown deliveries are not retried. This queue never owns native work.
"""

import hashlib
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime

from .host_context import HostContextPort
from .host_recent import binding
from .mailbox import Mailbox, observation

GUIDANCE = """
A host voice output is available. In this SAME decision, you may put exactly
{"spoken_text":"one short natural utterance"} in assistant content, alongside
the normal action tool call. Use the supplied persona and recent conversation:
react, joke, wonder or explain a meaningful intention in your own voice. Speak
in the conversation's language. Do not read inventory lists, diagnostics, JSON,
tool workflow, tone instructions or silence placeholders aloud. An intention
is not success; reflect outcomes only from observed receipts. Omit content when
there is nothing worth saying. Speech neither replaces nor delays useful work.
"""


def spoken_line(content):
    if not isinstance(content, str) or len(content.encode("utf-8")) > 3000:
        return None
    try:
        value = json.loads(content)
    except ValueError:
        return None
    if not isinstance(value, dict) or set(value) != {"spoken_text"}:
        return None
    line = value["spoken_text"]
    if not isinstance(line, str) or not 1 <= len(line.strip()) <= 600 or any(ord(c) < 32 for c in line):
        return None
    return line.strip()


def binding_key(expected):
    # Controller and host run in different interpreters/hash seeds. Never rely
    # on dict/set insertion order when comparing a durable binding.
    return json.dumps(binding(expected), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class NarrationPort:
    def __init__(self, directory, *, now=time.time):
        self.directory, self.now = directory, now
        self.path = directory / "narration.sqlite3"
        self.mailbox = Mailbox(directory)

    @contextmanager
    def connection(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=0.1)
        try:
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE IF NOT EXISTS consumer (id INTEGER PRIMARY KEY, binding TEXT, expires REAL, interval REAL)")
            db.execute("CREATE TABLE IF NOT EXISTS lines (id TEXT PRIMARY KEY, binding TEXT, line TEXT, digest TEXT, created REAL, state TEXT)")
            with db:
                db.execute("BEGIN IMMEDIATE")
                yield db
        finally:
            db.close()

    def fresh(self, expected):
        try:
            expected = binding(expected)
            snapshot = observation(self.directory)
            age = self.now() - datetime.fromisoformat(snapshot["updated_at"]).timestamp()
            if (not 0 <= age <= 30 or snapshot.get("phase") != "running" or snapshot.get("game_connected") is not True
                    or self.mailbox.intent_revision() != expected["intent_revision"]):
                return False
            for key, name in (("settings_identity", "identity"), ("runtime_session", "session"), ("native_run", "run"),
                              ("game_identity", "scope"), ("body_death_episode_id", "death_episode_id")):
                if snapshot.get(key) != expected[name]:
                    return False
            state_path = self.directory / "host-state.json"
            if state_path.exists() and json.loads(state_path.read_text(encoding="utf-8")).get("stopped"):
                return False
            profile = HostContextPort(self.directory, now=self.now).read(expected["intent_revision"])
            return bool(profile and profile["stable"]["agent_name"] == expected["actor"])
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def stopping(self):
        if not self.mailbox.path.exists():
            return False
        with self.mailbox.connection() as db:
            return db.execute("SELECT 1 FROM commands WHERE kind='stop' AND state IN ('queued','dispatching')").fetchone() is not None

    def subscribe(self, expected, *, interval=30):
        expected = binding(expected)
        if type(interval) not in {int, float} or not 10 <= interval <= 900 or not self.fresh(expected):
            return False
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO consumer VALUES (1,?,?,?)", (binding_key(expected), self.now() + 15, interval))
        return True

    def consumer(self, expected):
        if not self.path.exists() or not self.fresh(expected):
            return None
        with self.connection() as db:
            row = db.execute("SELECT * FROM consumer WHERE id=1").fetchone()
            if row and self.now() <= row["expires"] <= self.now() + 15 and row["binding"] == binding_key(expected):
                return dict(row)
        return None

    def offer(self, content, expected):
        line = spoken_line(content)
        consumer = self.consumer(expected) if line else None
        if consumer is None:
            return {"offered": False}
        signature = hashlib.sha256(line.encode("utf-8")).hexdigest()
        with self.connection() as db:
            current = db.execute("SELECT * FROM consumer WHERE id=1").fetchone()
            if not current or dict(current) != consumer or not self.fresh(expected):
                return {"offered": False}
            recent = db.execute("SELECT * FROM lines WHERE binding=? ORDER BY created DESC LIMIT 1", (consumer["binding"],)).fetchone()
            if recent and (self.now() - recent["created"] < consumer["interval"]
                           or recent["digest"] == signature and self.now() - recent["created"] < 300):
                return {"offered": False, "reason": "paced_or_repeated"}
            identifier = str(uuid.uuid4())
            db.execute("INSERT INTO lines VALUES (?,?,?,?,?,'ready')", (identifier, consumer["binding"], line, signature, self.now()))
            db.execute("DELETE FROM lines WHERE rowid NOT IN (SELECT rowid FROM lines ORDER BY rowid DESC LIMIT 32)")
        return {"offered": True, "id": identifier, "playback_verified": False}

    def take(self, expected):
        consumer = self.consumer(expected)
        if consumer is None:
            return None
        with self.connection() as db:
            row = db.execute("SELECT * FROM lines WHERE state='ready' AND binding=? AND created>=? ORDER BY created DESC LIMIT 1",
                             (consumer["binding"], self.now() - 30)).fetchone()
            if row is None or not self.fresh(expected):
                return None
            # Claim before transport. Process death after this point is unknown,
            # never permission for another host instance to replay the line.
            db.execute("UPDATE lines SET state='reserved_unknown' WHERE id=?", (row["id"],))
            db.execute("UPDATE lines SET state='superseded' WHERE state='ready'")
            return {"opportunity_id": row["id"], "decision_id": row["id"], "session": expected["session"],
                    "runtime_binding": expected, "expires_at": row["created"] + 30, "line": row["line"], "source": "planner"}

    def speech_current(self, receipt):
        expected = receipt["runtime_binding"]
        return not self.stopping() and self.now() <= receipt["expires_at"] and self.consumer(expected) is not None

    def delivered(self, receipt, state):
        if state not in {"accepted", "rejected", "unknown", "unsupported", "unavailable"}:
            raise ValueError("narration_delivery_state_invalid")
        with self.connection() as db:
            db.execute("UPDATE lines SET state=? WHERE id=? AND binding=? AND state='reserved_unknown'",
                       (state, receipt["opportunity_id"], binding_key(receipt["runtime_binding"])))
