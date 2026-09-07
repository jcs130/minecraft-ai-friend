"""Record actual NeoForge join/SVC evidence and the installed voice pack hashes."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    path = ROOT / 'client/logs/latest.log'
    lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
    patterns = {
        'game_join': 'Connecting to 127.0.0.1, 25567',
        'in_world': 'Total time to load game and open world was',
        'voice_target': "Connecting to voice chat server: '127.0.0.1:24455'",
        'voice_authentication': 'Server acknowledged authentication',
        'voice_connection': 'Server acknowledged connection check',
    }
    checks = {}
    for key, pattern in patterns.items():
        matches = [(i + 1, line) for i, line in enumerate(lines) if pattern in line]
        checks[key] = {'ok': bool(matches)}
        if matches:
            checks[key].update(line=matches[-1][0], evidence=matches[-1][1])
    lock = json.loads((ROOT / 'manifests/voice-packs.lock.json').read_text(encoding='utf-8'))
    checks['voice_packs'] = {'ok': all(hashlib.sha256((ROOT / 'client' / r['path']).read_bytes()).hexdigest() == r['sha256'] for r in lock['files']), 'count': len(lock['files'])}
    downloaded = []
    for item in lock['files']:
        cache = ROOT / 'client/config/touhou_little_maid/file' / Path(item['path']).name
        downloaded.append(cache.is_file() and hashlib.sha256(cache.read_bytes()).hexdigest() == item['sha256'])
    checks['downloaded_voice_packs'] = {'ok': all(downloaded), 'count': len(downloaded)}
    checks['resource_download'] = {'ok': not any('Failed to download pack from' in line for line in lines)}
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'project': 'qiandengji',
              'ok': all(c['ok'] for c in checks.values()), 'checks': checks,
              'log': str(path), 'microphone_input_verified': False, 'audible_playback_verified': False,
              'scope': 'Actual modded client join, UDP voice authentication, installed voice packs and downloaded cache hashes'}
    (ROOT / 'reports/client-runtime.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'checks': {k: v['ok'] for k, v in checks.items()}}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
