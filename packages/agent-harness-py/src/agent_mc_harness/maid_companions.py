"""Turn an autonomous social choice into native walks towards observed players."""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from uuid import UUID

from .models import BodySnapshot
from .runtime import Step


Point = tuple[float, float, float]
SIGHT_RANGE = 24
ARRIVAL_RANGE = 3
FOLLOW_AGAIN_RANGE = 5
STEP_INTERVAL = 3
WALK_TIMEOUT = 30  # NativeMaidBodyActions' maximum lifetime for one walk.
LOST_GRACE = 15
BLOCKED_COOLDOWN = 90


def _point(value) -> Point | None:
    if isinstance(value, dict):
        xyz = tuple(value.get(axis) for axis in "xyz")
        if all(type(n) in (float, int) and -30_000_001 <= n <= 30_000_001 for n in xyz):
            return xyz
    return None


@dataclass(frozen=True)
class _Player:
    uuid: str
    name: str
    position: Point
    distance: float


def _players(snapshot: BodySnapshot | None) -> dict[str, _Player]:
    if (snapshot is None or snapshot.life_state != "alive" or not snapshot.dimension
            or not -1 <= time.time() - snapshot.sampled_at.timestamp() <= 5):
        return {}
    origin = _point(snapshot.position)
    rows = snapshot.raw.get("nearbyPlayers") if isinstance(snapshot.raw, dict) else None
    if origin is None or not isinstance(rows, list):
        return {}
    players = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("dimension") != snapshot.dimension:
            continue
        name, uid, pos = row.get("name"), row.get("uuid"), _point(row.get("position"))
        if not isinstance(name, str) or not name.strip() or not isinstance(uid, str) or pos is None:
            continue
        try:
            if str(UUID(uid)) != uid:
                continue
        except ValueError:
            continue
        distance = math.dist(origin, pos)
        if distance <= SIGHT_RANGE:
            players[uid] = _Player(uid, name, pos, distance)
    return players


def walk_available(snapshot: BodySnapshot | None) -> bool:
    """Native bridge checks posture, path eligibility, combat, task, work and open menus."""
    if (not snapshot or snapshot.life_state != "alive" or not isinstance(snapshot.raw, dict)
            or snapshot.raw.get("socialWalkAvailable") is not True):
        return False
    resident = snapshot.raw.get("resident")
    if resident is None:
        return True
    if not isinstance(resident, dict) or resident.get("loaded") is not True:
        return False
    expedition = resident.get("expedition") or {}
    # 'leased' is the resident's recruited party body. It is independent of this MC host's binding.
    return not (resident.get("leased") or resident.get("thinking") or resident.get("downed")
                or resident.get("sleeping") or (resident.get("combat") or {}).get("targetId")
                or resident.get("activeRequest") not in (None, "", "none") or resident.get("recovery")
                or expedition.get("pendingTravelRequestId") or expedition.get("state") in
                {"travel_ledger_unavailable", "travel_unconfirmed_check_ledger", "inspect_original_travel"})


def parse_choice(plan, nearby_players: list[dict]) -> dict | None:
    """Parse one social intention. Echoed native steps are never executed."""
    if not isinstance(plan, dict):
        return None
    steps = plan.get("steps")
    explicit = "companion" in plan
    # Empty-argument body:follow keeps its original, owner-specific meaning.
    if not explicit and not (isinstance(steps, list) and any(
            isinstance(s, dict) and s.get("tool") == "body:follow" and s.get("args") for s in steps)):
        return None
    expected = {"steps", "companion"} if explicit else {"steps"}
    if set(plan) != expected or not isinstance(steps, list) or len(steps) > 3:
        raise ValueError("invalid_companion_plan")
    echoed = []
    for step in steps:
        if not isinstance(step, dict) or set(step) - {"tool", "args"}:
            raise ValueError("invalid_companion_step")
        args = step.get("args", {})
        if not isinstance(args, dict):
            raise ValueError("invalid_companion_args")
        if step.get("tool") == "body:chat" and set(args) == {"text"} and isinstance(args["text"], str):
            continue
        if step.get("tool") != "body:follow" or echoed or set(args) not in (set(), {"uuid"}, {"targetUuid"}):
            raise ValueError("unexpected_companion_step")
        echoed_target = args.get("targetUuid", args.get("uuid"))
        if args and not isinstance(echoed_target, str):
            raise ValueError("invalid_companion_target")
        echoed.append(echoed_target)
    if explicit:
        choice = plan["companion"]
        if choice == {"mode": "stop"} and not echoed:
            return choice
        if (not isinstance(choice, dict) or set(choice) != {"mode", "targetUuid"}
                or choice["mode"] not in ("approach", "follow")):
            raise ValueError("invalid_companion_choice")
        target = choice["targetUuid"]
        if echoed and echoed[0] is not None and echoed[0] != target:
            raise ValueError("conflicting_companion_targets")
    else:
        target = echoed[0]
        choice = {"mode": "follow", "targetUuid": target}
    if not isinstance(target, str) or not any(p.get("uuid") == target for p in nearby_players):
        raise ValueError("companion_target_not_observed")
    return choice


