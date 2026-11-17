"""Self-iteration store: versioned lessons, methods and routing policy (no model weights change).

A version moves  candidate -> trial -> adopted | rolled_back  (or is retired when superseded). Only
environment-verified outcomes count as evidence (``record(..., verified=True|False)``); unverified or unsettled
outcomes (``None``) are ignored - an unknown effect is never evidence and is never replayed. A trial is adopted when
it has ``min_trials`` verified outcomes and its success rate is not below the version it replaces; otherwise it is
rolled back and the previous adopted version becomes active again. Everything is kept (old versions, negatives).

Storage is one SQLite file (stdlib), per harness; keys are scoped by the caller (group_id prefix).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

Kind = Literal["lesson", "method", "routing"]
Status = Literal["candidate", "trial", "adopted", "rolled_back", "retired"]


class StrategyVersion(BaseModel):
    key: str
    version: int
    kind: Kind
    status: Status
    content: dict[str, Any]
    parent: int | None = None
    successes: int = 0
    failures: int = 0
    provenance: dict[str, Any] = Field(default_factory=dict)
    created_at: float = Field(default_factory=time.time)
    decided_at: float | None = None
    reason: str | None = None

    @property
    def rate(self) -> float | None:
        n = self.successes + self.failures
        return None if n == 0 else self.successes / n


class StrategyStore:
    def __init__(self, path: str | Path = ":memory:", *, min_trials: int = 3) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS versions (key TEXT, version INTEGER, row TEXT, PRIMARY KEY (key, version))")
        self.min_trials = min_trials
        self._lock = threading.Lock()

    # ---- read --------------------------------------------------------------------------------------
    def versions(self, key: str) -> list[StrategyVersion]:
        with self._lock:
            rows = self.db.execute("SELECT row FROM versions WHERE key = ? ORDER BY version", (key,)).fetchall()
        return [StrategyVersion.model_validate_json(r[0]) for r in rows]

    def get(self, key: str, version: int) -> StrategyVersion | None:
        return next((v for v in self.versions(key) if v.version == version), None)

    def active(self, key: str) -> StrategyVersion | None:
        """The version in use: a running trial, else the adopted one."""
        rows = self.versions(key)
        return next((v for v in reversed(rows) if v.status == "trial"), None) or next((v for v in reversed(rows) if v.status == "adopted"), None)

    def keys(self, prefix: str = "", kind: Kind | None = None) -> list[str]:
        with self._lock:
            rows = self.db.execute("SELECT DISTINCT key FROM versions WHERE key LIKE ? ORDER BY key", (prefix.replace("%", "") + "%",)).fetchall()
        keys = [r[0] for r in rows]
        return [k for k in keys if kind is None or (self.versions(k)[-1].kind == kind)]

    def active_all(self, prefix: str = "", kind: Kind | None = None) -> list[StrategyVersion]:
        return [v for k in self.keys(prefix, kind) if (v := self.active(k)) is not None]

    # ---- write -------------------------------------------------------------------------------------
    def _save(self, v: StrategyVersion) -> StrategyVersion:
        with self._lock:
            self.db.execute("INSERT OR REPLACE INTO versions VALUES (?,?,?)", (v.key, v.version, v.model_dump_json()))
            self.db.commit()
        return v

    def propose(self, key: str, kind: Kind, content: dict[str, Any], *, provenance: dict[str, Any] | None = None,
                start_trial: bool = True) -> StrategyVersion:
        """New version. With ``start_trial`` it becomes the active trial unless another trial is running (then it
        waits as a candidate). Identical content to the active version is not duplicated."""
        rows = self.versions(key)
        current = self.active(key)
        if current is not None and current.content == content:
            return current
        adopted = next((v for v in reversed(rows) if v.status == "adopted"), None)
        busy = any(v.status == "trial" for v in rows)
        status: Status = "trial" if start_trial and not busy else "candidate"
        return self._save(StrategyVersion(key=key, version=(rows[-1].version + 1) if rows else 1, kind=kind, status=status, content=content,
                                          parent=adopted.version if adopted else None, provenance=provenance or {}))

    def start_trial(self, key: str, version: int) -> StrategyVersion:
        v = self.get(key, version)
        if v is None or v.status != "candidate":
            raise ValueError("only a candidate can start a trial")
        if any(x.status == "trial" for x in self.versions(key)):
            raise ValueError("another trial is running for this key")
        return self._save(v.model_copy(update={"status": "trial"}))

    def record(self, key: str, version: int, verified: bool | None) -> StrategyVersion | None:
        """Environment-verified outcome for a version that was in use. ``None`` is ignored."""
        v = self.get(key, version)
        if v is None or verified is None or v.status not in ("trial", "adopted"):
            return v
        v = self._save(v.model_copy(update={"successes": v.successes + int(verified), "failures": v.failures + int(not verified)}))
        return self._gate(v) if v.status == "trial" else v

    def _gate(self, v: StrategyVersion) -> StrategyVersion:
        if v.successes + v.failures < self.min_trials:
            return v
        parent = self.get(v.key, v.parent) if v.parent is not None else None
        baseline = parent.rate if parent is not None else None
        rate = v.rate or 0.0
        if (baseline is None and rate >= 0.5) or (baseline is not None and rate >= baseline):
            if parent is not None:
                self._save(parent.model_copy(update={"status": "retired", "decided_at": time.time(), "reason": f"superseded by v{v.version}"}))
            out = self._save(v.model_copy(update={"status": "adopted", "decided_at": time.time(),
                                                  "reason": f"verified rate {rate:.2f} >= {'none' if baseline is None else f'{baseline:.2f}'}"}))
        else:
            out = self._save(v.model_copy(update={"status": "rolled_back", "decided_at": time.time(),
                                                  "reason": f"verified rate {rate:.2f} < {'0.50' if baseline is None else f'{baseline:.2f}'}"}))
        self._promote_next(v.key)
        return out

    def rollback(self, key: str, reason: str = "manual rollback") -> StrategyVersion | None:
        """Stop the running trial (or demote the adopted version back to its parent)."""
        current = self.active(key)
        if current is None:
            return None
        out = self._save(current.model_copy(update={"status": "rolled_back", "decided_at": time.time(), "reason": reason}))
        if current.status == "adopted" and current.parent is not None and (parent := self.get(key, current.parent)) is not None:
            self._save(parent.model_copy(update={"status": "adopted", "reason": f"restored after rollback of v{current.version}"}))
        self._promote_next(key)
        return out

    def _promote_next(self, key: str) -> None:
        waiting = [v for v in self.versions(key) if v.status == "candidate" and v.kind != "method"]
        if waiting and not any(v.status == "trial" for v in self.versions(key)):
            self._save(waiting[0].model_copy(update={"status": "trial"}))

    def close(self) -> None:
        self.db.close()

    def export(self, key: str) -> list[dict[str, Any]]:
        return [json.loads(v.model_dump_json()) for v in self.versions(key)]
