"""Construct the six-role runtime in the pinned image with no network access."""
import asyncio
import importlib.metadata
import json
from pathlib import Path
import secrets

from operations_team_mcp import ROLES, TOOLS
from init_qwenpaw_runtime import write

STATE = Path('/state')


def pause_running(running):
    running.max_iters = 8
    running.max_input_length = 32768
    running.light_context_config.strategy = 'native'
    running.light_context_config.visual_compact_config.enabled = False
    running.auto_title_config.enabled = False
    memory = running.reme_light_memory_config
    for flag in ('memory_search_enabled', 'dream_cron_enabled', 'daily_paper_cron_enabled',
                 'auto_memory_inbox_push_enabled', 'auto_dream_inbox_push_enabled', 'daily_paper_inbox_push_enabled', 'inbox_push_enabled'):
        if hasattr(memory, flag): setattr(memory, flag, False)
    memory.auto_memory_interval = 0
    memory.auto_memory_search_config.enabled = False


async def initialize():
    from qwenpaw.config.config import Config, AgentProfileConfig, AgentProfileRef, MCPClientConfig
    from qwenpaw.constant import BUILTIN_QA_AGENT_ID
    from qwenpaw.providers.provider import ProviderInfo
    from qwenpaw.app.auth import register_user, verify_token
    from qwenpaw.agents.tools import discover_builtin_tool_funcs
    from qwenpaw.runtime.tool_registry import ToolRegistry
    from qwenpaw.app.workspace.local_workspace import QwenPawLocalWorkspace
    assert importlib.metadata.version('qwenpaw') == '2.1.0'
    manifest = json.loads((STATE / 'init-manifest.json').read_text())
    assert manifest['project'] == 'qiandengji-ops'
    assert {p['id'] for p in manifest['profiles']} == set(ROLES)
    cfg = Config()
    for item in cfg.tools.builtin_tools.values(): item.enabled = False
    for item in cfg.acp.agents.values(): item.enabled = False
    cfg.mcp.clients, cfg.plugins, cfg.skill_paths = {}, {}, []
    for name in type(cfg.channels).model_fields:
        item = getattr(cfg.channels, name)
        if hasattr(item, 'enabled'): item.enabled = name == 'console'
    cfg.security.allow_no_auth_hosts = []
    cfg.security.tool_guard.denied_tools = list(cfg.tools.builtin_tools)
    cfg.agents.profiles = {}
    pause_running(cfg.agents.running)
    cfg.agents.active_agent = 'default'
    cfg.agents.agent_order = list(ROLES)
    registry = ToolRegistry()
    registry.register_many(fn._tool_descriptor for fn in discover_builtin_tool_funcs())
    workspace = QwenPawLocalWorkspace(tool_registry=registry, workdir='/state/validation')
    rows = []
    for selected in manifest['profiles'] + [{'id': BUILTIN_QA_AGENT_ID, 'name': '内置辅助（停用）', 'active_model': None}]:
        aid = selected['id']
        active = aid in ROLES
        folder = STATE / 'work/workspaces' / aid
        profile = AgentProfileConfig(id=aid, name=selected['name'], workspace_dir=str(folder),
            tools=cfg.tools, acp=cfg.acp, channels=cfg.channels, security=cfg.security,
            heartbeat={'enabled': False}, mcp={'clients': {}}, active_model=selected['active_model'])
        pause_running(profile.running)
        assert not profile.plan.enabled and not profile.coding_mode.enabled
        if active:
            provider = ProviderInfo.model_validate_json((STATE / 'secret/providers' / selected['provider_kind'] /
                (selected['active_model']['provider_id'] + '.json')).read_text())
            assert provider.api_key.startswith('ENC:')
        restored = AgentProfileConfig.model_validate(profile.model_dump(mode='json', exclude_none=True))
        assert not await workspace.list_tools(agent_config=restored, agent_id=aid)
        # First persist imported roles disabled; activate only the reviewed MCP surface below.
        write(folder / 'agent.json', restored.model_dump(mode='json', exclude_none=True))
        write(folder / 'jobs.json', {'jobs': []})
        cfg.agents.profiles[aid] = AgentProfileRef(id=aid, workspace_dir=str(folder), enabled=False)
        rows.append((selected, profile))
    write(STATE / 'work/config.json', cfg.model_dump(mode='json', exclude_none=True))
    for selected, profile in rows:
        if selected['id'] not in ROLES: continue
        aid = selected['id']
        profile.mcp.clients = {'qiandeng_operations': MCPClientConfig(name='qiandeng_operations', enabled=True,
            command='python', args=['/ops/operations_team_mcp.py', '--role', aid], tools=list(TOOLS),
            cwd=str(STATE / 'work/workspaces' / aid))}
        restored = AgentProfileConfig.model_validate(profile.model_dump(mode='json', exclude_none=True))
        assert len(restored.mcp.clients) == 1
        write(STATE / 'work/workspaces' / aid / 'agent.json', restored.model_dump(mode='json', exclude_none=True))
        cfg.agents.profiles[aid].enabled = True
    final = Config.model_validate(cfg.model_dump(mode='json', exclude_none=True))
    write(STATE / 'work/config.json', final.model_dump(mode='json', exclude_none=True))
    password = secrets.token_urlsafe(32)
    token = register_user('qiandengji-ops-console', password, expiry_seconds=0)
    assert verify_token(token) == 'qiandengji-ops-console'
    write(STATE / 'secret/console-login.json', {'username': 'qiandengji-ops-console', 'password': password})
    (STATE / 'secret/console-token.txt').write_text(token + '\n', encoding='ascii')
    report = {'project': 'qiandengji-ops', 'ok': True, 'packageVersion': '2.1.0', 'roles': list(ROLES),
        'builtinTools': 0, 'mcpTools': list(TOOLS), 'jobs': 0, 'heartbeat': False, 'internalMemoryTasks': False,
        'initialImportDisabled': True, 'activatedScope': 'observation_and_proposals', 'networkDuringInit': 'none'}
    write(STATE / 'initialization-report.json', report)
    print(json.dumps(report))


if __name__ == '__main__':
    try: asyncio.run(initialize())
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji-ops', 'ok': False, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
