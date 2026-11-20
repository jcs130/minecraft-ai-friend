"""Turn an autonomous social choice into a path or a travel spell to a located character."""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from uuid import UUID

from .models import BodySnapshot
from .runtime import Step

Point = tuple[float, float, float]
SIGHT_RANGE = 24  # Scope of a visual observation from an older bridge.
WALK_RANGE = 96  # The native navigator accepts goals within 96 blocks.
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
    aliases: tuple[str, ...]
    position: Point
    dimension: str
    distance: float | None


def _players(snapshot: BodySnapshot | None) -> dict[str, _Player]:
    if (snapshot is None or snapshot.life_state != "alive" or not snapshot.dimension
            or not -1 <= time.time() - snapshot.sampled_at.timestamp() <= 5):
        return {}
    origin = _point(snapshot.position)
    raw = snapshot.raw if isinstance(snapshot.raw, dict) else {}
    directory = "characterDirectory" in raw
    rows = raw.get("characterDirectory") if directory else raw.get("nearbyPlayers")
    if origin is None or not isinstance(rows, list):
        return {}
    players = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("dimension"), str) or not row["dimension"]:
            continue
        name, uid, pos = row.get("name"), row.get("uuid"), _point(row.get("position"))
        if not isinstance(name, str) or not name.strip() or not isinstance(uid, str) or pos is None:
            continue
        try:
            if str(UUID(uid)) != uid:
                continue
        except ValueError:
            continue
        dimension = row["dimension"]
        distance = math.dist(origin, pos) if snapshot.dimension == dimension else None
        if directory or (distance is not None and distance <= SIGHT_RANGE):
            aliases = row.get("aliases")
            labels = [row.get("displayName"), *(aliases if isinstance(aliases, list) else ())]
            aliases = tuple(dict.fromkeys(label for label in labels if isinstance(label, str) and label and label != name))
            players[uid] = _Player(uid, name, aliases, pos, dimension, distance)
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


def parse_choice(plan, characters: list[dict], *, read_echoes: set[str] | None = None) -> dict | None:
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
    incidental = set()
    for step in steps:
        if not isinstance(step, dict) or set(step) - {"tool", "args"}:
            raise ValueError("invalid_companion_step")
        args = step.get("args", {})
        if not isinstance(args, dict):
            raise ValueError("invalid_companion_args")
        tool = step.get("tool")
        if not isinstance(tool, str) or tool in incidental:
            raise ValueError("unexpected_companion_step")
        if ((tool == "body:chat" and set(args) == {"text"} and isinstance(args["text"], str))
                or (explicit and not args and (tool == "body:native:guard" or tool in (read_echoes or ())))):
            # Recorded samples and guard chatter can accompany a choice. Only the chosen meeting executes.
            incidental.add(tool)
            continue
        if step.get("tool") != "body:follow" or echoed or set(args) not in (set(), {"uuid"}, {"targetUuid"}):
            raise ValueError("unexpected_companion_step")
        echoed_target = args.get("targetUuid", args.get("uuid"))
        if args and not isinstance(echoed_target, str):
            raise ValueError("invalid_companion_target")
        echoed.append(echoed_target)
    if explicit:
        choice = plan["companion"]
        if choice == {"mode": "stop"} and not echoed and "body:native:guard" not in incidental:
            return choice
        if (not isinstance(choice, dict) or set(choice) - {"mode", "targetUuid", "targetName", "travel"}
                or not {"targetUuid", "targetName"}.intersection(choice) or choice.get("mode") not in ("approach", "follow")
                or choice.get("travel", "auto") not in ("auto", "walk", "teleport")):
            raise ValueError("invalid_companion_choice")
        if "targetName" in choice:
            name = choice["targetName"]
            matches = [p["uuid"] for p in characters if isinstance(name, str) and any(
                label.casefold() == name.casefold() for label in (p["name"], *p.get("aliases", ())))]
            if "targetUuid" in choice:
                matches = [uid for uid in matches if uid == choice["targetUuid"]]
            if len(matches) != 1:
                raise ValueError("choose_one_character_uuid_from_the_directory")
            choice = {k: v for k, v in choice.items() if k != "targetName"} | {"targetUuid": matches[0]}
        target = choice["targetUuid"]
        if echoed and echoed[0] is not None and echoed[0] != target:
            raise ValueError("conflicting_companion_targets")
    else:
        target = echoed[0]
        choice = {"mode": "follow", "targetUuid": target}
    if not isinstance(target, str) or not any(p.get("uuid") == target for p in characters):
        raise ValueError("companion_target_not_observed")
    return choice


