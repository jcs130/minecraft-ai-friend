"""Policy: who may ask for what, how much, and what it pays. Model output only picks within these bounds."""
from __future__ import annotations

import json
import re
from datetime import timedelta
from pathlib import Path
from typing import Literal

from pydantic import Field

from ..models import Model
from .models import Commission, Difficulty, Quest, QuestType, Reward

COLOR = re.compile(r"(?:[§&][0-9a-fk-orx])|<[^<>]{1,40}>", re.IGNORECASE)
CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


class PolicyViolation(ValueError):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def default_max_quantity() -> dict[Difficulty, int]:
    return {"easy": 5, "normal": 10, "hard": 20}


class VillagerProfile(Model):
    name: str = Field(min_length=1, max_length=32)
    npc_id: str | None = Field(default=None, max_length=64)
    types: list[QuestType] = Field(default_factory=lambda: list[QuestType](["slay"]))
    max_open: int = Field(default=1, ge=1, le=10)
    daily_quota: int = Field(default=3, ge=0, le=50)


class DeadlineBounds(Model):
    min: int = Field(default=10, ge=1)
    max: int = Field(default=1440, le=10080)


class QuestPolicy(Model):
    villagers: dict[str, VillagerProfile]
    targets: dict[QuestType, list[str]]
    max_quantity: dict[Difficulty, int] = Field(default_factory=default_max_quantity)
    rewards: dict[Difficulty, Reward]
    deadline_minutes: DeadlineBounds = Field(default_factory=DeadlineBounds)
    max_open_total: int = Field(default=6, ge=1, le=100)
    on_rejected: Literal["drop"] = "drop"  # rejected commissions are never retried or "repaired"

    @classmethod
    def load(cls, path: str | Path) -> QuestPolicy:
        return cls.model_validate(json.loads(Path(path).read_text(encoding="utf-8")))

    def profile(self, issuer: str) -> VillagerProfile:
        try:
            return self.villagers[issuer]
        except KeyError:
            raise PolicyViolation("unknown_issuer", issuer) from None

    def check(self, commission: Commission, *, open_for_issuer: int, open_total: int, issued_today: int) -> Commission:
        """Validate and return a sanitized copy. Raises :class:`PolicyViolation`; never adjusts numbers silently."""
        profile = self.profile(commission.issuer)
        if commission.type not in profile.types:
            raise PolicyViolation("type_not_allowed", f"{commission.issuer} may not issue {commission.type}")
        if commission.target not in self.targets.get(commission.type, []):
            raise PolicyViolation("target_not_allowed", commission.target)
        limit = self.max_quantity.get(commission.difficulty)
        if limit is None or commission.quantity > limit:
            raise PolicyViolation("quantity_over_limit", f"{commission.quantity} > {limit} for {commission.difficulty}")
        if commission.difficulty not in self.rewards:
            raise PolicyViolation("no_reward_tier", commission.difficulty)
        bounds = self.deadline_minutes
        if not bounds.min <= commission.deadline_minutes <= bounds.max:
            raise PolicyViolation("deadline_out_of_range", str(commission.deadline_minutes))
        if commission.type == "slay" and commission.area is None:
            raise PolicyViolation("area_required", "slay needs an area so kills elsewhere do not count")
        if open_for_issuer >= profile.max_open:
            raise PolicyViolation("issuer_open_limit", commission.issuer)
        if open_total >= self.max_open_total:
            raise PolicyViolation("global_open_limit")
        if issued_today >= profile.daily_quota:
            raise PolicyViolation("daily_quota", commission.issuer)
        title, story = clean_text(commission.title, 40), clean_text(commission.story, 300)
        if not title:
            raise PolicyViolation("empty_title")
        return commission.model_copy(update={"title": title, "story": story})

    def reward_for(self, quest_difficulty: Difficulty) -> Reward:
        return self.rewards[quest_difficulty].model_copy()

    def deadline(self, quest: Quest | Commission) -> timedelta:
        commission = quest.commission if isinstance(quest, Quest) else quest
        return timedelta(minutes=commission.deadline_minutes)


def clean_text(value: str, limit: int) -> str:
    """Drop color/MiniMessage codes and control chars; no leading command slash; collapse whitespace."""
    text = CONTROL.sub(" ", COLOR.sub("", value))
    text = " ".join(text.split()).lstrip("/").strip()
    return text[:limit]