class MaidCompanions:
    """Per-body intent. The host owns in-flight actions, receipts, and control priority."""

    def __init__(self, *, clock=time.monotonic):
        self.clock = clock
        self.target: str | None = None
        self.name = self.dimension = self.mode = ""
        self.status = "idle"
        self.last_walk = -math.inf
        self.last_goal: Point | None = None
        self.last_origin: Point | None = None
        self.attempts = 0
        self.missing_since: float | None = None
        self.blocked_until: dict[str, float] = {}

    @property
    def active(self) -> bool:
        return self.target is not None

    def _clear(self, status: str):
        self.target = None
        self.status = status
        self.last_goal = self.last_origin = None
        self.attempts = 0
        self.missing_since = None

    def _observe(self, snapshot, visible):
        if not self.active:
            return
        if snapshot is not None and (snapshot.life_state == "dead"
                                     or snapshot.dimension and snapshot.dimension != self.dimension):
            self._clear("target_lost")
            return
        player = visible.get(self.target)
        if player is None:
            now = self.clock()
            if self.missing_since is None:
                self.missing_since = now
            self.status = "out_of_sight"
            if now - self.missing_since >= LOST_GRACE:
                self._clear("target_lost")
            return
        self.missing_since = None
        if player.distance <= ARRIVAL_RANGE:
            if self.mode == "approach":
                self._clear("arrived")
            else:
                self.status = "alongside"
                self.last_goal = self.last_origin = None
                self.attempts = 0
        elif self.status != "alongside" or player.distance > FOLLOW_AGAIN_RANGE:
            self.status = "tracking"

    def context(self, snapshot: BodySnapshot | None) -> dict:
        visible = _players(snapshot)
        self._observe(snapshot, visible)
        now = self.clock()
        self.blocked_until = {uid: end for uid, end in self.blocked_until.items() if end > now}
        return {
            "nearbyPlayers": [{"uuid": p.uuid, "name": p.name, "distance": round(p.distance, 1)}
                              for p in sorted(visible.values(), key=lambda p: (p.distance, p.uuid))
                              if p.uuid not in self.blocked_until],
            "selection": {"mode": self.mode, "uuid": self.target, "name": self.name} if self.active else None,
            "status": self.status,
        }

    def choose(self, mode: str, target_uuid: str | None, snapshot: BodySnapshot | None) -> bool:
        if mode == "stop" and target_uuid is None:
            self._clear("stopped")
            return True
        if mode not in ("approach", "follow") or not isinstance(target_uuid, str):
            return False
        visible = _players(snapshot)
        player = visible.get(target_uuid)
        if player is None or self.blocked_until.get(target_uuid, -math.inf) > self.clock():
            return False
        if self.target != target_uuid:
            self._clear("tracking")
        elif self.mode != mode:
            self.status = "tracking"
        self.target, self.name, self.dimension, self.mode = target_uuid, player.name, snapshot.dimension, mode
        self._observe(snapshot, visible)
        return True

    def next_step(self, snapshot: BodySnapshot | None, *, busy: bool = False) -> Step | None:
        """Only emit a new walk when the host has no competing or uncertain body action."""
        visible = _players(snapshot)
        self._observe(snapshot, visible)
        if busy or self.status != "tracking" or self.target not in visible or not walk_available(snapshot):
            return None
        now = self.clock()
        player = visible[self.target]
        origin = _point(snapshot.position)
        elapsed = now - self.last_walk
        if elapsed < STEP_INTERVAL:
            return None
        if self.last_goal is not None and math.dist(self.last_goal, player.position) < 2 and elapsed < WALK_TIMEOUT:
            return None
        if self.last_origin is not None and math.dist(self.last_origin, origin) >= 1.5:
            self.attempts = 0
        if self.attempts >= 2:
            self.blocked_until[self.target] = now + BLOCKED_COOLDOWN
            self._clear("path_unavailable")
            return None
        self.attempts += 1
        self.last_walk, self.last_origin, self.last_goal = now, origin, player.position
        return Step(tool="body:move", args={**dict(zip("xyz", player.position)), "dimension": snapshot.dimension})
