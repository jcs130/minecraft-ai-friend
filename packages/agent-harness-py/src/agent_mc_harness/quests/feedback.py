"""Feedback back to the villager side: the line a villager says, the chronicle note, and the reward request."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

from .models import Feedback, FeedbackKind, Quest

TARGET_NAMES = {
    "minecraft:zombie": "僵尸", "minecraft:skeleton": "骷髅", "minecraft:spider": "蜘蛛", "minecraft:creeper": "苦力怕",
    "minecraft:wheat": "小麦", "minecraft:bread": "面包", "minecraft:carrot": "胡萝卜", "minecraft:cod": "生鳕鱼",
}

TEMPLATES: dict[FeedbackKind, str] = {
    "offered": "【委托】{villager}：{title}——{ask}（{minutes} 分钟内）",
    "accepted": "{villager}：{hero}愿意帮忙？太好了，拜托你了！",
    "progress": "{villager}：已经 {progress}/{quantity} 了，辛苦啦。",
    "completed": "{villager}：真的谢谢你，{hero}！这是一点心意。",
    "failed": "{villager}：没关系，{hero}，先照顾好自己。",
    "expired": "{villager}：天色晚了，这件事就先放一放吧。",
    "cancelled": "{villager}：这件事不用麻烦了。",
}


def target_name(target: str) -> str:
    return TARGET_NAMES.get(target, target.split(":", 1)[-1])


def ask_text(quest: Quest) -> str:
    c = quest.commission
    if c.type == "gather":
        return f"带来 {c.quantity} 个{target_name(c.target)}"
    return f"讨伐 {c.quantity} 只{target_name(c.target)}"


def render(kind: FeedbackKind, quest: Quest, *, villager: str, hero: str | None) -> str:
    c = quest.commission
    return TEMPLATES[kind].format(villager=villager, title=c.title, ask=ask_text(quest), minutes=c.deadline_minutes,
                                  hero=hero or "旅人", progress=quest.progress, quantity=c.quantity)


def chronicle(kind: FeedbackKind, quest: Quest, *, villager: str, hero: str | None) -> str | None:
    if kind == "completed":
        return f"{hero or '旅人'}替{villager}完成了「{quest.commission.title}」。"
    if kind in ("failed", "expired"):
        return f"「{quest.commission.title}」没能完成。"
    return None


class FeedbackSink(Protocol):
    async def send(self, feedback: Feedback) -> None: ...


class MemoryFeedback:
    def __init__(self) -> None:
        self.sent: list[Feedback] = []

    async def send(self, feedback: Feedback) -> None:
        self.sent.append(feedback)


class JsonlFeedback:
    """Append-only outbox read by the Bukkit side. One JSON object per line, flushed and fsynced."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    async def send(self, feedback: Feedback) -> None:
        line = json.dumps(feedback.to_wire(), ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())