class MaidCompanions:
    """Per-body intent. The host owns in-flight actions, receipts, and control priority."""

    def __init__(self, *, clock=time.monotonic):
        self.clock = clock
        self.target: str | None = None
        self.name = self.dimension = self.mode = ""
        self.travel = "auto"
        self.status = "idle"
        self.last_walk = -math.inf
        self.last_goal: Point | None = None
        self.last_origin: Point | None = None
        self.attempts = 0
        self.remote_sent = False
        self.release_requested: str | None = None
        self.last_transfer: dict | None = None
        self.missing_since: float | None = None
        self.blocked_until: dict[str, float] = {}

    @property
    def active(self) -> bool:
        return self.target is not None

    def _clear(self, status: str):
        self.target = None
        self.remote_sent = False
        self.status = status
        self.last_goal = self.last_origin = None
        self.attempts = 0
        self.missing_since = None

    def _alongside(self):
        self.status = "alongside"
        if self.travel == "teleport":
            # The chosen spell was for the meeting. Walk behind the person from here.
            self.travel = "auto"

    def _observe(self, snapshot, visible):
        if not self.active:
            return
        if snapshot is not None and (snapshot.life_state == "dead"
                                     or "characterDirectory" not in (snapshot.raw or {}) and snapshot.dimension and snapshot.dimension != self.dimension):
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
        if player.distance is not None and player.distance <= ARRIVAL_RANGE:
            self.remote_sent = False
            if self.mode == "approach":
                self._clear("arrived")
            else:
                self._alongside()
                raw = snapshot.raw or {}
                if ("socialNavigationTargetUuid" not in raw or raw.get("socialNavigationTargetUuid") == player.uuid
                        or raw.get("ownerId") == player.uuid):
                    self.last_goal = self.last_origin = None
                    self.attempts = 0
        elif self.status != "alongside" or player.distance is None or player.distance > FOLLOW_AGAIN_RANGE:
            self.status = "tracking"

    def context(self, snapshot: BodySnapshot | None) -> dict:
        visible = _players(snapshot)
        self._observe(snapshot, visible)
        now = self.clock()
        self.blocked_until = {uid: end for uid, end in self.blocked_until.items() if end > now}
        raw = snapshot.raw if snapshot and isinstance(snapshot.raw, dict) else {}
        source = "skill_compass" if "characterDirectory" in raw else "sight"
        if raw.get("characterDirectoryUnavailable"):
            source = "skill_compass_unavailable"
        return {
            "source": source,
            "characters": [{"uuid": p.uuid, "name": p.name, "aliases": list(p.aliases), "distance": round(p.distance, 1) if p.distance is not None else None,
                            "dimension": p.dimension, "position": dict(zip("xyz", p.position, strict=True)),
                            **({"retryAfterSeconds": math.ceil(self.blocked_until[p.uuid] - now)} if p.uuid in self.blocked_until else {})}
                              for p in sorted(visible.values(), key=lambda p: (p.distance if p.distance is not None else math.inf, p.uuid))],
            "selection": {"mode": self.mode, "travel": self.travel, "uuid": self.target, "name": self.name} if self.active else None,
            "status": self.status,
            "lastTransfer": self.last_transfer,
        }

    def choose(self, mode: str, target_uuid: str | None, snapshot: BodySnapshot | None, *, travel: str = "auto") -> bool:
        if mode == "stop" and target_uuid is None:
            self._clear("stopped")
            return True
        if mode not in ("approach", "follow") or not isinstance(target_uuid, str) or travel not in ("auto", "walk", "teleport"):
            return False
        visible = _players(snapshot)
        player = visible.get(target_uuid)
        if player is None or self.blocked_until.get(target_uuid, -math.inf) > self.clock():
            return False
        if self.target != target_uuid:
            self._clear("tracking")
        elif self.mode != mode:
            self.status = "tracking"
        self.travel = travel
        self.target, self.name, self.dimension, self.mode = target_uuid, player.name, snapshot.dimension, mode
        self._observe(snapshot, visible)
        return True

    def settle_transfer(self, target, receipt):
        if not receipt.terminal:
            return
        envelope = receipt.data if isinstance(receipt.data, dict) else {}
        reply = envelope.get("reply", envelope)
        evidence = reply.get("data") if isinstance(reply, dict) else None
        observation = evidence.get("observation") if isinstance(evidence, dict) else None
        reason = observation.get("reason") if isinstance(observation, dict) else None
        self.last_transfer = {"targetUuid": target, "requestId": receipt.request_id,
                              "status": receipt.status, "message": (reason if isinstance(reason, str) else receipt.text)[:300]}
        if self.target != target:
            return
        if receipt.status != "completed":
            self.blocked_until[target] = self.clock() + BLOCKED_COOLDOWN
            self._clear("rendezvous_refused")
        elif self.mode == "approach":
            self._clear("arrived")
        else:
            self.remote_sent = False
            self.last_goal = self.last_origin = None
            self.attempts = 0
            self._alongside()

    def next_step(self, snapshot: BodySnapshot | None, *, busy: bool = False, can_teleport: bool = False) -> Step | None:
        """Only emit a new walk when the host has no competing or uncertain body action."""
        if snapshot is None or not -1 <= time.time() - snapshot.sampled_at.timestamp() <= 5:
            return None
        raw = snapshot.raw if isinstance(snapshot.raw, dict) else {}
        tagged = "socialNavigationTargetUuid" in raw
        held = raw.get("socialNavigationTargetUuid")
        if not self.active and not held:
            self.release_requested = None
            return None
        visible = _players(snapshot)
        self._observe(snapshot, visible)
        if held != self.release_requested or held == self.target:
            self.release_requested = None
        if held and held != self.target and not busy and self.release_requested != held:
            self.release_requested = held
            return Step(tool="body:native:release_rendezvous", args={"targetUuid": held})
        register = (tagged and self.mode == "follow" and self.status == "alongside" and held != self.target
                    and self.target != raw.get("ownerId"))
        if busy or (self.status != "tracking" and not register) or self.target not in visible or not walk_available(snapshot):
            return None
        now = self.clock()
        player = visible[self.target]
        origin = _point(snapshot.position)
        elapsed = now - self.last_walk
        if elapsed < STEP_INTERVAL:
            return None
        remote = player.distance is None or player.distance > WALK_RANGE
        if not remote and self.last_goal is not None and math.dist(self.last_goal, player.position) > 4:
            # The previous path may have been cancelled because the person moved.
            # That outcome is not evidence that walking to the new position is blocked.
            self.attempts = 0
        no_progress = self.attempts >= 2 and self.last_origin and math.dist(origin, self.last_origin) < 1.5
        use_spell = not register and (self.travel == "teleport" or (self.travel == "auto" and can_teleport and (remote or no_progress)))
        if use_spell:
            if self.remote_sent:
                self.status = "check_original_rendezvous_receipt"
                return None
            if not can_teleport or "characterDirectory" not in snapshot.raw:
                self._clear("rendezvous_skill_unavailable")
                return None
            self.remote_sent = True
            self.last_walk = now
            return Step(tool="body:native:rendezvous", args={"targetUuid": player.uuid})
        if player.distance is None:
            self._clear("different_dimension_requires_rendezvous")
            return None
        # Distant overland travel uses bounded legs. A native path failure never
        # licenses a growing series of unverified moves or an unrequested paid spell.
        destination = player.position
        if player.distance > WALK_RANGE:
            destination = tuple(a + (b - a) * 32 / player.distance for a, b in zip(origin, player.position, strict=True))
        if self.last_goal is not None and math.dist(self.last_goal, destination) < 2 and elapsed < WALK_TIMEOUT:
            return None
        if self.last_origin is not None and math.dist(self.last_origin, origin) >= 1.5:
            self.attempts = 0
        if self.attempts >= 2:
            self.blocked_until[self.target] = now + BLOCKED_COOLDOWN
            self._clear("path_unavailable")
            return None
        self.attempts += 1
        self.last_walk, self.last_origin, self.last_goal = now, origin, destination
        args = {**dict(zip("xyz", destination, strict=True)), "dimension": snapshot.dimension}
        if tagged and "characterDirectory" in raw:
            args["targetUuid"] = player.uuid
        return Step(tool="body:move", args=args)
