"""Read-only passwordless local readiness probe; never submits a model request."""
import json
import importlib.metadata
import os
from pathlib import Path
import urllib.request
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))

PHASE = 'auth-mode'
from world_agent_profiles import GAME_ROLES, WORLD_ROLES, validate_workspace
from role_learning_profiles import validate_learning_workspace, roles, maid_roles, validate_guard, SURVIVOR_QPM
from native_role_capabilities import validate_native, NATIVE_TOOLS, NATIVE_SKILLS

MAID_TOOLS = {'identity', 'context', 'task_catalog', 'sit', 'follow', 'schedule', 'work'}


def check_maid_card(card, clients, authorization):
    """The unified DriverCard is authoritative; legacy MCP may be absent."""
    assert 'qd_learning' in clients and set(clients) <= {'maid_native', 'qd_learning'}
    assert card.name == 'maid_native' and card.protocol == 'mcp' and card.enabled is True
    assert set(card.endpoint) == {'transport', 'url', 'headers'}
    assert card.endpoint['transport'] == 'streamable_http' and card.endpoint['url'] == 'http://npc:8091/mcp'
    assert card.endpoint['headers'] == {'Authorization': {
        'source': 'credential', 'credential': 'static', 'field': 'authorization'}}
    assert set(card.credentials) == {'static'}
    assert card.credentials['static'].kind == 'static' and card.credentials['static'].ref == 'mcp/maid_native'
    assert isinstance(authorization, str) and authorization.startswith('Bearer ')
    token = authorization.removeprefix('Bearer ')
    assert 32 <= len(token) <= 256 and not any(c.isspace() for c in token)
    names = card.config.get('tools')
    assert isinstance(names, list) and len(names) == len(MAID_TOOLS) and set(names) == MAID_TOOLS
    assert card.policy.default_effect == 'deny' and len(card.policy.rules) == len(MAID_TOOLS)
    found = set()
    for rule in card.policy.rules:
        assert rule.subject == '*' and rule.effect == 'allow' and rule.target.kind == 'tool'
        assert rule.target.name in MAID_TOOLS and rule.target.name not in found and rule.condition is None
        principal = rule.principal
        assert principal is not None and principal.source_type == 'channel' and principal.source_value == 'console'
        assert principal.subject_type == 'all' and principal.subject_value == ''
        found.add(rule.target.name)
    if 'maid_native' in clients:
        client = clients['maid_native']
        assert client['enabled'] is True and client['transport'] == card.endpoint['transport']
        assert client['url'] == card.endpoint['url'] and not client.get('command') and not client.get('args')
        assert not client.get('cwd') and not client.get('env')
        assert client.get('headers') == {'Authorization': authorization}
        assert isinstance(client.get('tools'), list) and len(client['tools']) == len(MAID_TOOLS)
        assert set(client['tools']) == MAID_TOOLS


def check_maid_api(get, role):
    """Read native API inventory, effective console policy and actual tools."""
    inventory = get('/mcp', aid=role)
    assert isinstance(inventory, list) and len(inventory) == 2
    assert {row.get('key') for row in inventory} == {'maid_native', 'qd_learning'}
    client = get('/mcp/maid_native', aid=role)
    assert client['enabled'] is True and client['transport'] == 'streamable_http'
    assert client['url'] == 'http://npc:8091/mcp' and not client.get('command') and not client.get('args')
    assert not client.get('cwd') and not client.get('env')
    assert isinstance(client.get('tools'), list) and len(client['tools']) == len(MAID_TOOLS)
    assert set(client['tools']) == MAID_TOOLS
    policy = get('/mcp/policy/maid_native', aid=role)
    assert policy.get('default_effect') == 'deny' and policy.get('client_overrides') == []
    assert policy.get('tool_defaults') == [] and policy.get('unmanaged_rules_count') == 0
    overrides = policy.get('tool_overrides')
    assert isinstance(overrides, list) and len(overrides) == len(MAID_TOOLS)
    assert {row.get('tool_name') for row in overrides} == MAID_TOOLS
    for row in overrides:
        assert row == {'source_type': 'channel', 'source_value': 'console', 'subject_type': 'all',
                       'subject_value': '', 'effect': 'allow', 'tool_name': row['tool_name']}
    tools = get('/mcp/tools/maid_native', aid=role)
    assert isinstance(tools, list) and len(tools) == len(MAID_TOOLS)
    assert MAID_TOOLS == {item.get('name') for item in tools if item.get('enabled') is True}


