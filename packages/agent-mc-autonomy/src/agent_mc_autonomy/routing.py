"""Switch explicit planning backends only at the sole coordinator's decision boundary."""

from __future__ import annotations

import asyncio
import json
import tomllib

from .model_config import HttpPlannerConfig, planner_settings
from .planner import HttpPlanner, PlannerResponseError


def standalone_config(raw):
    if not isinstance(raw, dict):
        raise ValueError("brain_config_invalid")
    config = planner_settings({"route": "direct", **raw})
    if config is None:
        raise ValueError("standalone_requires_explicit_planner")
    return config


def create_planner(config, budget, timeout, *, journal=None):
    if isinstance(config, HttpPlannerConfig):
        return HttpPlanner(config, budget, timeout)
    from .harness_router import HarnessRouterConfig, HarnessRouterPlanner
    if isinstance(config, HarnessRouterConfig):
        return HarnessRouterPlanner(config, budget, timeout, journal=journal)
    raise ValueError("planner_configuration_unsupported")


class RoutedPlanner:
    """Own one planner at a time. A switch never opens/closes a Minecraft body.

    The file is explicit and only its planner table is hot-reloaded. Recheck it
    after inference so a response from a replaced backend cannot dispatch actions.
    Native goals, barriers, leases and pending receipts remain in Controller.
    """

    def __init__(self, config_file, budget, timeout, *, journal=None, factory=create_planner):
        self.config_file, self.budget, self.timeout = config_file, budget, timeout
        self.journal, self.factory = journal, factory
        self.current = None
        self.signature = None
        self.lock = asyncio.Lock()
        self.closed = False

    def load(self):
        source = self.config_file.read_bytes()
        if len(source) > 128 * 1024:
            raise ValueError("planner_configuration_too_large")
        raw = tomllib.loads(source.decode("utf-8-sig")).get("planner", {})
        config = standalone_config(raw)
        config.key()
        config.validate_budget(self.budget)
        return json.dumps(raw, sort_keys=True, allow_nan=False), config

    async def decide(self, messages, tools):
        async with self.lock:
            if self.closed:
                raise RuntimeError("planner_router_closed")
            signature, config = self.load()
            if self.signature != signature:
                replacement = self.factory(config, self.budget, self.timeout, journal=self.journal)
                if self.current:
                    await self.current.aclose()
                self.current, self.signature = replacement, signature
            result = await self.current.decide(messages, tools)
            latest, _ = self.load()
            if latest != signature:
                raise PlannerResponseError({"reason": "planner_changed_during_inference", "body_dispatched": False})
            return result

    async def aclose(self):
        async with self.lock:
            self.closed = True
            if self.current:
                await self.current.aclose()
                self.current = None
