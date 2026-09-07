"""Read-only passwordless local readiness probe; never submits a model request."""
import json
import importlib.metadata
import os
from pathlib import Path
import urllib.request

PHASE = 'auth-mode'


def check_passwordless_auth(get):
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    assert get('/auth/status').get('enabled') is False


def check_runtime_config():
    from upgrade_qwenpaw_runtime import assert_quiet, driver_cards
    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    config = json.loads(Path('/state/work/config.json').read_text())
    assert_quiet(config['agents']['running'])
    assert {aid for aid, ref in config['agents']['profiles'].items() if ref['enabled']} == {'mc-god', 'mc-herald'}
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
    assert {'mc-god', 'mc-herald'} <= loaded_ids <= {'mc-god', 'mc-herald'} | disabled_builtins
    PHASE = 'agent-list'
    agents = get('/agents')['agents']
    assert {a['id'] for a in agents if a['enabled']} == {'mc-god', 'mc-herald'}
    for aid in ['mc-god', 'mc-herald']:
        PHASE = 'disabled-tools:' + aid
        items = get('/tools', aid=aid)
        assert items and not any(item['enabled'] for item in items)
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'authEnforced': False,
                      'authMode': 'local-passwordless', 'authEnabled': False, 'anonymousAccess': True,
                      'packageVersion': '2.2.0', 'agents': 2, 'enabledTools': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji', 'ok': False, 'phase': PHASE, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
