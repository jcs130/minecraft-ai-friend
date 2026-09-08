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


def check_survivor_config(folder):
    """The shared console gets a scoped HTTP driver, never the body secret."""
    from qwenpaw.drivers.storage import load_card
    agent = json.loads((folder / 'agent.json').read_text())
    assert agent['id'] == 'qd-survivor' and agent['name'] == '桐人'
    assert not any(item['enabled'] for item in agent['tools']['builtin_tools'].values())
    assert not any(item['enabled'] for item in agent['acp']['agents'].values())
    assert not agent['fallback_models'] and agent['fallback_policy']['enabled'] is False
    assert agent['heartbeat']['enabled'] is False
    assert agent['running']['llm_max_concurrent'] == 1 and agent['running']['llm_max_qpm'] == 4
    assert agent['running']['max_iters'] == 6 and agent['running']['llm_retry_enabled'] is False
    assert set(agent['mcp']['clients']) == {'numen_survival'}
    client = agent['mcp']['clients']['numen_survival']
    assert client['enabled'] and client['transport'] == 'streamable_http'
    assert client['url'] == 'http://survivor:8089/mcp' and not client.get('command')
    assert client['headers'] == {'Authorization': 'Bearer ${SURVIVOR_MCP_TOKEN}'}
    names = client['tools']
    assert isinstance(names, list) and len(set(names)) == len(names)
    assert {'status', 'look', 'skill_draft', 'skill_test', 'skill_promote', 'remember'} <= set(names)
    assert not json.loads((folder / 'jobs.json').read_text())['jobs']
    cards = [p for p in (folder / 'drivers').glob('**/*.yaml')
             if p.name != '.legacy_mcp_migration_report.yaml']
    assert cards == [folder / 'drivers/mcp/numen_survival.yaml']
    card = load_card(cards[0])
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
    assert {aid for aid, ref in config['agents']['profiles'].items() if ref['enabled']} == GAME_ROLES
    for aid in ('mc-god', 'mc-herald'):
        folder = Path('/state/work/workspaces')/aid
        agent = json.loads((folder/'agent.json').read_text())
        assert_quiet(agent['running'])
        assert not agent['fallback_models'] and agent['fallback_policy']['enabled'] is False
        assert agent['heartbeat']['enabled'] is False
        assert not any(item['enabled'] for item in agent['tools']['builtin_tools'].values())
        assert not any(item['enabled'] for item in agent['acp']['agents'].values())
        assert not agent['mcp']['clients']
        # The 2.2 unified driver registry is separate from the legacy /tools API.
        assert not driver_cards(folder)
        jobs = folder/'jobs.json'
        assert not jobs.exists() or not json.loads(jobs.read_text())['jobs']
    check_survivor_config(Path('/state/work/workspaces/qd-survivor'))
    for aid in WORLD_ROLES:
        validate_workspace(Path('/state/work/workspaces') / aid, aid)
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
    assert GAME_ROLES <= loaded_ids <= GAME_ROLES | disabled_builtins
    PHASE = 'agent-list'
    agents = get('/agents')['agents']
    assert {a['id'] for a in agents if a['enabled']} == GAME_ROLES
    for aid in ['mc-god', 'mc-herald', *WORLD_ROLES]:
        PHASE = 'disabled-tools:' + aid
        items = get('/tools', aid=aid)
        assert items and not any(item['enabled'] for item in items)
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'authEnforced': False,
                      'authMode': 'local-passwordless', 'authEnabled': False, 'anonymousAccess': True,
                      'packageVersion': '2.2.0', 'agents': len(GAME_ROLES), 'enabledTools': 0,
                      'survivorMcp': 'authenticated-streamable-http'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji', 'ok': False, 'phase': PHASE, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
