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
        configured = (value.get('configLoaded') is True and value.get('modelName') != 'decider-dev'
                      and isinstance(value.get('configSha256'), str) and len(value['configSha256']) == 64)
        return {'ok': value.get('ok') is True and configured, 'model': str(value.get('model', ''))[:200],
                'configurationVerified': configured,
                'configuration': {k: value.get(k) for k in ('modelName', 'revision', 'configSha256', 'temperature',
                    'temperatureOverridden', 'schemaTemperature', 'schemaCache', 'isolatedLevels', 'neutralizeNone')},
                'modelCalls': 0, 'worldActions': 0,
                'scope': 'Local Jev-compatible choice service; not policy quality or WASD mastery.',
                'fallback': 'Existing QwenPaw planner; local failure does not disable autonomy.'}
    except (OSError, ValueError, TypeError):
        return {'ok': False, 'error': 'local_policy_unavailable', 'modelCalls': 0, 'worldActions': 0}
