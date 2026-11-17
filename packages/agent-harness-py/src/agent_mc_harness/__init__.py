"""agent-mc-harness (Python): lightweight harness runtime + unified body adapter for server-hosted bodies."""
from __future__ import annotations

from typing import Any

from .body.base import ArgumentError, BaseBody, BodyAdapter, new_request_id
from .body.safety import GuardedBody, guard_body, is_warning_text
from .flags import Flags
from .memory import LocalMemory, MemoryRouter, open_memory
from .models import (
    ACTION_VERBS,
    BODY_EVENT_KINDS,
    BODY_PROTOCOL,
    ActionReceipt,
    BodyAction,
    BodyEvent,
    BodyHealth,
    BodyIdentity,
    BodySnapshot,
    Capabilities,
    Scope,
    WorldRef,
)
from .runtime import HarnessRuntime, Intent, PlanContext, Step

__all__ = [
    "ACTION_VERBS", "BODY_EVENT_KINDS", "BODY_PROTOCOL", "ActionReceipt", "ArgumentError", "BaseBody", "BodyAction", "BodyAdapter",
    "BodyEvent", "BodyHealth", "BodyIdentity", "BodySnapshot", "Capabilities", "Flags", "GuardedBody", "HarnessRuntime", "Intent",
    "LocalMemory", "MemoryRouter", "PlanContext", "Scope", "Step", "WorldRef", "create_harness", "guard_body", "is_warning_text",
    "new_request_id", "open_memory",
]


def create_harness(body: BodyAdapter, flags: Flags | None = None, **options: Any) -> HarnessRuntime | None:
    """Returns None unless AGENT_HARNESS_PY_ENABLED is on. The body is wrapped in the safety guard."""
    flags = flags or Flags.from_env()
    if not flags.enabled:
        return None
    guarded = body if isinstance(body, GuardedBody) else guard_body(body)
    memory = open_memory(flags.memory, local_path=flags.memory_path)
    if (flags.fastslow or flags.jitrl) and "fastslow" not in options:
        from .fastslow import FastSlow, FastSlowConfig
        from .typed_choice import SystemOneClient
        typed = (SystemOneClient(flags.system_one_url, flags.system_one_model, api_key_env=flags.system_one_key_env)
                 if flags.system_one_url and flags.system_one_model else None)
        jit = None
        if flags.jitrl:
            from .learning.jitrl import GoalWeights, JitRL
            jit = JitRL(GoalWeights.load(flags.jitrl_weights) if flags.jitrl_weights else None, path=flags.jitrl_path)
        options["fastslow"] = FastSlow(FastSlowConfig(use_router=flags.fastslow), typed=typed, jitrl=jit)
    strategies = options.setdefault("strategies", None)
    if flags.reflection and "reflection" not in options:
        # Resident reflection: on whenever the harness is enabled. Deterministic fallback when no LLM is configured.
        from .learning.reflection import LLMReflector, ReflectionLoop
        from .learning.strategies import StrategyStore
        if strategies is None:
            strategies = options["strategies"] = StrategyStore(flags.strategies_path)
        llm = (LLMReflector(flags.reflector_url, flags.reflector_model, flags.reflector_key_env)
               if flags.reflector_url and flags.reflector_model and flags.reflector_key_env else None)

        def group() -> str | None:
            ident = guarded.identity()
            return ident.group_id() if ident is not None else None
        options["reflection"] = ReflectionLoop(memory=memory, group_id=group, strategies=strategies, reflector=llm)
    return HarnessRuntime(body=guarded, memory=memory, execute=flags.execute, **options)
