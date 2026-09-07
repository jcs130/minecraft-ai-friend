"""No model requests: inspect the native backend and scheduler heartbeat."""
import importlib.metadata
import json
import os
from pathlib import Path
import time
import urllib.request


def check():
    state = Path('/state')
    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    assert os.environ.get('QWENPAW_AUTH_ENABLED') == '0'
    config = json.loads((state / 'work/config.json').read_text())
    assert {k for k, v in config['agents']['profiles'].items() if v['enabled']} == {'qd-survivor'}
    heartbeat = json.loads((state / 'survival/heartbeat.json').read_text())
    assert heartbeat['ok'] is True and -5000 < time.time() * 1000 - heartbeat['at'] < 90000
    for endpoint in ('healthz', 'auth/status'):
        with urllib.request.urlopen('http://127.0.0.1:8088/api/' + endpoint, timeout=5) as response:
            value = json.load(response)
        if endpoint == 'healthz':
            assert value.get('status') == 'ok' and 'qd-survivor' in value.get('agents_loaded', [])
        else:
            assert value.get('enabled') is False
    print(json.dumps({'ok': True, 'project': 'qiandengji-survivor', 'status': heartbeat['status']}))


if __name__ == '__main__':
    try:
        check()
    except Exception as exc:
        print(json.dumps({'ok': False, 'errorType': type(exc).__name__}))
        raise SystemExit(1)
