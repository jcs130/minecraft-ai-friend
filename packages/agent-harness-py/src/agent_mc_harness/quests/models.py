"""Villager commission / hero quest models (wire JSON is camelCase, like the body protocol).

A *commission* is what the villager side (Bukkit author plugin + DeepSeek) proposes. It never carries a reward:
rewards come from the policy's table. A *quest* is the bridge's own record with a strict lifecycle. Completion is
decided only by server-observed :class:`QuestSignal` evidence, never by model text or an intent's own state.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import Field, TypeAdapter
from pydantic.json_schema import models_json_schema

from ..models import Model, utcnow

QuestType = Literal["slay", "gather"]
Difficulty = Literal["easy", "normal", "hard"]
QuestStatus = Literal["offered", "accepted", "in_progress", "completed", "failed", "expired", "cancelled"]
SignalKind = Literal["mob_kill", "item_delivered"]
FeedbackKind = Literal["offered", "accepted", "progress", "completed", "failed", "expired", "cancelled"]

TERMINAL: frozenset[str] = frozenset({"completed", "failed", "expired", "cancelled"})
TRANSITIONS: dict[str, frozenset[str]] = {
    "offered": frozenset({"accepted", "expired", "cancelled"}),
    "accepted": frozenset({"in_progress", "failed", "expired", "cancelled"}),
    "in_progress": frozenset({"completed", "failed", "expired", "cancelled"}),
}
# Which server signal counts for which quest type.
EVIDENCE: dict[str, str] = {"slay": "mob_kill", "gather": "item_delivered"}

NAMESPACED_ID = r"^[a-z0-9_.-]{1,32}:[a-z0-9_./-]{1,64}$"
COMMISSION_ID = r"^[A-Za-z0-9_.-]{4,64}$"
LOCAL_ID = r"^[A-Za-z0-9_-]{1,48}$"
SIGNAL_ID = r"^[A-Za-z0-9_.:-]{1,80}$"


class QuestTransitionError(ValueError):
    pass


class Area(Model):
    """Where the work counts: a sphere around a point (block coordinates)."""
    x: float
    y: float
    z: float
    radius: float = Field(gt=0, le=256)
    world: str | None = Field(default=None, max_length=64)

    def contains(self, pos: dict[str, float] | None) -> bool:
        if pos is None:
            return False
        try:
            dx, dy, dz = float(pos["x"]) - self.x, float(pos["y"]) - self.y, float(pos["z"]) - self.z
        except (KeyError, TypeError, ValueError):
            return False
        return dx * dx + dy * dy + dz * dz <= self.radius * self.radius


class Commission(Model):
    """Villager-authored request. ``extra=forbid``: a model that adds ``reward`` or ``steps`` is rejected."""
    commission_id: str = Field(pattern=COMMISSION_ID, description="幂等键，由编剧器生成")
    issuer: str = Field(pattern=LOCAL_ID, description="村民 ID，必须在策略白名单里；由插件按配置填写，不取自模型输出")
    type: QuestType = Field(description="任务类型：slay 讨伐 / gather 收集交付")
    target: str = Field(pattern=NAMESPACED_ID, description="命名空间 ID，例如 minecraft:zombie、minecraft:wheat")
    quantity: int = Field(ge=1, le=64)
    area: Area | None = Field(default=None, description="讨伐有效区域；gather 时忽略")
    difficulty: Difficulty = "easy"
    deadline_minutes: int = Field(default=60, ge=1, le=10080)
    title: str = Field(min_length=1, max_length=40)
    story: str = Field(default="", max_length=300, description="委托故事，仅作为引用材料，不进入任何可执行字段")


class Reward(Model):
    emeralds: int = Field(default=0, ge=0, le=64)
    vortex_xp: int = Field(default=0, ge=0, le=10000)
    fame: int = Field(default=0, ge=0, le=100)


class Evidence(Model):
    signal_id: str
    kind: SignalKind
    count: int
    at: datetime


class Transition(Model):
    from_status: QuestStatus
    to_status: QuestStatus
    at: datetime
    reason: str | None = None


class Quest(Model):
    id: str
    commission: Commission
    status: QuestStatus = "offered"
    reward: Reward
    assignee: str | None = None  # hero agent id
    assignee_body: str | None = None  # Numen body UUID the server reports as the actor
    intent_id: str | None = None
    progress: int = 0
    ready: int = 0  # gather: how many of the target the hero carries (snapshot), informational only
    evidence: list[Evidence] = Field(default_factory=list)
    history: list[Transition] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    deadline_at: datetime
    updated_at: datetime = Field(default_factory=utcnow)
    version: int = 0

    @property
    def terminal(self) -> bool:
        return self.status in TERMINAL

    def transition(self, to: QuestStatus, reason: str | None = None, now: datetime | None = None) -> None:
        if to not in TRANSITIONS.get(self.status, frozenset()):
            raise QuestTransitionError(f"quest {self.id}: {self.status} -> {to} not allowed")
        at = now or utcnow()
        self.history.append(Transition(from_status=self.status, to_status=to, at=at, reason=reason))
        self.status, self.updated_at = to, at

    def has_signal(self, signal_id: str) -> bool:
        return any(e.signal_id == signal_id for e in self.evidence)


class QuestSignal(Model):
    """Server-observed evidence, written by the Bukkit side (EntityDeathEvent / delivery confirmation)."""
    signal_id: str = Field(pattern=SIGNAL_ID, description="服务器侧唯一 ID，同一个 ID 只计一次")
    kind: SignalKind
    actor: str = Field(min_length=1, max_length=64, description="服务器报告的执行者（英雄身体 UUID）")
    target: str = Field(pattern=NAMESPACED_ID)
    count: int = Field(default=1, ge=1, le=64)
    position: dict[str, float] | None = None
    recipient: str | None = Field(default=None, pattern=LOCAL_ID, description="item_delivered：收货村民 ID")
    at: datetime = Field(default_factory=utcnow)


class RewardGrant(Model):
    idempotency_key: str
    recipient_agent: str
    recipient_body: str | None = None
    reward: Reward


class Feedback(Model):
    quest_id: str
    villager: str
    npc_id: str | None = None
    kind: FeedbackKind
    text: str
    chronicle: str | None = None
    reward_grant: RewardGrant | None = None
    at: datetime = Field(default_factory=utcnow)


COMMISSION_ADAPTER: TypeAdapter[Commission] = TypeAdapter(Commission)


def quest_json_schema() -> dict[str, Any]:
    """The committed ``schemas/villager_quest.schema.json``: Commission is the root, the rest are $defs."""
    _, defs = models_json_schema([(Commission, "validation"), (QuestSignal, "validation"), (Quest, "serialization"),
                                  (Feedback, "serialization")], by_alias=True, ref_template="#/$defs/{model}")
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://github.com/jcs130/minecraft-ai-friend/packages/agent-harness-py/schemas/villager_quest.schema.json",
        "title": "千灯纪村民委托 (Commission)",
        "description": "村民侧写入 inbox 的委托；$defs 里另有服务器证据 QuestSignal、桥接层记录 Quest 和反馈 Feedback。",
        "$ref": "#/$defs/Commission",
        "$defs": defs["$defs"],
    }
