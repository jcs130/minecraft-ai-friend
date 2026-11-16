"""Unified body protocol `agent-mc-body/v1` (Python, Pydantic v2).

Same vocabulary as the TypeScript `packages/agent-harness/src/body/types.ts`, so hosts and the gateway
protocol stay interchangeable. Python fields are snake_case; wire JSON (``to_wire``) is camelCase.
"""
from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

BODY_PROTOCOL: Literal["agent-mc-body/v1"] = "agent-mc-body/v1"

BodyKind = Literal["numen", "maid", "mineflayer"]

ActionVerb = Literal[
    "move", "follow", "stop", "look", "chat", "interact", "use_item", "attack", "mine", "collect", "place",
    "craft", "smelt", "equip", "eat", "drop", "pickup", "transfer", "flee", "wait", "observe", "inventory",
    "command", "recall", "stay", "sit", "cast", "native",
]
ACTION_VERBS: tuple[str, ...] = ActionVerb.__args__  # type: ignore[attr-defined]
MOTION_VERBS = frozenset({"move", "follow", "look", "interact", "use_item", "attack", "mine", "collect", "place", "flee", "recall", "cast"})

PaceCategory = Literal["motion", "dig", "combat", "chat", "other"]

BodyEventKind = Literal[
    "chat", "whisper", "system_message", "player_join", "player_leave", "death", "respawn", "health", "hunger",
    "effect", "level", "position", "dimension", "inventory", "entity", "combat", "action_progress", "action_result",
    "snapshot", "status", "server_status", "connection", "lifecycle", "dialogue", "safety", "other",
]
BODY_EVENT_KINDS: tuple[str, ...] = BodyEventKind.__args__  # type: ignore[attr-defined]

LifecycleState = Literal["detached", "spawning", "ready", "reconnecting", "dead", "destroyed", "error"]
ActionStatus = Literal["completed", "accepted", "failed", "rejected", "unsupported", "blocked_by_safety", "unknown"]
TERMINAL_STATUSES = frozenset({"completed", "failed", "rejected", "unsupported", "blocked_by_safety"})
REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,48}$")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True, exclude={"raw"} if "raw" in type(self).model_fields else None)


class WorldRef(Model):
    server_id: str | None = None
    world_key: str | None = None
    dimension: str | None = None


class Scope(Model):
    """Memory/intent partition. Comes from configuration and body metadata, never from chat text."""
    realm: str
    account: str
    agent: str


class BodyIdentity(Model):
    kind: BodyKind
    body_id: str  # Numen companion/role UUID, maid UUID
    name: str | None = None
    owner_id: str | None = None
    world: WorldRef = Field(default_factory=WorldRef)
    scope: Scope
    generation: str | None = None  # controller epoch / hosted epoch / maid binding generation

    def group_id(self) -> str:
        """Graphiti/local memory partition: one per body kind + server + world + body + agent scope.

        Matches the sidecar's group_id rule (1-64 chars of [A-Za-z0-9_-]). Dimension is NOT part of it:
        the overworld and the nether of one world are the same memory.
        """
        parts = [self.kind, self.world.server_id or "-", self.world.world_key or "-", self.body_id,
                 self.scope.realm, self.scope.account, self.scope.agent]
        digest = hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:20]
        label = re.sub(r"[^A-Za-z0-9_-]", "_", f"{self.kind}_{self.world.server_id or 'srv'}")[:40]
        return f"{label}_{digest}"


class ActionSupport(Model):
    native: str  # body's own operation, e.g. `lua numen.move.to`, `mc_maids follow`
    async_: bool = Field(default=False, alias="async")
    args: list[str] = Field(default_factory=list)
    notes: str | None = None


class NativeAction(Model):
    name: str
    description: str | None = None
    read_only: bool = False
    input_schema: dict[str, Any] | None = None


class LifecycleCaps(Model):
    spawn: Literal["connect", "attach", "summon", "bind-existing"]
    reconnect: bool
    destroy: Literal["disconnect", "release", "dismiss", "detach"]


class SafetyCaps(Model):
    anti_cheat_stop: bool = False
    pace_limits: bool = False
    native_guards: list[str] = Field(default_factory=list)


class Capabilities(Model):
    protocol: Literal["agent-mc-body/v1"] = BODY_PROTOCOL
    kind: BodyKind
    transport: str
    actions: dict[str, ActionSupport]
    native_actions: list[NativeAction] = Field(default_factory=list)
    events: list[BodyEventKind] = Field(default_factory=list)
    snapshot: list[Literal["position", "dimension", "health", "food", "inventory", "entities", "life_state", "text"]] = Field(default_factory=list)
    lifecycle: LifecycleCaps
    perception: Literal["push", "poll", "push+poll"]
    safety: SafetyCaps = Field(default_factory=SafetyCaps)
    limits: list[str] = Field(default_factory=list)

    def supports(self, verb: str, name: str | None = None) -> bool:
        if verb == "native":
            return any(n.name == name for n in self.native_actions)
        return verb in self.actions


class BodyAction(Model):
    verb: ActionVerb
    args: dict[str, Any] = Field(default_factory=dict)
    name: str | None = None  # for verb == native
    request_id: str | None = None  # idempotency key [A-Za-z0-9_-]{8,48}


class ActionReceipt(Model):
    request_id: str
    verb: str
    status: ActionStatus
    terminal: bool
    text: str = ""
    execution_id: str | None = None
    data: Any = None
    retry_allowed: Literal[False] = False  # an uncertain write is reconciled with result(), never replayed
    retry_after_ms: int | None = None


class BodySnapshot(Model):
    sampled_at: datetime = Field(default_factory=utcnow)
    life_state: Literal["alive", "dead", "unknown", "unloaded"] = "unknown"
    position: dict[str, float] | None = None
    dimension: str | None = None
    health: float | None = None
    max_health: float | None = None
    food: float | None = None
    inventory: Any = None
    entities: Any = None
    text: str | None = None
    raw: Any = Field(default=None, exclude=True)


class BodyEvent(Model):
    kind: BodyEventKind
    at: datetime = Field(default_factory=utcnow)
    body_kind: BodyKind
    body_id: str | None = None
    text: str = ""
    severity: Literal[1, 2, 3] = 1
    data: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None  # set on action_result / action_progress
    status: ActionStatus | None = None  # terminal status on action_result
    raw: Any = Field(default=None, exclude=True)


class Counters(Model):
    actions: int = 0
    completed: int = 0
    accepted: int = 0
    failed: int = 0
    unknown: int = 0
    unsupported: int = 0
    safety_blocked: int = 0
    events: int = 0
    errors: int = 0


class SafetyState(Model):
    halted: bool = False
    reason: str | None = None
    since: datetime | None = None


class BodyHealth(Model):
    kind: BodyKind
    lifecycle: LifecycleState
    connected: bool
    since: datetime
    last_event_at: datetime | None = None
    last_action_at: datetime | None = None
    counters: Counters
    last_error: str | None = None  # adapters only hold token *references* (file paths / env names)
    safety: SafetyState | None = None
    extra: dict[str, Any] = Field(default_factory=dict)
