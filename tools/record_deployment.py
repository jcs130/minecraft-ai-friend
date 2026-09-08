"""Record the actual local server files without runtime credentials or player data."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def row(path):
    if path.is_symlink() or not path.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError('Unexpected deployment path')
    return {'path': path.relative_to(ROOT).as_posix(), 'size': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    mods = [row(path) for path in sorted((ROOT / 'server/mc/mods').glob('*.jar'))]
    repaired = [row(ROOT / 'server/mc/shadow/datapacks/spellbooks/data/spellbooks/loot_table' / (name + '.json'))
                for name in ('mengmeng_attack', 'mengmeng_learned')]
    content_fixes = [row(path) for path in sorted((ROOT / 'server/mc/shadow/datapacks/qiandeng_fixes').rglob('*')) if path.is_file()]
    report = {'recorded_at': datetime.now(timezone.utc).isoformat(), 'project': 'qiandengji',
              'target': {'minecraft': '1.21.1', 'neoforge': '21.1.248', 'java': 21},
              'mod_count': len(mods), 'mods': mods, 'repaired_datapacks': repaired,
              'content_fixes': content_fixes,
              'botgate_build_record': 'world/botgate-src/build-record.json',
              'source_inventory': 'server/snapshot-manifest.json',
              'note': 'Local deployed files after integration; the original snapshot remains a separate historical record.'}
    (ROOT / 'manifests/deployed-server.lock.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'mod_count': len(mods), 'repaired_datapacks': len(repaired)}))


if __name__ == '__main__':
    main()
