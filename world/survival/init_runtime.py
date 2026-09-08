"""Offline initialization of one new QwenPaw 2.2 survivor; never starts an agent."""
from __future__ import annotations

import asyncio
import importlib.metadata
import json
from pathlib import Path
import re
import socket

from mcp_server import TOOL_NAMES

STATE = Path('/state')
SOURCE = Path(__file__).resolve().parent
PROJECT = 'qiandengji-survivor'
ROLE = 'qd-survivor'
DRIVER = 'numen_survival'
MODEL_MAX_ITERS = 12
MODEL_QPM = 8


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    path.chmod(0o600)


def tune(running):
    running.max_iters = MODEL_MAX_ITERS
    running.loop.iteration.enabled = True
    running.loop.iteration.max_iterations = MODEL_MAX_ITERS
    running.max_input_length = 16384
    running.llm_retry_enabled = False
    # QwenPaw's schema requires >= 1 even when retry execution is disabled.
    running.llm_max_retries = 1
    running.llm_max_concurrent = 1
    running.llm_max_qpm = MODEL_QPM
    running.llm_acquire_timeout = 30
    running.light_context_config.strategy = 'native'
    running.light_context_config.visual_compact_config.enabled = False
    running.auto_title_config.enabled = False
    memory = running.reme_light_memory_config
    for name in ('memory_search_enabled', 'dream_cron_enabled', 'daily_paper_cron_enabled',
                 'auto_memory_inbox_push_enabled', 'auto_dream_inbox_push_enabled',
                 'daily_paper_inbox_push_enabled', 'inbox_push_enabled'):
        if hasattr(memory, name):
            setattr(memory, name, False)
    memory.auto_memory_interval = 0
    memory.auto_memory_search_config.enabled = False


async def initialize():
    from qwenpaw.config.config import Config, AgentProfileConfig, AgentProfileRef, MCPClientConfig
    from qwenpaw.constant import BUILTIN_QA_AGENT_ID, WORKING_DIR, SECRET_DIR
    from qwenpaw.drivers.adapters.mcp_legacy_config import legacy_mcp_client_to_driver
    from qwenpaw.drivers.contracts import DriverPolicy, PolicyRule, PolicyTarget
    from qwenpaw.drivers.storage import dump_card, card_path
    from qwenpaw.providers.provider import ProviderInfo

    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    assert Path(WORKING_DIR) == STATE / 'work' and Path(SECRET_DIR) == STATE / 'secret'
    assert {name for _, name in socket.if_nameindex()} == {'lo'}, 'Use --network none'
    assert not (STATE / 'work/config.json').exists(), 'Refusing to replace an existing runtime'
    manifest = json.loads((STATE / 'init-manifest.json').read_text(encoding='utf8'))
    assert manifest['project'] == PROJECT
    assert re.fullmatch(r'[A-Za-z0-9_]{1,16}', manifest['bodyName'])
    assert len(manifest['profiles']) == 1 and manifest['profiles'][0]['id'] == ROLE
    selected = manifest['profiles'][0]
    cfg = Config()
    for item in cfg.tools.builtin_tools.values():
        item.enabled = False
    for item in cfg.acp.agents.values():
        item.enabled = False
    cfg.plugins, cfg.skill_paths, cfg.mcp.clients = {}, [], {}
    cfg.security.allow_no_auth_hosts = []
    cfg.security.tool_guard.denied_tools = sorted(cfg.tools.builtin_tools)
    for name in type(cfg.channels).model_fields:
        item = getattr(cfg.channels, name)
        if hasattr(item, 'enabled'):
            item.enabled = name == 'console'
    cfg.agents.profiles = {}
    cfg.agents.active_agent = ROLE
    cfg.agents.agent_order = [ROLE]
    tune(cfg.agents.running)
    for aid in (ROLE, 'default', BUILTIN_QA_AGENT_ID):
        folder = STATE / 'work/workspaces' / aid
        agent = AgentProfileConfig(id=aid, name='桐人' if aid == ROLE else aid + ' (disabled)',
            workspace_dir=str(folder), tools=cfg.tools, acp=cfg.acp, security=cfg.security,
            channels=cfg.channels, heartbeat={'enabled': False}, mcp={'clients': {}},
            active_model=selected['active_model'] if aid == ROLE else None)
        tune(agent.running)
        agent.fallback_models = []
        agent.fallback_policy.enabled = False
        agent.thinking_level = 'off'
        assert not agent.plan.enabled and not agent.coding_mode.enabled
        if aid == ROLE:
            client = MCPClientConfig(name=DRIVER, enabled=True, command='python',
                args=['/survival/mcp_server.py'], cwd=str(folder), tools=list(TOOL_NAMES))
            card, credential = legacy_mcp_client_to_driver(DRIVER, client)
            assert credential is None
            card.policy = DriverPolicy(default_effect='deny', rules=[
                PolicyRule(subject='*', effect='allow', target=PolicyTarget(kind='tool', name=name))
                for name in TOOL_NAMES])
            dump_card(card, card_path(folder / 'drivers', card.name, card.protocol))
            agent.mcp.clients = {DRIVER: client}
            provider = ProviderInfo.model_validate_json((STATE / 'secret/providers' /
                selected['provider_kind'] / (selected['active_model']['provider_id'] + '.json')).read_text())
            assert provider.api_key.startswith('ENC:')
            assert provider.generate_kwargs.get('max_tokens') == 2048
        write(folder / 'agent.json', agent.model_dump(mode='json', exclude_none=True))
        write(folder / 'jobs.json', {'jobs': []})
        if aid == ROLE:
            (folder / 'AGENTS.md').write_text((SOURCE / 'AGENT.md').read_text(encoding='utf8'), encoding='utf8')
            (folder / 'SOUL.md').write_text('你是桐人，冷静、敏锐、重视同伴和实践。你自主探索、规划、核对结果，并从失败中学习。\n', encoding='utf8')
            (folder / 'PROFILE.md').write_text('# 桐人\n\n角色 qd-survivor；身体 ' + manifest['bodyName']
                + '；运行组 qiandengji-survivor。\n', encoding='utf8')
        cfg.agents.profiles[aid] = AgentProfileRef(id=aid, workspace_dir=str(folder), enabled=aid == ROLE)
    write(STATE / 'work/config.json', cfg.model_dump(mode='json', exclude_none=True))
    from verify_runtime import verify
    report = await verify(require_offline=True)
    write(STATE / 'initialization-report.json', report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    try:
        asyncio.run(initialize())
    except Exception as exc:
        print(json.dumps({'project': PROJECT, 'ok': False, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
