"""Read-only local policy liveness; no inference, game action or model loading."""
import json
import urllib.request


def check():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:8000/health', timeout=2) as response:
            raw = response.read(4097)
        if len(raw) > 4096:
            raise ValueError('oversized_health')
        value = json.loads(raw)
        return {'ok': value.get('ok') is True, 'model': str(value.get('model', ''))[:100],
                'modelCalls': 0, 'worldActions': 0,
                'scope': 'Local Jev-compatible choice service; not policy quality or WASD mastery.',
                'fallback': 'Existing QwenPaw planner; local failure does not disable autonomy.'}
    except (OSError, ValueError, TypeError):
        return {'ok': False, 'error': 'local_policy_unavailable', 'modelCalls': 0, 'worldActions': 0}
