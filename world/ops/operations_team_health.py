"""Passwordless local runtime/config health; never calls a model or changes the world."""
import json
import hashlib
import importlib.metadata
import os
from pathlib import Path
import urllib.request
from operations_team_mcp import ROLES, TOOLS, role_tools
from role_learning_profiles import validate_learning_workspace, validate_jobs, validate_guard
from native_role_capabilities import validate_native, NATIVE_TOOLS, NATIVE_SKILLS


def check_passwordless_auth(get):
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    assert get('/auth/status').get('enabled') is False


def main():
    from qwenpaw.drivers.storage import load_card
    from qwenpaw.agents.skill_system.workspace_service import SkillService
    assert importlib.metadata.version('qwenpaw')=='2.2.0'
    guard_verified = validate_guard('/state/work', 'operations')
    skill_map=json.loads(Path('/ops/operations-role-skills.json').read_text())['roles']
    def get(route, role=None):
        headers = {}
        if role: headers['X-Agent-Id'] = role
        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8088/api'+route,headers=headers),timeout=5) as response:
            body = response.read(2*1024*1024+1)
            assert len(body) <= 2*1024*1024
            return json.loads(body)
    check_passwordless_auth(get)
    agents=get('/agents')['agents']
    assert {a['id'] for a in agents if a['enabled']} == set(ROLES)
    cfg=json.loads(Path('/state/work/config.json').read_text())
    assert cfg['agents']['running']['reme_light_memory_config']['dream_cron_enabled'] is False
    def budget(running):
        assert running['llm_retry_enabled'] is False and running['llm_max_concurrent']==1
        assert running['llm_max_qpm']==6 and running['max_iters']==5
        assert running['loop']['iteration']['enabled'] and running['loop']['iteration']['max_iterations']==5
    budget(cfg['agents']['running'])
    for role in ROLES:
        folder=Path('/state/work/workspaces')/role
        profile=json.loads((folder/'agent.json').read_text())
        assert profile['heartbeat']['enabled'] is False
        budget(profile['running'])
        assert profile['fallback_policy']['enabled'] is False and not profile['fallback_models']
        validate_native(profile, role)
        assert not any(a.get('enabled') for a in profile['acp']['agents'].values())
        validate_learning_workspace(folder, role, 'operations')
        mcp=profile['mcp']['clients']
        assert set(mcp)=={'qiandeng_operations', 'qd_learning'}
        item=mcp['qiandeng_operations']
        assert item['enabled'] and item['command']=='python' and item['args']==['/ops/operations_team_mcp.py','--role',role]
        assert set(item['tools'])==set(role_tools(role))
        card=load_card(folder/'drivers/mcp/qiandeng_operations.yaml')
        assert card.enabled and card.endpoint['args']==item['args'] and card.endpoint['command']=='python'
        assert card.policy.default_effect=='deny'
        assert len(card.policy.rules)==len(role_tools(role))
        assert {r.target.name for r in card.policy.rules if r.effect=='allow' and r.target.kind=='tool'}==set(role_tools(role))
        skills=SkillService(folder)
        assert set(skill_map[role]) <= {s.name for s in skills.list_available_skills()}
        for name in skill_map[role]:
            assert (folder/'skills'/name/'SKILL.md').read_bytes()==(Path('/ops/skills')/name/'SKILL.md').read_bytes()
        exposed=get('/tools',role=role)
        assert {item['name'] for item in exposed if item['enabled']} == set(NATIVE_TOOLS)
        from agent_learning import TOOL_NAMES
        assert set(TOOL_NAMES) <= {row.get('name') for row in get('/mcp/tools/qd_learning', role=role) if row.get('enabled') is True}
        assert set(skill_map[role]) | set(NATIVE_SKILLS) <= {row['name'] for row in get('/skills', role=role) if row.get('enabled') is True}
        jobs = get('/cron/jobs', role=role)
        validate_jobs({'jobs': [row.get('spec', row) for row in (jobs if isinstance(jobs, list) else jobs['jobs'])]}, role, 'operations')
    print(json.dumps({'ok':True,'project':'qiandengji-ops','packageVersion':'2.2.0','roles':6,'authEnforced':False,
        'authMode':'local-passwordless','authEnabled':False,'anonymousAccess':True,
        'installedSkillBindings':sum(map(len,skill_map.values())) + len(NATIVE_SKILLS) * len(ROLES), 'rateLimitVerified':True, 'driverPolicyVerified':True,
        'builtinTools':len(NATIVE_TOOLS), 'nativeToolPolicyVerified': True, 'officialSkillBindings':len(NATIVE_SKILLS) * len(ROLES),
        'mcpTools':list(TOOLS),'learningMcpTools':len(TOOL_NAMES),'automaticJobs':6,
        'managedWeeklyJobs':6,'unmanagedAutomaticJobs':0, 'cronBudgetGuardVerified':guard_verified,
        'scope':'Native enabled role skills, managed cron and fixed MCP policy; model/tool execution has separate evidence'}))


if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'ok':False,'project':'qiandengji-ops','errorType':type(exc).__name__}))
        raise SystemExit(1)
