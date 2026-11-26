"""Opt-in registration prototype; this module never starts or controls a Minecraft body.

Use only with a dedicated, isolated QwenPaw instance. QwenPaw's create endpoint
starts the new Agent with its defaults; this is not a safe shared-instance write
path. The caller supplies the already-bound API transport and authoritative role
identities (not player input). No chat, credentials, tools or memory are sent.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

PawRequest = Callable[[str, str, dict[str, Any] | None], tuple[int, object]]


@dataclass(frozen=True)
class Character:
    realm: str
    character_id: UUID
    body_id: UUID
    owner_id: UUID
    kind: str
    name: str

    def __post_init__(self):
        if not 1 <= len(self.realm) <= 160 or self.realm != self.realm.strip() or not self.realm.isprintable():
            raise ValueError("invalid_realm")
        if any(not isinstance(value, UUID) or not value.int for value in (self.character_id, self.body_id, self.owner_id)):
            raise ValueError("invalid_character_identity")
        if self.kind not in {"maid", "villager"} or self.body_id == self.owner_id:
            raise ValueError("unsupported_qwenpaw_body")
        if not 1 <= len(self.name) <= 24 or not self.name.isprintable():
            raise ValueError("invalid_display_name")

    @property
    def agent_id(self) -> str:
        key = json.dumps(["qiandengji-qwenpaw-character/v1", self.realm, str(self.character_id)],
                         ensure_ascii=True, separators=(",", ":"))
        return "qdc-" + hashlib.sha256(key.encode("ascii")).hexdigest()[:48]


@dataclass(frozen=True)
class Link:
    agent_id: str
    state: str
    detail: str | None = None


class PawLinker:
    """Durable create reservation with one original POST, even across restarts."""

    def __init__(self, state: Path, workspace_root: Path, instance_key: str, request: PawRequest):
        if not workspace_root.is_absolute() or not workspace_root.is_dir():
            raise ValueError("explicit_isolated_workspace_root_required")
        if not 1 <= len(instance_key) <= 160 or not instance_key.isprintable():
            raise ValueError("explicit_instance_identity_required")
        self.root = workspace_root.resolve(strict=True)
        self.state = state
        self.request = request
        with closing(self._open()) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS authority (singleton INTEGER PRIMARY KEY CHECK(singleton=1),"
                       " instance TEXT NOT NULL, workspace_root TEXT NOT NULL)")
            db.execute("INSERT OR IGNORE INTO authority VALUES (1, ?, ?)", (instance_key, str(self.root)))
            if db.execute("SELECT instance, workspace_root FROM authority").fetchone()[:] != (instance_key, str(self.root)):
                raise ValueError("isolated_instance_identity_changed")
            db.execute("CREATE TABLE IF NOT EXISTS bindings (realm TEXT NOT NULL, character TEXT NOT NULL,"
                       " body TEXT NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL, agent TEXT UNIQUE NOT NULL,"
                       " workspace TEXT UNIQUE NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','linked')) ,"
                       " PRIMARY KEY(realm, character))")

    def _open(self):
        db = sqlite3.connect(self.state, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=FULL")
        return db

    @staticmethod
    def _match_workspace(value: object, expected: str) -> bool:
        if not isinstance(value, str) or not Path(value).is_absolute():
            return False
        return os.path.normcase(os.path.normpath(value)) == os.path.normcase(expected)

    def _call(self, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
        try:
            return self.request(method, path, body)
        except (OSError, ValueError, TimeoutError):
            return 0, None  # A transport failure might follow a committed write.

    def _find(self, agent: str) -> tuple[str, dict]:
        status, value = self._call("GET", "/api/agents")
        if status != 200 or not isinstance(value, dict) or not isinstance(value.get("agents"), list):
            return "unavailable", {}
        rows = value["agents"]
        if len(rows) > 512 or any(not isinstance(row, dict) or not isinstance(row.get("id"), str) for row in rows):
            return "unavailable", {}
        matches = [r for r in rows if r["id"].casefold() == agent]
        if not matches:
            return "missing", {}
        if len(matches) != 1 or matches[0]["id"] != agent:
            return "conflict", {}
        return "found", matches[0]

    def ensure(self, role: Character) -> Link:
        agent = role.agent_id
        key = (role.realm, str(role.character_id))
        with closing(self._open()) as db:
            saved = db.execute("SELECT * FROM bindings WHERE realm=? AND character=?", key).fetchone()
        if saved is not None:
            return self._reconcile(role, saved)
        before, _ = self._find(agent)
        if before != "missing":
            return Link(agent, "unavailable" if before == "unavailable" else "conflict", "preexisting_or_unverified_id")
        workspace = self.root / f"{agent}-{uuid4().hex}"
        if os.path.lexists(workspace):
            return Link(agent, "conflict", "workspace_exists")
        with closing(self._open()) as db, db:
            cursor = db.execute("INSERT OR IGNORE INTO bindings VALUES (?,?,?,?,?,?,?,'reserved')",
                                (*key, str(role.body_id), str(role.owner_id), role.kind, agent, str(workspace)))
            allocated = cursor.rowcount == 1
            saved = db.execute("SELECT * FROM bindings WHERE realm=? AND character=?", key).fetchone()
        if saved is None:
            return Link(agent, "conflict", "binding_collision")
        if not allocated:
            return self._reconcile(role, saved)
        status, result = self._call("POST", "/api/agents", {"id": agent, "name": role.name, "backend": "qwenpaw",
                                                            "skill_names": [], "language": "zh", "workspace_dir": str(workspace)})
        if status == 201 and (not isinstance(result, dict) or result.get("id") != agent
                              or not self._match_workspace(result.get("workspace_dir"), str(workspace))):
            return Link(agent, "pending", "original_create_response_mismatch")
        return self._reconcile(role, saved)

    def _reconcile(self, role: Character, saved: sqlite3.Row) -> Link:
        agent = role.agent_id
        if (saved["agent"], saved["body"], saved["owner"], saved["kind"]) != (
                agent, str(role.body_id), str(role.owner_id), role.kind):
            return Link(agent, "conflict", "original_body_or_owner_changed")
        previous = saved["state"]
        status, row = self._find(agent)
        if status == "unavailable":
            return Link(agent, "unavailable", "roster_read_unconfirmed")
        if status == "missing":
            return Link(agent, "drift" if previous == "linked" else "pending", "original_agent_not_visible")
        workspace = saved["workspace"]
        if status != "found" or not self._match_workspace(row.get("workspace_dir"), workspace):
            return Link(agent, "drift" if previous == "linked" else "conflict", "registered_workspace_mismatch")
        # AgentSummary carries identity/backend/workspace without the secret-bearing full profile.
        # A degraded summary with missing backend is not ownership evidence.
        if row.get("backend") != "qwenpaw":
            return Link(agent, "drift" if previous == "linked" else "conflict", "summary_identity_unconfirmed")
        with closing(self._open()) as db, db:
            db.execute("UPDATE bindings SET state='linked' WHERE agent=? AND workspace=?", (agent, workspace))
        return Link(agent, "linked")  # Identity only. This says nothing about process startup or model behaviour.
