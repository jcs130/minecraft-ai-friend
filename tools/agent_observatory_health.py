"""Read-only HTTP contract probe for the existing panel's broadcast observatory."""
import json
import urllib.request


def probe():
    checks = {}
    try:
        def get(route):
            with urllib.request.urlopen('http://127.0.0.1:19091' + route, timeout=10) as response:
                return response.read(2 * 1024 * 1024).decode('utf-8')
        page = get('/observatory')
        checks['broadcast-page'] = all(x in page for x in ('id="world-frame"', 'id="tool-stream"', 'id="skill-list"', 'id="case-list"'))
        checks['broadcast-assets'] = 'data-inspect' in get('/observatory.js') and 'mode-sidebar' in get('/observatory.css')
        trace = json.loads(get('/api/survivor-trace'))
        rsi = json.loads(get('/api/rsi-observatory'))
        checks['trace-contract'] = trace.get('schema') == 1 and isinstance(trace.get('turns'), list)
        checks['trace-live-source'] = trace.get('available') is True and trace.get('stale') is False
        checks['rsi-three-layers'] = rsi.get('schema') == 1 and all(k in rsi for k in ('l1', 'l2', 'l3'))
        checks['rsi-sources'] = all(rsi.get('sources', {}).get(k) is True for k in ('learning', 'shared', 'knowledge', 'engineering', 'receipts', 'cases'))
        checks['no-fabricated-improvement'] = rsi.get('l3', {}).get('verifiedImprovement') is None
        return {'ok': all(checks.values()), 'checks': checks, 'modelCalls': 0, 'worldActions': 0}
    except Exception as error:
        return {'ok': False, 'checks': checks, 'errorType': type(error).__name__}


if __name__ == '__main__':
    result = probe()
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
