"""Offline validation in the pinned image. Emits no credentials or provider URLs."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace


async def verify():
    from qwenpaw.config.config import load_agent_config
    from qwenpaw.config.utils import load_config
    from qwenpaw.agents.tools import discover_builtin_tool_funcs
    from qwenpaw.app.workspace.local_workspace import QwenPawLocalWorkspace
    from qwenpaw.runtime.tool_registry import ToolRegistry
    from qwenpaw.runtime.builder import AgentBuilder
    from qwenpaw.providers.provider_manager import ProviderManager
    from qwenpaw.app.auth import verify_token
    from qwenpaw.constant import WORKING_DIR, SECRET_DIR

    assert Path(WORKING_DIR) == Path('/state/work') and Path(SECRET_DIR) == Path('/state/secret')
    config = load_config()
    assert {aid for aid, ref in config.agents.profiles.items() if ref.enabled} == {'mc-god', 'mc-herald'}
    assert {'default', 'QwenPaw_QA_Agent_0.2'} <= set(config.agents.profiles)
    assert not config.security.allow_no_auth_hosts
    registry = ToolRegistry()
    registry.register_many(fn._tool_descriptor for fn in discover_builtin_tool_funcs())
    local_ws = QwenPawLocalWorkspace(tool_registry=registry, workdir='/state/validation')
    ctx = SimpleNamespace(workspace=SimpleNamespace(local_workspace=local_ws))
    providers = ProviderManager()
    checks = []
    for aid in ['mc-god', 'mc-herald']:
        agent = load_agent_config(aid)
        assert not agent.mcp.clients
        assert not any(v.enabled for v in agent.acp.agents.values())
        assert not agent.heartbeat.enabled
        assert agent.running.light_context_config.strategy == 'native'
        assert not agent.running.reme_light_memory_config.memory_search_enabled
        assert not agent.coding_mode.enabled
        assert not agent.running.light_context_config.visual_compact_config.enabled
        toolkit = await AgentBuilder().build_toolkit(agent, agent_id=aid, ctx=ctx,
                                                     workspace_dir=agent.workspace_dir)
        count = sum(len(group.tools) for group in toolkit.tool_groups)
        assert count == 0
        provider = providers.get_provider(agent.active_model.provider_id)
        assert provider is not None
        assert agent.active_model.model in {m.id for m in provider.models + provider.extra_models}
        assert not provider.require_api_key or (provider.api_key and not provider.api_key.startswith('ENC:'))
        checks.append({'id': aid, 'toolkitTools': count, 'providerLoaded': True,
                       'selectedModelPresent': True, 'credentialDecryptable': True})
    token = (Path(SECRET_DIR) / 'console-token.txt').read_text().strip()
    assert verify_token(token) == 'qiandengji-console'
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'checks': checks,
                      'consoleTokenVerified': True, 'network': 'none'}))


if __name__ == '__main__':
    try:
        asyncio.run(verify())
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji', 'ok': False, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
