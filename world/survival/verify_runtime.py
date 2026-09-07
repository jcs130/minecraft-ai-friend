"""Verify the survivor's exact config and decryptability without invoking a model."""
from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
import re
import socket

from init_runtime import STATE, SOURCE, PROJECT, ROLE, DRIVER, TOOL_NAMES


def verify_running(running):
    assert running.max_iters == 6 and running.loop.iteration.enabled
    assert running.loop.iteration.max_iterations == 6 and running.max_input_length == 16384
    assert not running.llm_retry_enabled and running.llm_max_retries == 1
    assert running.llm_max_concurrent == 1 and running.llm_max_qpm == 4
    assert not running.auto_title_config.enabled
    assert running.light_context_config.strategy == 'native'
    assert not running.light_context_config.visual_compact_config.enabled
    memory = running.reme_light_memory_config
    assert memory.auto_memory_interval == 0 and not memory.auto_memory_search_config.enabled
    for name in ('memory_search_enabled', 'dream_cron_enabled', 'daily_paper_cron_enabled',
                 'auto_memory_inbox_push_enabled', 'auto_dream_inbox_push_enabled',
                 'daily_paper_inbox_push_enabled'):
        if hasattr(memory, name):
            assert getattr(memory, name) is False
    # 2.2 consumes this deprecated umbrella field while loading config and resets
    # it to None. Its three effective switches above must still all be false.
    assert getattr(memory, 'inbox_push_enabled', None) in (None, False)


async def verify(require_offline=False):
    from qwenpaw.config.config import load_agent_config
    from qwenpaw.config.utils import load_config
    from qwenpaw.constant import BUILTIN_QA_AGENT_ID, WORKING_DIR, SECRET_DIR
    from qwenpaw.drivers.storage import load_card
    from qwenpaw.providers.provider_manager import ProviderManager
    from qwenpaw.agents.tools import discover_builtin_tool_funcs
    from qwenpaw.runtime.tool_registry import ToolRegistry
    from qwenpaw.app.workspace.local_workspace import QwenPawLocalWorkspace

    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    assert Path(WORKING_DIR) == STATE / 'work' and Path(SECRET_DIR) == STATE / 'secret'
    if require_offline:
        assert {name for _, name in socket.if_nameindex()} == {'lo'}, 'Use --network none'
    manifest = json.loads((STATE / 'init-manifest.json').read_text())
    assert manifest['project'] == PROJECT
    assert re.fullmatch(r'[A-Za-z0-9_]{1,16}', manifest['bodyName'])
    cfg = load_config()
    assert set(cfg.agents.profiles) == {ROLE, 'default', BUILTIN_QA_AGENT_ID}
    assert {aid for aid, ref in cfg.agents.profiles.items() if ref.enabled} == {ROLE}
    assert cfg.agents.active_agent == ROLE and not cfg.security.allow_no_auth_hosts
    assert not cfg.mcp.clients and not cfg.plugins and not cfg.skill_paths
    verify_running(cfg.agents.running)
    registry = ToolRegistry()
    registry.register_many(fn._tool_descriptor for fn in discover_builtin_tool_funcs())
    workspace = QwenPawLocalWorkspace(tool_registry=registry, workdir=str(STATE / 'validation'))
    for aid in cfg.agents.profiles:
        agent = load_agent_config(aid)
        folder = Path(agent.workspace_dir)
        assert folder == STATE / 'work/workspaces' / aid
        verify_running(agent.running)
        assert not agent.heartbeat.enabled and not agent.plan.enabled and not agent.coding_mode.enabled
        assert not agent.fallback_models and not agent.fallback_policy.enabled and agent.thinking_level == 'off'
        assert not any(item.enabled for item in agent.tools.builtin_tools.values())
        assert not any(item.enabled for item in agent.acp.agents.values())
        assert not await workspace.list_tools(agent_config=agent, agent_id=aid)
        assert json.loads((folder / 'jobs.json').read_text())['jobs'] == []
        cards = [p for p in (folder / 'drivers').glob('**/*.yaml')
                 if p.name != '.legacy_mcp_migration_report.yaml']
        if aid != ROLE:
            assert not agent.mcp.clients and not cards
            continue
        assert set(agent.mcp.clients) == {DRIVER}
        client = agent.mcp.clients[DRIVER]
        assert client.enabled and client.command == 'python' and client.args == ['/survival/mcp_server.py']
        assert tuple(client.tools) == TOOL_NAMES and client.cwd == str(folder)
        assert len(cards) == 1 and cards[0] == folder / 'drivers/mcp' / (DRIVER + '.yaml')
        card = load_card(cards[0])
        assert card.enabled and card.endpoint['command'] == 'python'
        assert card.endpoint['args'] == ['/survival/mcp_server.py']
        assert card.policy.default_effect == 'deny' and len(card.policy.rules) == len(TOOL_NAMES)
        assert {r.target.name for r in card.policy.rules if r.effect == 'allow'
                and r.subject == '*' and r.target.kind == 'tool'} == set(TOOL_NAMES)
        assert (folder / 'AGENTS.md').read_bytes() == (SOURCE / 'AGENT.md').read_bytes()
        assert not list((folder / 'skills').glob('*/SKILL.md'))
        active = agent.active_model
        assert active.model_dump(mode='json') == manifest['profiles'][0]['active_model']
        provider = ProviderManager().get_provider(active.provider_id)
        assert provider is not None and active.model in {m.id for m in provider.models + provider.extra_models}
        assert provider.api_key and not provider.api_key.startswith('ENC:')
        assert provider.generate_kwargs.get('max_tokens') == 2048
    return {'project': PROJECT, 'ok': True, 'packageVersion': '2.2.0', 'role': ROLE,
            'bodyName': manifest['bodyName'],
            'model': manifest['profiles'][0]['active_model'], 'builtinTools': 0,
            'mcpTools': list(TOOL_NAMES), 'maxIterations': 6, 'maxInputLength': 16384,
            'maxOutputTokens': 2048, 'maxConcurrentModels': 1, 'maxQueriesPerMinute': 4,
            'automaticJobs': 0, 'credentialDecryptable': True, 'modelCalls': 0,
            'network': 'none' if require_offline else 'not-used', 'worldActionsExecuted': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(asyncio.run(verify(require_offline=args.offline)), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'project': PROJECT, 'ok': False, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