def check_maid_config(folder, role):
    from upgrade_qwenpaw_runtime import assert_quiet, driver_cards
    from qwenpaw.drivers.storage import load_card
    from qwenpaw.drivers.credentials import AsyncCredentialStore
    agent = json.loads((folder / 'agent.json').read_text())
    assert agent['id'] == role and role in maid_roles()
    assert agent['workspace_dir'] == '/state/work/workspaces/' + role
    assert_quiet(agent['running'])
    assert agent['running']['max_iters'] == agent['running']['loop']['iteration']['max_iterations'] == 4
    assert agent['running']['llm_max_qpm'] == 4 and agent['running']['llm_max_concurrent'] == 1
    assert not agent['fallback_models'] and agent['fallback_policy']['enabled'] is False
    assert agent['heartbeat']['enabled'] is False
    validate_native(agent, role)
    assert not any(row['enabled'] for row in agent['acp']['agents'].values())
    assert set(driver_cards(folder)) == {folder / 'drivers/mcp/maid_native.yaml', folder / 'drivers/mcp/qd_learning.yaml'}
    card = load_card(folder / 'drivers/mcp/maid_native.yaml')
    credential = AsyncCredentialStore(folder / 'credentials.yaml').get_sync('mcp/maid_native')
    assert credential.kind == 'static' and set(credential.secrets) == {'authorization'} and not credential.public
    check_maid_card(card, agent['mcp']['clients'], credential.secrets['authorization'])
    validate_learning_workspace(folder, role, 'game')


def check_survivor_config(folder):
    """The shared console gets a scoped HTTP driver, never the body secret."""
    from qwenpaw.drivers.storage import load_card
    agent = json.loads((folder / 'agent.json').read_text())
    assert agent['id'] == 'qd-survivor' and agent['name'] == '桐人'
    validate_native(agent, 'qd-survivor')
    assert not any(item['enabled'] for item in agent['acp']['agents'].values())
    assert not agent['fallback_models'] and agent['fallback_policy']['enabled'] is False
    assert agent['heartbeat']['enabled'] is False
    assert agent['running']['llm_max_concurrent'] == 1 and agent['running']['llm_max_qpm'] == SURVIVOR_QPM
    assert agent['running']['max_iters'] == 6 and agent['running']['llm_retry_enabled'] is False
    assert set(agent['mcp']['clients']) == {'numen_survival', 'qd_learning'}
    client = agent['mcp']['clients']['numen_survival']
    assert client['enabled'] and client['transport'] == 'streamable_http'
    assert client['url'] == 'http://survivor:8089/mcp' and not client.get('command')
    assert client['headers'] == {'Authorization': 'Bearer ${SURVIVOR_MCP_TOKEN}'}
    names = client['tools']
    assert isinstance(names, list) and len(set(names)) == len(names)
    assert {'status', 'look', 'skill_draft', 'skill_test', 'skill_promote', 'remember'} <= set(names)
    validate_learning_workspace(folder, 'qd-survivor', 'game')
    cards = [p for p in (folder / 'drivers').glob('**/*.yaml')
             if p.name != '.legacy_mcp_migration_report.yaml']
    assert set(cards) == {folder / 'drivers/mcp/numen_survival.yaml', folder / 'drivers/mcp/qd_learning.yaml'}
    card = load_card(folder / 'drivers/mcp/numen_survival.yaml')
    assert card.enabled and card.endpoint['transport'] == 'streamable_http'
    assert card.endpoint['url'] == client['url']
    binding = card.endpoint['headers']['Authorization']
    assert binding['source'] == 'credential' and binding['format'] == 'Bearer {value}'
    assert card.credentials[binding['credential']].ref == 'env:SURVIVOR_MCP_TOKEN'
    assert card.policy.default_effect == 'deny' and len(card.policy.rules) == len(names)
    assert {r.target.name for r in card.policy.rules if r.effect == 'allow' and r.subject == '*'
            and r.target.kind == 'tool'} == set(names)
    # Docker healthcheck is a new process and does not inherit the entrypoint's
    # in-memory environment. Validate the mounted source; native MCP smoke checks
    # separately prove the running Qwen process resolves its env credential.
    token_path = Path(os.environ.get('SURVIVOR_MCP_TOKEN_FILE', '/run/secrets/survivor-mcp'))
    token = token_path.read_text(encoding='ascii').strip()
    assert 32 <= len(token) <= 256 and not any(char.isspace() for char in token)


def check_passwordless_auth(get):
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    assert get('/auth/status').get('enabled') is False


