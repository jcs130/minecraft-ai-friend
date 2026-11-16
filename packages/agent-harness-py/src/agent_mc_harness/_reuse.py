"""Locate and import the EXISTING Python bridges in this repository instead of copying them.

* ``numen_controller``  -> paper/integrations/numen-paper/qwenpaw/numen_controller.py (native Numen MCP driver)
* ``agent_mc_autonomy.bridge`` -> packages/agent-mc-autonomy (installed package; MinecraftBridge/outcome/text_content)
* ``agent_memory_sidecar`` -> packages/agent-memory/graphiti-sidecar (GraphitiService, EpisodeIn, load_settings)

The repository root defaults to this file's checkout and can be overridden with AGENT_HARNESS_PY_REPO_ROOT.
"""
from __future__ import annotations

import importlib
import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType


def repo_root() -> Path:
    configured = os.environ.get("AGENT_HARNESS_PY_REPO_ROOT")
    return Path(configured) if configured else Path(__file__).resolve().parents[4]


def _load(name: str, directory: Path) -> ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    if not (directory / (name + ".py")).is_file() and not (directory / name / "__init__.py").is_file():
        raise ImportError(f"{name} not found under {directory}; set AGENT_HARNESS_PY_REPO_ROOT to a minecraft-ai-friend checkout")
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))
    return importlib.import_module(name)


def numen_controller() -> ModuleType:
    """Requires the QwenPaw driver's own dependencies: mcp (1.x or 2.x; the driver carries the compat shim) and httpx."""
    return _load("numen_controller", repo_root() / "paper" / "integrations" / "numen-paper" / "qwenpaw")


def autonomy_bridge() -> ModuleType:
    try:
        return importlib.import_module("agent_mc_autonomy.bridge")
    except ImportError:
        _load("agent_mc_autonomy", repo_root() / "packages" / "agent-mc-autonomy" / "src")
        return importlib.import_module("agent_mc_autonomy.bridge")


def graphiti_sidecar() -> tuple[ModuleType, ModuleType]:
    """(service, config) modules of the existing sidecar; service imports graphiti-core lazily."""
    _load("agent_memory_sidecar", repo_root() / "packages" / "agent-memory" / "graphiti-sidecar")
    return importlib.import_module("agent_memory_sidecar.service"), importlib.import_module("agent_memory_sidecar.config")


def survival(name: str) -> ModuleType:
    """world/survival modules (survivor's fast/slow layer): adaptive_router, system_one, policy_worker, numen_gateway."""
    return _load(name, repo_root() / "world" / "survival")


def autonomy(name: str) -> ModuleType:
    """agent_mc_autonomy submodules: fast (focus rules / typed focus), decision_profiles (routine/complex budgets)."""
    autonomy_bridge()  # makes sure the package is importable (installed or from the checkout)
    return importlib.import_module(f"agent_mc_autonomy.{name}")
