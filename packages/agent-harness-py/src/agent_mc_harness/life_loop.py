"""Bounded, durable life-work state shared by server-hosted characters.

The state is a semantic commitment and review rhythm, not an action script. Body
capabilities, current observations and original receipts remain authoritative.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .models import ActionReceipt, BodyAction, BodySnapshot

LifeTier = Literal["villager", "maid", "numen"]
LifeStatus = Literal["idle", "active", "waiting", "blocked", "paused", "completed"]


class LifeProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, alias_generator=to_camel, populate_by_name=True)
    goal: str = Field(min_length=1, max_length=180)
    phase: str = Field(default="", max_length=120)
    next_action: str = Field(default="", max_length=240)
    success_evidence: str = Field(default="", max_length=240)
    review_after_seconds: int = Field(default=90, ge=15, le=1800)
    alternatives: list[str] = Field(default_factory=list, max_length=4)
    status: LifeStatus = "active"

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class LifeState(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[1] = 1
    character_id: str
    tier: LifeTier
    revision: int = Field(ge=1)
    status: LifeStatus
    goal: str = ""
    phase: str = ""
    next_action: str = ""
    success_evidence: str = ""
    review_at: float
    blocked_reason: str = ""
    alternatives: list[str] = Field(default_factory=list)
    last_progress_at: float
    progress_fingerprint: str = ""
    stagnant_reviews: int = Field(default=0, ge=0)
    updated_at: float


class LifeView(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    tier: LifeTier
    needs: dict[str, str]
    activity: str
    progress_fingerprint: str
    observed_at: float
    body_alive: bool


def _finite(value: object, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) < 1e30 else default


def _inventory_fingerprint(value: object) -> str:
    if value is None:
        return "unknown"
    try:
        encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    except (TypeError, ValueError, RecursionError):
        return "unknown"
    return hashlib.sha256(encoded.encode()).hexdigest()[:16]


def _coarse_position(position: object) -> tuple[int, int, int] | None:
    if not isinstance(position, dict):
        return None
    values = [position.get(key) for key in ("x", "y", "z")]
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or value != value or abs(value) >= 1e9 for value in values):
        return None
    return tuple(int(value // 4) for value in values)  # type: ignore[return-value]


def observe(role, snapshot: BodySnapshot | None, native: dict[str, Any], dialogue: list, body_results: list[dict[str, Any]], now: float | None = None) -> LifeView:
    """Project only current, bounded facts. Unknown stays unknown."""
    now = time.time() if now is None else now
    native = native if isinstance(native, dict) else {}
    resident = native.get("resident") if isinstance(native.get("resident"), dict) else native
    combat = resident.get("combat") if isinstance(resident.get("combat"), dict) else {}
    entities_known = snapshot is not None and isinstance(snapshot.entities, list)
    entities = snapshot.entities if entities_known else []
    hostile = any(isinstance(entity, dict) and entity.get("hostile") is True for entity in entities)
    health = snapshot.health if snapshot is not None else None
    max_health = snapshot.max_health if snapshot is not None else None
    food = snapshot.food if snapshot is not None else None
    life_state = snapshot.life_state if snapshot is not None else "unknown"
    needs = {
        "danger": "unknown" if snapshot is None or not entities_known and not combat.get("targetId") else "present" if hostile or combat.get("targetId") or life_state == "dead" else "clear",
        "health": "unknown" if not isinstance(health, (int, float)) or not isinstance(max_health, (int, float)) or max_health <= 0
        else "critical" if health <= max_health * .3 else "low" if health <= max_health * .6 else "ok",
        "hunger": "unknown" if not isinstance(food, (int, float)) else "low" if food <= 6 else "ok",
        "sleep": "active" if resident.get("sleeping") is True else "unknown",
        "equipment": "unknown",
        "social": "addressed" if dialogue else "nearby" if any(isinstance(entity, dict) and entity.get("ally") is True for entity in entities) else "none",
        "work": "active" if native.get("taskId") not in (None, "", "touhou_little_maid:idle") or resident.get("task") not in (None, "", "touhou_little_maid:idle") else "available",
    }
    for result in body_results:
        inventory = result.get("inventorySample")
        if isinstance(inventory, list):
            needs["equipment"] = "observed"
            break
    activity = str(native.get("taskId") or resident.get("task") or "idle")
    if combat.get("targetId"):
        activity = "fighting"
    elif resident.get("sleeping") is True:
        activity = "sleeping"
    position = _coarse_position(snapshot.position if snapshot else None)
    fingerprint_parts = [
        role.body_kind,
        life_state,
        (snapshot.dimension or "unknown") if snapshot else "unknown",
        str(position),
        int(health // 2) if isinstance(health, (int, float)) else "unknown",
        int(food // 2) if isinstance(food, (int, float)) else "unknown",
        activity,
        str(combat.get("targetId") or ""),
        _inventory_fingerprint(snapshot.inventory if snapshot else None),
    ]
    fingerprint = hashlib.sha256("|".join(str(part) for part in fingerprint_parts).encode()).hexdigest()[:20]
    return LifeView(tier=role.body_kind, needs=needs, activity=activity, progress_fingerprint=fingerprint,
                    observed_at=now, body_alive=life_state == "alive")


def validate_proposal(role, value: object) -> LifeProposal:
    if not isinstance(value, dict):
        raise ValueError("life_proposal_object_required")
    allowed = {"goal", "phase", "nextAction", "successEvidence", "reviewAfterSeconds", "alternatives", "status"}
    if set(value) - allowed:
        raise ValueError("life_proposal_unknown_fields")
    proposal = LifeProposal.model_validate({
        "goal": value.get("goal"),
        "phase": value.get("phase", ""),
        "nextAction": value.get("nextAction", ""),
        "successEvidence": value.get("successEvidence", ""),
        "reviewAfterSeconds": value.get("reviewAfterSeconds", 90),
        "alternatives": value.get("alternatives", []),
        "status": value.get("status", "active"),
    })
    limits = {"villager": (90, 300), "maid": (140, 420), "numen": (180, 600)}
    goal_max, evidence_max = limits[role.body_kind]
    if len(proposal.goal) > goal_max or len(proposal.success_evidence) > evidence_max:
        raise ValueError("life_proposal_tier_budget")
    if proposal.status == "completed" and not proposal.success_evidence:
        raise ValueError("life_completion_evidence_required")
    return proposal


def next_delay(state: LifeState | None, view: LifeView, *, external_event: bool, configured_interval: int, now: float | None = None) -> int:
    now = time.time() if now is None else now
    if external_event or view.needs["danger"] == "present" or view.needs["health"] == "critical":
        return 0
    if state is None:
        return {"villager": max(180, configured_interval * 3), "maid": max(90, configured_interval * 2), "numen": configured_interval}[view.tier]
    if state.status == "blocked":
        return max(15, min(300, int(state.review_at - now)))
    if state.status in {"paused", "completed"}:
        return max(60, configured_interval * 4)
    if state.status == "waiting":
        return max(15, min(300, int(state.review_at - now)))
    if view.needs["hunger"] == "low" or view.needs["health"] == "low":
        return min(30, configured_interval)
    return max(15, min(300, int(state.review_at - now)))


class LifeLoop:
    """SQLite-backed semantic state. It never dispatches a body action."""

    def __init__(self, journal):
        self.journal = journal
        self.db = journal.db if hasattr(journal, "db") else sqlite3.connect(":memory:")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_life_state (character TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS npc_life_events (request TEXT PRIMARY KEY, character TEXT NOT NULL, outcome TEXT NOT NULL, at REAL NOT NULL)")
        self.db.commit()

    def load(self, character_id: str, tier: LifeTier) -> LifeState | None:
        row = self.db.execute("SELECT state FROM npc_life_state WHERE character=?", (character_id,)).fetchone()
        if not row:
            return None
        state = LifeState.model_validate_json(row[0])
        if state.character_id != character_id or state.tier != tier:
            raise ValueError("life_state_identity_mismatch")
        return state

    def _save(self, state: LifeState, expected_revision: int | None = None) -> LifeState:
        with self.db:
            if expected_revision is None:
                self.db.execute("INSERT INTO npc_life_state VALUES (?,?,?) ON CONFLICT(character) DO UPDATE SET revision=excluded.revision,state=excluded.state",
                                (state.character_id, state.revision, state.model_dump_json()))
            else:
                cursor = self.db.execute("UPDATE npc_life_state SET revision=?,state=? WHERE character=? AND revision=?",
                                         (state.revision, state.model_dump_json(), state.character_id, expected_revision))
                if cursor.rowcount != 1:
                    raise ValueError("life_state_revision_conflict")
        return state

    def apply(self, role, proposal: LifeProposal, now: float | None = None) -> LifeState:
        now = time.time() if now is None else now
        character = str(role.character_id)
        prior = self.load(character, role.body_kind)
        state = LifeState(schema_version=1, character_id=character, tier=role.body_kind, revision=1 if prior is None else prior.revision + 1,
                          status=proposal.status, goal=proposal.goal, phase=proposal.phase, next_action=proposal.next_action,
                          success_evidence=proposal.success_evidence, review_at=now + proposal.review_after_seconds,
                          blocked_reason="", alternatives=proposal.alternatives,
                          last_progress_at=prior.last_progress_at if prior else now,
                          progress_fingerprint=prior.progress_fingerprint if prior else "", stagnant_reviews=0, updated_at=now)
        return self._save(state, prior.revision if prior else None)

    def observe(self, role, view: LifeView, now: float | None = None) -> LifeState | None:
        now = time.time() if now is None else now
        state = self.load(str(role.character_id), role.body_kind)
        if state is None:
            return None
        changed = state.progress_fingerprint != view.progress_fingerprint
        if changed:
            state = state.model_copy(update={"revision": state.revision + 1,
                                             "progress_fingerprint": view.progress_fingerprint, "last_progress_at": now,
                                             "stagnant_reviews": 0, "blocked_reason": "", "updated_at": now,
                                             "status": "active" if state.status == "blocked" else state.status})
            self._save(state, state.revision - 1)
        return state

    def record_outcome(self, role, action: BodyAction, receipt: ActionReceipt, view: LifeView, now: float | None = None) -> LifeState | None:
        now = time.time() if now is None else now
        character = str(role.character_id)
        if self.db.execute("SELECT 1 FROM npc_life_events WHERE request=?", (receipt.request_id,)).fetchone():
            return self.load(character, role.body_kind)
        state = self.load(character, role.body_kind)
        if state is None:
            return None
        prior_revision = state.revision
        progressed = state.progress_fingerprint != view.progress_fingerprint
        if progressed:
            state = state.model_copy(update={"revision": state.revision + 1,
                                             "progress_fingerprint": view.progress_fingerprint, "last_progress_at": now,
                                             "stagnant_reviews": 0, "blocked_reason": "", "updated_at": now,
                                             "status": "active" if state.status == "blocked" else state.status})
        if receipt.status in {"failed", "rejected", "unsupported", "blocked_by_safety"}:
            reason = (receipt.text or receipt.status).strip()[:180]
            state = state.model_copy(update={"revision": state.revision + 1, "status": "blocked", "blocked_reason": reason,
                                             "stagnant_reviews": state.stagnant_reviews + 1,
                                             "review_at": now + min(300, 45 * (2 ** min(state.stagnant_reviews, 3))), "updated_at": now})
        elif receipt.status == "completed" and not progressed:
            state = state.model_copy(update={"revision": state.revision + 1, "stagnant_reviews": state.stagnant_reviews + 1,
                                             "review_at": now + min(300, 45 * (2 ** min(state.stagnant_reviews, 3))), "updated_at": now})
        self._save(state, prior_revision)
        with self.db:
            self.db.execute("INSERT INTO npc_life_events VALUES (?,?,?,?)", (receipt.request_id, character, receipt.status, now))
        return state

    def view(self, role, state: LifeState | None, life_view: LifeView) -> dict[str, Any]:
        return {"tier": role.body_kind, "needs": life_view.needs, "activity": life_view.activity,
                "state": None if state is None else state.model_dump(),
                "policy": "Needs and current receipts outrank the commitment. Revise or pause it when facts change; empty steps mean continue, not completion."}