def check_runtime_config():
    from upgrade_qwenpaw_runtime import assert_quiet, driver_cards
    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    config = json.loads(Path('/state/work/config.json').read_text())
    assert_quiet(config['agents']['running'])
    assert {aid for aid, ref in config['agents']['profiles'].items() if ref['enabled']} == set(roles('game'))
    for aid in ('mc-god', 'mc-herald'):
        folder = Path('/state/work/workspaces')/aid
        agent = json.loads((folder/'agent.json').read_text())
        assert_quiet(agent['running'])
        assert not agent['fallback_models'] and agent['fallback_policy']['enabled'] is False
        assert agent['heartbeat']['enabled'] is False
        validate_native(agent, aid)
        assert not any(item['enabled'] for item in agent['acp']['agents'].values())
        assert set(agent['mcp']['clients']) == {'qd_learning'}
        # The 2.2 unified driver registry is separate from the legacy /tools API.
        assert driver_cards(folder) == [folder / 'drivers/mcp/qd_learning.yaml']
        validate_learning_workspace(folder, aid, 'game')
    check_survivor_config(Path('/state/work/workspaces/qd-survivor'))
    for aid in WORLD_ROLES:
        validate_workspace(Path('/state/work/workspaces') / aid, aid)
    for aid in maid_roles():
        check_maid_config(Path('/state/work/workspaces') / aid, aid)
    return {aid for aid in ('default', 'QwenPaw_QA_Agent_0.2')
            if config['agents']['profiles'].get(aid, {}).get('enabled') is False}


def main():
    global PHASE
    base = 'http://127.0.0.1:8088/api'
    def get(path, aid=None):
        headers = {}
        if aid: headers['X-Agent-Id'] = aid
        with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=6) as res:
            body = res.read(2 * 1024 * 1024 + 1)
            assert len(body) <= 2 * 1024 * 1024
            return json.loads(body)
    PHASE = 'runtime-config'
    disabled_builtins = check_runtime_config()
    expected_roles = set(roles('game'))
    PHASE = 'native-cron-budget-guard'
    guard_verified = validate_guard('/state/work', 'game')
    PHASE = 'auth-mode'
    check_passwordless_auth(get)
    PHASE = 'api-version'
    assert get('/version').get('version') == '2.2.0'
    PHASE = 'readiness'
    ready = get('/healthz')
    assert ready.get('status') == 'ok'
    loaded = ready.get('agents_loaded')
    assert isinstance(loaded, list) and all(isinstance(aid, str) for aid in loaded)
    loaded_ids = set(loaded)
    assert len(loaded) == len(loaded_ids)
    # Console reads may lazily load disabled builtin workspaces. Loading is not
    # activation: only explicitly disabled builtins may accompany the game roles.
    assert expected_roles <= loaded_ids <= expected_roles | disabled_builtins
    PHASE = 'agent-list'
    agents = get('/agents')['agents']
    assert {a['id'] for a in agents if a['enabled']} == expected_roles
    for aid in ['mc-god', 'mc-herald', *WORLD_ROLES, *maid_roles()]:
        PHASE = 'native-tools:' + aid
        items = get('/tools', aid=aid)
        assert {item['name'] for item in items if item['enabled']} == set(NATIVE_TOOLS)
    from agent_learning import TOOL_NAMES
    from role_learning_profiles import role_skills, validate_jobs
    bindings = 0
    for aid in expected_roles:
        PHASE = 'native-learning:' + aid
        assert set(TOOL_NAMES) <= {item.get('name') for item in get('/mcp/tools/qd_learning', aid=aid) if item.get('enabled') is True}
        enabled_skills = {item['name'] for item in get('/skills', aid=aid) if item.get('enabled') is True}
        assert set(role_skills(aid, 'game')) | set(NATIVE_SKILLS) <= enabled_skills
        bindings += len(enabled_skills)
        if aid in maid_roles():
            check_maid_api(get, aid)
        jobs = get('/cron/jobs', aid=aid)
        validate_jobs({'jobs': [item.get('spec', item) for item in (jobs if isinstance(jobs, list) else jobs['jobs'])]}, aid, 'game')
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'authEnforced': False,
                      'authMode': 'local-passwordless', 'authEnabled': False, 'anonymousAccess': True,
                      'packageVersion': '2.2.0', 'agents': len(expected_roles), 'enabledTools': len(NATIVE_TOOLS),
                      'nativeToolPolicyVerified': True, 'officialSkillBindings': len(NATIVE_SKILLS) * len(expected_roles),
                      'survivorMcp': 'authenticated-streamable-http', 'learningMcpTools': len(TOOL_NAMES),
                      'installedSkillBindings': bindings, 'baseAgents': 6, 'maidAgents': len(maid_roles()),
                      'cronBudgetGuardVerified': guard_verified,
                      'managedWeeklyJobs': len(expected_roles), 'unmanagedAutomaticJobs': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji', 'ok': False, 'phase': PHASE, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
