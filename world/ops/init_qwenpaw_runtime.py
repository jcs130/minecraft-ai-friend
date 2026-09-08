"""Runs inside the pinned QwenPaw image, with clean HOME and --network none."""
from __future__ import annotations

import asyncio
import importlib.metadata
import json
from pathlib import Path
import shutil
import secrets

STATE = Path("/state")


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)


def lock_builtin_profiles(cfg):
    """Predeclare disabled builtins so app startup does not create enabled templates."""
    from qwenpaw.config.config import AgentProfileConfig, AgentProfileRef
    from qwenpaw.constant import BUILTIN_QA_AGENT_ID
    for aid in ('default', BUILTIN_QA_AGENT_ID):
        folder = STATE / 'work' / 'workspaces' / aid
        closed = AgentProfileConfig(id=aid, name=f'{aid} (disabled)', workspace_dir=str(folder),
            tools=cfg.tools, acp=cfg.acp, security=cfg.security, channels=cfg.channels,
            heartbeat={'enabled': False}, mcp={'clients': {}})
        closed.running.light_context_config.strategy = 'native'
        closed.running.reme_light_memory_config.memory_search_enabled = False
        closed.running.reme_light_memory_config.auto_memory_interval = 0
        closed.running.reme_light_memory_config.dream_cron_enabled = False
        closed.running.auto_title_config.enabled = False
        write(folder / 'agent.json', closed.model_dump(mode='json', exclude_none=True))
        cfg.agents.profiles[aid] = AgentProfileRef(id=aid, workspace_dir=str(folder), enabled=False)


async def initialize():
    from qwenpaw.config.config import Config, ToolsConfig, ACPConfig, AgentProfileConfig, AgentProfileRef
    from qwenpaw.agents.tools import discover_builtin_tool_funcs
    from qwenpaw.runtime.tool_registry import ToolRegistry
    from qwenpaw.app.workspace.local_workspace import QwenPawLocalWorkspace
    from qwenpaw.providers.provider import ProviderInfo
    from qwenpaw.governance.tool_registry import DEFAULT_REGISTRY

    version = importlib.metadata.version("qwenpaw")
    if version != "2.1.0":
        raise ValueError("Pinned image package changed; review schema again")
    manifest = json.loads((STATE / "init-manifest.json").read_text())
    assert manifest["project"] == "qiandengji"
    cfg = Config()
    tc = ToolsConfig()
    for item in tc.builtin_tools.values(): item.enabled = False
    acp = ACPConfig()
    for item in acp.agents.values(): item.enabled = False
    cfg.tools, cfg.acp = tc, acp
    cfg.mcp.clients = {}
    cfg.plugins = {}
    cfg.skill_paths = []
    for name in type(cfg.channels).model_fields:
        item = getattr(cfg.channels, name)
        if hasattr(item, "enabled"): item.enabled = name == "console"
    cfg.security.tool_guard.denied_tools = sorted(set(tc.builtin_tools) | set(DEFAULT_REGISTRY.get_all_tool_names()))
    cfg.security.allow_no_auth_hosts = []
    cfg.agents.profiles = {}
    cfg.agents.active_agent = "mc-god"
    cfg.agents.agent_order = [p["id"] for p in manifest["profiles"]]
    registry = ToolRegistry()
    registry.register_many(fn._tool_descriptor for fn in discover_builtin_tool_funcs())
    local_ws = QwenPawLocalWorkspace(tool_registry=registry, workdir=str(STATE / 'validation'))
    report = {"project": "qiandengji", "ok": False, "image": "qwenpaw-mc:2.1.1",
              "packageVersion": version, "networkDuringInit": "none", "profiles": []}
    for selected in manifest["profiles"]:
        aid = selected["id"]
        assert aid in {"mc-god", "mc-herald"}
        folder = STATE / "work" / "workspaces" / aid
        folder.mkdir(parents=True, exist_ok=True)
        agent = AgentProfileConfig(id=aid, name=selected["name"], workspace_dir=str(folder),
            tools=tc, acp=acp, security=cfg.security, channels=cfg.channels,
            heartbeat={"enabled": False}, mcp={"clients": {}}, active_model=selected["active_model"])
        agent.running.max_iters = 4
        agent.running.max_input_length = 32768
        agent.running.light_context_config.strategy = "native"
        agent.running.light_context_config.visual_compact_config.enabled = False
        agent.running.auto_title_config.enabled = False
        memory = agent.running.reme_light_memory_config
        memory.memory_search_enabled = False
        memory.auto_memory_interval = 0
        memory.dream_cron_enabled = False
        memory.daily_paper_cron_enabled = False
        memory.auto_memory_search_config.enabled = False
        memory.auto_memory_inbox_push_enabled = False
        memory.auto_dream_inbox_push_enabled = False
        memory.daily_paper_inbox_push_enabled = False
        # Roundtrip through the actual image schema, then exercise its real config gates.
        saved = agent.model_dump(mode="json", exclude_none=True)
        restored = AgentProfileConfig.model_validate(saved)
        exposed = await local_ws.list_tools(agent_config=restored, agent_id=aid)
        assert not exposed, "Configured built-in tools are unexpectedly exposed"
        assert not restored.mcp.clients and not any(a.enabled for a in restored.acp.agents.values())
        assert restored.running.light_context_config.strategy == "native"
        assert not restored.running.reme_light_memory_config.memory_search_enabled
        assert not restored.coding_mode.enabled and not restored.plan.enabled
        pid = selected["active_model"]["provider_id"]
        provider_path = STATE / "secret" / "providers" / selected["provider_kind"] / f"{pid}.json"
        provider = ProviderInfo.model_validate_json(provider_path.read_text())
        assert not provider.api_key or provider.api_key.startswith("ENC:")
        write(folder / "agent.json", saved)
        for name in ("AGENTS.md", "SOUL.md", "PROFILE.md"):
            shutil.copyfile(Path("/ops/qwenpaw-prompts") / aid / name, folder / name)
        cfg.agents.profiles[aid] = AgentProfileRef(id=aid, workspace_dir=str(folder), enabled=True)
        report["profiles"].append({"id": aid, "provider": pid,
            "model": selected["active_model"]["model"], "localModel": selected["local_model"],
            "exposedBuiltinTools": len(exposed), "mcpClients": 0, "enabledACP": 0,
            "memoryTools": 0, "scrollTools": 0, "copiedSessions": 0})
    lock_builtin_profiles(cfg)
    write(STATE / "work" / "config.json", cfg.model_dump(mode="json", exclude_none=True))
    report['disabledBuiltinProfiles'] = ['default', 'QwenPaw_QA_Agent_0.2']
    from qwenpaw.app.auth import register_user, verify_token
    password = secrets.token_urlsafe(32)
    token = register_user("qiandengji-console", password, expiry_seconds=0)
    assert token and verify_token(token) == "qiandengji-console"
    write(STATE / "secret" / "console-login.json", {"username": "qiandengji-console", "password": password})
    token_path = STATE / "secret" / "console-token.txt"
    token_path.write_text(token + "\n", encoding="ascii")
    token_path.chmod(0o600)
    report["authentication"] = {"type": "Bearer", "verifiedOffline": True, "trustedIPs": []}
    report["ok"] = True
    write(STATE / "initialization-report.json", report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        asyncio.run(initialize())
    except Exception as exc:
        print(json.dumps({"project": "qiandengji", "ok": False, "errorType": type(exc).__name__}))
        raise SystemExit(1)
