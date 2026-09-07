"""Read-only passwordless local readiness probe; never submits a model request."""
import json
import os
import urllib.request

PHASE = 'auth-mode'


def check_passwordless_auth(get):
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    assert get('/auth/status').get('enabled') is False

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
    PHASE = 'auth-mode'
    check_passwordless_auth(get)
    PHASE = 'agent-list'
    agents = get('/agents')['agents']
    assert {a['id'] for a in agents if a['enabled']} == {'mc-god', 'mc-herald'}
    for aid in ['mc-god', 'mc-herald']:
        PHASE = 'disabled-tools:' + aid
        items = get('/tools', aid=aid)
        assert items and not any(item['enabled'] for item in items)
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'authEnforced': False,
                      'authMode': 'local-passwordless', 'authEnabled': False, 'anonymousAccess': True,
                      'agents': 2, 'enabledTools': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji', 'ok': False, 'phase': PHASE, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
