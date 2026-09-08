"""Prepare only the current survivor's local voice binding; no synthesis."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from character_speech import actor_id, read, write


def prepare(apply=False):
    root = ROOT / 'server/mc/data/godvoice'
    settings = read(ROOT / 'server/survival-agent-state/survival/settings.json')
    actor = actor_id(settings['bodyUuid'])
    with urllib.request.urlopen('http://127.0.0.1:8100/voices', timeout=5) as response:
        voices = json.load(response)['voices']
    target = root / 'speech-profiles.json'
    value = read(target) if target.exists() else {'schema': 1, 'actors': {}}
    if value.get('schema') != 1 or not isinstance(value.get('actors'), dict):
        raise ValueError('speech_profile_invalid')
    changed = actor not in value['actors']
    if changed:
        value['actors'][actor] = {'enabled': True, 'voiceId': 'cosy_male',
            'version': 'initial-male-v1', 'displayName': '桐人',
            'source': 'Existing local male reference; not an authenticated character voice actor'}
    for row in value['actors'].values():
        if row.get('enabled') and row.get('voiceId') not in voices:
            raise ValueError('configured_local_voice_missing')
    if apply:
        if target.exists() and changed:
            backup = ROOT / 'runtime/character-speech-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup.mkdir(parents=True)
            shutil.copy2(target, backup / target.name)
        if changed:
            write(target, value)
        for folder in ('speech-state', 'speech-requests', 'speech-receipts', 'speech-cache'):
            (root / folder).mkdir(parents=True, exist_ok=True)
    return {'ok': True, 'applied': apply, 'changed': changed, 'profiles': len(value['actors']),
            'voiceId': value['actors'][actor]['voiceId'], 'ttsRequests': 0, 'modelRequests': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(prepare(bool(args.apply)), ensure_ascii=True))
