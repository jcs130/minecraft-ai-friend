"""Passwordless local runtime/config health; never calls a model or changes the world."""
import json
import hashlib
import importlib.metadata
import os
from pathlib import Path
import urllib.request
from operations_team_mcp import ROLES, TOOLS, role_tools


def check_passwordless_auth(get):
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    assert get('/auth/status').get('enabled') is False


def main():
    from qwenpaw.drivers.storage import load_card
    from qwenpaw.agents.skill_system.workspace_service import SkillService
    assert importlib.metadata.version('qwenpaw')=='2.2.0'
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
        assert not any(a.get('enabled') for a in profile['tools']['builtin_tools'].values())
        assert not any(a.get('enabled') for a in profile['acp']['agents'].values())
        assert json.loads((folder/'jobs.json').read_text())['jobs'] == []
        mcp=profile['mcp']['clients']
        assert set(mcp)=={'qiandeng_operations'}
        item=mcp['qiandeng_operations']
        assert item['enabled'] and item['command']=='python' and item['args']==['/ops/operations_team_mcp.py','--role',role]
        assert set(item['tools'])==set(role_tools(role))
        card=load_card(folder/'drivers/mcp/qiandeng_operations.yaml')
        assert card.enabled and card.endpoint['args']==item['args'] and card.endpoint['command']=='python'
        assert card.policy.default_effect=='deny'
        assert len(card.policy.rules)==len(role_tools(role))
        assert {r.target.name for r in card.policy.rules if r.effect=='allow' and r.target.kind=='tool'}==set(role_tools(role))
        skills=SkillService(folder)
        assert {s.name for s in skills.list_available_skills()}==set(skill_map[role])
        for name in skill_map[role]:
            assert (folder/'skills'/name/'SKILL.md').read_bytes()==(Path('/ops/skills')/name/'SKILL.md').read_bytes()
        exposed=get('/tools',role=role)
        assert not any(item['enabled'] for item in exposed)
    print(json.dumps({'ok':True,'project':'qiandengji-ops','packageVersion':'2.2.0','roles':6,'authEnforced':False,
        'authMode':'local-passwordless','authEnabled':False,'anonymousAccess':True,
        'installedSkillBindings':sum(map(len,skill_map.values())), 'rateLimitVerified':True, 'driverPolicyVerified':True,
        'builtinTools':0,'mcpTools':list(TOOLS),'automaticJobs':0,'scope':'passwordless local runtime and fixed configuration; model/tool execution has separate evidence'}))


if __name__=='__main__':
    try: main()
    except Exception as exc:
        print(json.dumps({'ok':False,'project':'qiandengji-ops','errorType':type(exc).__name__}))
        raise SystemExit(1)
