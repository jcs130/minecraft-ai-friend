"""Read-only authenticated local readiness probe; never submits a model request."""
import json
from pathlib import Path
import urllib.error
import urllib.request

PHASE = 'read-token'

def main():
    global PHASE
    token = Path('/state/secret/console-token.txt').read_text().strip()
    assert token
    base = 'http://127.0.0.1:8088/api'
    def get(path, authenticated=True, aid=None):
        headers = {'Authorization': f'Bearer {token}'} if authenticated else {}
        if aid: headers['X-Agent-Id'] = aid
        with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=6) as res:
            return json.loads(res.read(2 * 1024 * 1024))
    PHASE = 'unauthenticated-request'
    try:
        get('/agents', authenticated=False)
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
    else:
        raise RuntimeError('Isolated console did not enforce authentication')
    PHASE = 'agent-list'
    agents = get('/agents')['agents']
    assert {a['id'] for a in agents if a['enabled']} == {'mc-god', 'mc-herald'}
    for aid in ['mc-god', 'mc-herald']:
        PHASE = 'disabled-tools:' + aid
        items = get('/tools', aid=aid)
        assert items and not any(item['enabled'] for item in items)
    print(json.dumps({'project': 'qiandengji', 'ok': True, 'authEnforced': True,
                      'agents': 2, 'enabledTools': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'project': 'qiandengji', 'ok': False, 'phase': PHASE, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
