"""Feature flags. Everything defaults OFF: importing this package changes nothing in existing systems."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _on(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Flags:
    enabled: bool = False      # AGENT_HARNESS_PY_ENABLED
    execute: bool = False      # AGENT_HARNESS_PY_EXECUTE  (off = observe/memory only, never calls body.act)
    memory: str = "off"        # AGENT_HARNESS_PY_MEMORY   off | local | graphiti
    memory_path: str = ":memory:"  # AGENT_HARNESS_PY_MEMORY_PATH (sqlite file for the local fallback)
    fastslow: bool = False     # AGENT_HARNESS_PY_FASTSLOW (reflex/rules -> System 1 -> System 2 routing; off = planner only)
    system_one_url: str | None = None   # AGENT_HARNESS_PY_SYSTEMONE_URL  (loopback http or https, path ends /systemone)
    system_one_model: str | None = None  # AGENT_HARNESS_PY_SYSTEMONE_MODEL
    system_one_key_env: str | None = None  # AGENT_HARNESS_PY_SYSTEMONE_KEY_ENV (NAME of the env var holding the key)
    reflection: bool = True    # AGENT_HARNESS_PY_REFLECTION (resident; ON whenever the harness itself is enabled; "off" disables)
    reflector_url: str | None = None      # AGENT_HARNESS_PY_REFLECTOR_URL (OpenAI-compatible base URL, e.g. https://api.deepseek.com)
    reflector_model: str | None = None    # AGENT_HARNESS_PY_REFLECTOR_MODEL
    reflector_key_env: str | None = None  # AGENT_HARNESS_PY_REFLECTOR_KEY_ENV (NAME, e.g. DEEPSEEK_API_KEY)
    strategies_path: str = ":memory:"     # AGENT_HARNESS_PY_STRATEGIES_PATH (versioned self-iteration store)
    jitrl: bool = False        # AGENT_HARNESS_PY_JITRL (action-selection hook + reward shaping)
    jitrl_weights: str | None = None      # AGENT_HARNESS_PY_JITRL_WEIGHTS (JSON/YAML goal->metric weight table)
    jitrl_path: str | None = None         # AGENT_HARNESS_PY_JITRL_PATH (JSONL sample book)

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Flags:
        e = os.environ if env is None else env
        memory = (e.get("AGENT_HARNESS_PY_MEMORY") or "off").strip().lower()
        if memory not in ("off", "local", "graphiti"):
            raise ValueError("AGENT_HARNESS_PY_MEMORY must be off|local|graphiti")
        return cls(enabled=_on(e.get("AGENT_HARNESS_PY_ENABLED")), execute=_on(e.get("AGENT_HARNESS_PY_EXECUTE")), memory=memory,
                   memory_path=e.get("AGENT_HARNESS_PY_MEMORY_PATH") or ":memory:", fastslow=_on(e.get("AGENT_HARNESS_PY_FASTSLOW")),
                   system_one_url=e.get("AGENT_HARNESS_PY_SYSTEMONE_URL") or None, system_one_model=e.get("AGENT_HARNESS_PY_SYSTEMONE_MODEL") or None,
                   system_one_key_env=e.get("AGENT_HARNESS_PY_SYSTEMONE_KEY_ENV") or None,
                   reflection=(e.get("AGENT_HARNESS_PY_REFLECTION") or "on").strip().lower() not in ("0", "off", "false", "no"),
                   reflector_url=e.get("AGENT_HARNESS_PY_REFLECTOR_URL") or None, reflector_model=e.get("AGENT_HARNESS_PY_REFLECTOR_MODEL") or None,
                   reflector_key_env=e.get("AGENT_HARNESS_PY_REFLECTOR_KEY_ENV") or None,
                   strategies_path=e.get("AGENT_HARNESS_PY_STRATEGIES_PATH") or ":memory:", jitrl=_on(e.get("AGENT_HARNESS_PY_JITRL")),
                   jitrl_weights=e.get("AGENT_HARNESS_PY_JITRL_WEIGHTS") or None, jitrl_path=e.get("AGENT_HARNESS_PY_JITRL_PATH") or None)
