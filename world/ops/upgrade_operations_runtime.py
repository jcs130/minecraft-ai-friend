"""Offline, version-locked migration of the dedicated operations runtime only.

Run after stopping qwenpaw-ops and backing up its ignored state directory.
Uses QwenPaw's config, DriverCard and SkillService APIs; keeps provider secrets.
"""
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
from operations_team_mcp import ROLES, role_tools
from init_operations_runtime import pause_running
from init_qwenpaw_runtime import write

STATE = Path('/state')


def tune(running):
    pause_running(running)
    running.max_iters = 5
    running.loop.iteration.enabled = True
    running.loop.iteration.max_iterations = 5
    running.max_input_length = 24576
    running.llm_retry_enabled = False
    running.llm_max_concurrent = 1
    running.llm_max_qpm = 6
    running.llm_acquire_timeout = 30


def upgrade():
    from qwenpaw.config.config import Config, AgentProfileConfig, MCPClientConfig, ToolsConfig
    from qwenpaw.drivers.adapters.mcp_legacy_config import legacy_mcp_client_to_driver
    from qwenpaw.drivers.contracts import DriverPolicy, PolicyRule, PolicyTarget
    from qwenpaw.drivers.storage import dump_card, card_path
    from qwenpaw.agents.skill_system.workspace_service import SkillService
    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    manifest = json.loads((STATE/'init-manifest.json').read_text())
    assert manifest['project'] == 'qiandengji-ops'
    cfg = Config.model_validate_json((STATE/'work/config.json').read_text())
    assert {k for k,v in cfg.agents.profiles.items() if v.enabled} == set(ROLES)
    # Rebuild from the new complete builtin set: new release defaults cannot leak in.
    tools = ToolsConfig()
    for item in tools.builtin_tools.values(): item.enabled = False
    cfg.tools = tools
    cfg.security.tool_guard.denied_tools = list(tools.builtin_tools)
    cfg.security.allow_no_auth_hosts = []
    cfg.mcp.clients = {}
    tune(cfg.agents.running)
    skill_map = json.loads(Path('/ops/operations-role-skills.json').read_text())['roles']
    write(STATE/'work/config.json', cfg.model_dump(mode='json', exclude_none=True))
    for role in ROLES:
        folder = STATE/'work/workspaces'/role
        profile = AgentProfileConfig.model_validate_json((folder/'agent.json').read_text())
        profile.tools = tools
        profile.security = cfg.security
        tune(profile.running)
        profile.fallback_models = []
        profile.fallback_policy.enabled = False
        profile.thinking_level = 'off'
        profile.heartbeat.enabled = False
        for item in profile.acp.agents.values(): item.enabled = False
        client = MCPClientConfig(name='qiandeng_operations', enabled=True, command='python',
            args=['/ops/operations_team_mcp.py', '--role', role], cwd=str(folder), tools=list(role_tools(role)))
        card, credential = legacy_mcp_client_to_driver('qiandeng_operations', client)
        assert credential is None
        card.policy = DriverPolicy(default_effect='deny', rules=[PolicyRule(subject='*', effect='allow',
            target=PolicyTarget(kind='tool', name=name)) for name in role_tools(role)])
        dump_card(card, card_path(folder/'drivers', card.name, card.protocol))
        profile.mcp.clients = {'qiandeng_operations': client}
        write(folder/'agent.json', profile.model_dump(mode='json', exclude_none=True))
        service = SkillService(folder)
        wanted = skill_map[role]
        existing = {s.name for s in service.list_all_skills()}
        for name in wanted:
            content = (Path('/ops/skills')/name/'SKILL.md').read_text(encoding='utf8')
            if name in existing:
                old = (folder/'skills'/name/'SKILL.md').read_text(encoding='utf8')
                if old != content: service.save_skill(skill_name=name, content=content)
                service.enable_skill(name)
            else:
                assert service.create_skill(name, content, enable=True, installed_from='qiandengji-repository') == name
        for name in existing - set(wanted): service.disable_skill(name)
        assert {s.name for s in service.list_available_skills()} == set(wanted)
        # Update shared operational instructions without replacing role identities/SOUL.
        for name in ('AGENTS.md', 'TEAM.md'):
            (folder/name).write_text(Path('/ops/operations-team-policy.md').read_text(encoding='utf8'), encoding='utf8')
    report = {'schema': 1, 'project': 'qiandengji-ops', 'ok': True,
        'generatedAt': datetime.now(timezone.utc).isoformat(), 'packageVersion': '2.2.0',
        'mode': 'manual', 'maxConcurrentModels': 1, 'maxQueriesPerMinute': 6,
        'maxIterations': 5, 'automaticRetries': False, 'delegationCooldownSeconds': 1800,
        'maxDelegationsPerDay': 4, 'scheduledJobs': 0, 'heartbeat': False,
        'roleSkills': skill_map, 'communicationBackend': 'qwenpaw-native-background-task',
        'builtinTools': 0, 'runtimeSkillLoader': 'AgentScope Skill', 'worldActionsAllowed': False}
    write(STATE/'upgrade-report.json', report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__': upgrade()
