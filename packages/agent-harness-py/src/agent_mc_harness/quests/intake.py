"""Villager-side intake: the ``[委托]{json}`` line format and a local file spool (MVP transport).

The spool is written by the Bukkit author plugin with an atomic rename (``*.tmp`` -> ``*.json``). Each file is
processed once: moved to ``done/`` or ``rejected/`` (with a ``.reason.txt``). Rejected files are never retried.
"""
from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import Commission, QuestSignal

PREFIX = "[委托]"
MAX_FILE = 16 * 1024


class IntakeError(ValueError):
    pass


def parse_commission_line(line: str, *, issuer: str | None = None) -> Commission | None:
    """Parse one model output line. Returns ``None`` if the line is not a commission at all.

    ``issuer`` comes from the caller's configuration and overrides anything in the JSON, so a model (or a player
    talking to it) cannot impersonate another villager.
    """
    text = line.strip()
    if not text.startswith(PREFIX):
        return None
    raw = text[len(PREFIX):].strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise IntakeError(f"not JSON: {exc.msg}") from None
    if not isinstance(data, dict):
        raise IntakeError("commission must be a JSON object")
    if issuer is not None:
        data["issuer"] = issuer
    try:
        return Commission.model_validate(data)
    except ValidationError as exc:
        raise IntakeError(compact(exc)) from None


def compact(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:5])


@dataclass
class SpoolItem:
    path: Path
    commission: Commission | None
    error: str | None


class SpoolIntake:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.inbox = self.root / "inbox"
        for sub in ("inbox", "done", "rejected"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)

    def pending(self) -> Iterator[SpoolItem]:
        for path in sorted(self.inbox.glob("*.json")):
            commission, error = None, None
            try:
                if path.stat().st_size > MAX_FILE:
                    raise IntakeError("file too large")
                data: Any = json.loads(path.read_text(encoding="utf-8"))
                commission = Commission.model_validate(data)
            except ValidationError as exc:
                error = compact(exc)
            except (OSError, ValueError) as exc:
                error = str(exc)[:300]
            yield SpoolItem(path, commission, error)

    def settle(self, item: SpoolItem, *, accepted: bool, reason: str | None = None) -> None:
        dest = self.root / ("done" if accepted else "rejected") / item.path.name
        os.replace(item.path, dest)
        if not accepted:
            dest.with_suffix(".reason.txt").write_text(reason or item.error or "rejected", encoding="utf-8")


class SignalLog:
    """Reads ``signals.jsonl`` incrementally (byte offset kept in memory). Bad lines are skipped and counted."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.offset = 0
        self.bad = 0

    def read(self) -> list[QuestSignal]:
        if not self.path.exists():
            return []
        out: list[QuestSignal] = []
        with self.path.open("rb") as fh:
            fh.seek(self.offset)
            for raw in fh:
                if not raw.endswith(b"\n"):
                    break  # partial line still being written
                self.offset += len(raw)
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    out.append(QuestSignal.model_validate_json(line))
                except ValidationError:
                    self.bad += 1
        return out
