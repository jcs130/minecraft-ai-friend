"""Read live speech protocol and binding readiness without generating speech."""
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def get_json(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise ValueError('speech_probe_response_limit')
    return json.loads(raw)


def check(root=ROOT, clock=time.time, fetch=get_json):
    checks = {key: False for key in ('live_player_protocol', 'voice_worker_fresh',
                                    'body_voice_binding', 'local_voice_available', 'native_speech_tools')}
    try:
        base = root / 'server/mc/data/godvoice'
        heartbeat = json.loads((base / '.speech-health.json').read_text(encoding='utf-8-sig'))
        checks['live_player_protocol'] = (heartbeat.get('schema') == 2 and heartbeat.get('protocol') == 2
            and type(heartbeat.get('updatedAt')) in (int, float)
            and -5 <= clock() - heartbeat['updatedAt'] / 1000 <= 20
            and all(type(heartbeat.get(k)) is int and heartbeat[k] >= 0 for k in ('activeCount', 'queuedCount')))
        watcher = json.loads((base / '.voice-health.json').read_text(encoding='utf-8-sig'))
        checks['voice_worker_fresh'] = -5 <= clock() - watcher.get('updated_at', 0) <= 120
        settings = json.loads((root / 'server/survival-agent-state/survival/settings.json').read_text(encoding='utf-8-sig'))
        profiles = json.loads((base / 'speech-profiles.json').read_text(encoding='utf-8-sig'))
        profile = profiles.get('actors', {}).get(settings.get('bodyUuid'), {})
        checks['body_voice_binding'] = (profiles.get('schema') == 1 and profile.get('enabled') is True
            and isinstance(profile.get('voiceId'), str) and bool(profile.get('version')))
        voices = fetch('http://127.0.0.1:8100/voices')
        checks['local_voice_available'] = profile.get('voiceId') in voices.get('voices', [])
        tools = fetch('http://127.0.0.1:18089/api/mcp/tools/numen_survival', {'X-Agent-Id': 'qd-survivor'})
        checks['native_speech_tools'] = (isinstance(tools, list)
            and {'speak', 'speech_status', 'stop_speaking'} <= {row.get('name') for row in tools if row.get('enabled') is True})
        return {'ok': all(checks.values()), 'checks': checks, 'modelRequests': 0, 'ttsRequests': 0,
                'scope': 'Live server playback protocol, configured voice and native MCP tools; no physical listening test'}
    except (OSError, ValueError, KeyError, TypeError):
        return {'ok': False, 'checks': checks, 'error': 'Character speech readiness unavailable'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
