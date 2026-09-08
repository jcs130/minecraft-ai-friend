"""No model requests: inspect the native backend and scheduler heartbeat."""
import importlib.metadata
import json
import os
from pathlib import Path
import time
import urllib.request
from native_tools import require_ready


def check():
    state = Path('/state')
    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    external = os.environ.get('SURVIVOR_QWEN_MODE', 'external') == 'external'
    if not external:
        config = json.loads((state / 'work/config.json').read_text())
        assert {k for k, v in config['agents']['profiles'].items() if v['enabled']} == {'qd-survivor'}
    else:
        assert (state / 'game-migration.json').is_file()
        with urllib.request.urlopen('http://127.0.0.1:8089/livez', timeout=5) as response:
            assert json.load(response).get('ok') is True
    heartbeat = json.loads((state / 'survival/heartbeat.json').read_text())
    assert heartbeat['ok'] is True and -5000 < time.time() * 1000 - heartbeat['at'] < 90000
    base = os.environ.get('QWENPAW_API_URL', 'http://qwenpaw:8088/api' if external
                          else 'http://127.0.0.1:8088/api').rstrip('/')
    for endpoint in ('healthz', 'auth/status'):
        with urllib.request.urlopen(base + '/' + endpoint, timeout=5) as response:
            value = json.load(response)
        if endpoint == 'healthz':
            assert value.get('status') == 'ok' and 'qd-survivor' in value.get('agents_loaded', [])
        else:
            assert value.get('enabled') is False
    assert require_ready(base), 'native_survivor_tools_unavailable'
    print(json.dumps({'ok': True, 'project': 'qiandengji-survivor', 'status': heartbeat['status']}))


if __name__ == '__main__':
    try:
        check()
    except Exception as exc:
        print(json.dumps({'ok': False, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
