"""A tiny in-memory body for runtime/scheduler tests (adapter-level fakes live in fakes.py)."""
from __future__ import annotations

import asyncio
from typing import Any

from agent_mc_harness.body.base import BaseBody
from agent_mc_harness.models import (
    ActionReceipt,
    ActionSupport,
    BodyAction,
    BodyIdentity,
    BodySnapshot,
    Capabilities,
    LifecycleCaps,
    NativeAction,
    Scope,
    WorldRef,
)

SCOPE = Scope(realm="sim", account="owner", agent="harness")


class SimBody(BaseBody):
    kind = "numen"

    def __init__(self, *, body_id: str = "6f0c1d2e-3a4b-4c5d-8e9f-001122334455", fail: set[str] | None = None,
                 unknown: set[str] | None = None, delay: float = 0.0) -> None:
        super().__init__()
        self.body_id, self.fail, self.unknown, self.delay = body_id, fail or set(), unknown or set(), delay
        self.health_, self.food, self.pos = 20.0, 18.0, {"x": 0.0, "y": 64.0, "z": 0.0}
        self.inventory: dict[str, int] = {}
        self.native_busy = False
        self.acts: list[BodyAction] = []
        self.effects: dict[str, dict[str, Any]] = {}  # verb -> {"health": +d, "food": +d, "item": (id, n), "x": +d}

    def identity(self) -> BodyIdentity | None:
        return BodyIdentity(kind="numen", body_id=self.body_id, world=WorldRef(server_id="sim", world_key="w"), scope=SCOPE)

    def capabilities(self) -> Capabilities:
        verbs = ["chat", "move", "mine", "eat", "attack", "flee", "stop", "observe", "craft"]
        return Capabilities(kind="numen", transport="sim", actions={v: ActionSupport(native=v) for v in verbs},
                            native_actions=[NativeAction(name="lua")], perception="poll",
                            lifecycle=LifecycleCaps(spawn="attach", reconnect=True, destroy="release"))

    async def spawn(self) -> None:
        self._set_state("ready")

    async def reconnect(self) -> None:
        self._set_state("ready")

    async def destroy(self) -> None:
        self._set_state("destroyed")

    async def _do_act(self, action: BodyAction, request_id: str) -> ActionReceipt:
        self.acts.append(action)
        if self.delay:
            await asyncio.sleep(self.delay)
        key = str(action.args.get("tag") or action.verb)
        if key in self.unknown:
            return self.receipt(request_id, action.verb, "unknown", "transport lost")
        if key in self.fail:
            return self.receipt(request_id, action.verb, "failed", f"{key} failed: target 3 blocks away")
        eff = self.effects.get(key, {})
        self.health_ += eff.get("health", 0)
        self.food += eff.get("food", 0)
        self.pos = {**self.pos, "x": self.pos["x"] + eff.get("x", 0)}
        if "item" in eff:
            item, n = eff["item"]
            self.inventory[item] = self.inventory.get(item, 0) + n
        return self.receipt(request_id, action.verb, "completed", f"{key} ok")

    async def stop(self, reason: str | None = None) -> ActionReceipt:
        return self.receipt("stop-" + "0" * 8, "stop", "completed", reason or "")

    async def snapshot(self) -> BodySnapshot:
        return BodySnapshot(life_state="alive", position=dict(self.pos), dimension="minecraft:overworld", health=self.health_, max_health=20,
                            food=self.food, inventory=dict(self.inventory), raw={"native_busy": self.native_busy})
