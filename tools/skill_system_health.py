"""Read-only deployed skill UI/CLI evidence. No casts or model requests."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKS = {'default:known-only-no-missing-alias', 'guide:reachable-and-readable',
          'missing-source:disabled-click-keeps-menu', 'native:real-equipped-source',
          'native:menu-click-causes-effect-mana-and-cooldown',
          'cooldown:visible-readonly-no-recast', 'shift:no-virtual-item-transfer'}


def check(root=ROOT):
    root = Path(root).resolve()
    checks = {'artifact_and_sources_current': False, 'catalog_mirrors_current': False,
              'isolated_native_behavior': False, 'production_cli_readback': False}
    try:
        report = json.loads((root/'reports/skill-system-review-smoke.json').read_text('utf8'))
        sources = report['sources']
        required = {'server/mc/mods/botgate.jar', 'world/src/application/player-commands.ts',
                    'world/src/gameplay/commands/player-cli.ts', 'world/src/mc-magic.ts',
                    'config/skill-catalog.json', 'world/botgate-src/build-record.json'}
        def digest(name):
            p = (root/name).resolve()
            if not p.is_relative_to(root) or not p.is_file():
                raise ValueError('invalid_source')
            return hashlib.sha256(p.read_bytes()).hexdigest()
        checks['artifact_and_sources_current'] = (required <= set(sources) and len(sources) < 100
            and all(digest(p) == h for p, h in sources.items()))
        checks['catalog_mirrors_current'] = (digest('config/skill-catalog.json')
            == digest('server/world-data/skill-catalog.json') == digest('server/mcdata/skill-catalog.json'))
        qa = report['isolatedQa']
        checks['isolated_native_behavior'] = (qa.get('ok') is True
            and qa.get('candidateSha256') == digest('server/mc/mods/botgate.jar')
            and CHECKS <= {r.get('name') for r in qa.get('checks', [])})
        live = report['productionReadback']
        checks['production_cli_readback'] = (live.get('ok') is True
            and {'help-irons', 'help-tp', 'skills', 'spells-legacy'} <= set(live.get('checks', [])))
        checks['report_complete'] = report.get('ok') is True
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'modelRequests': 0, 'worldActions': 0,
            'scope': 'Current deployed bytes and recorded isolated GUI/production read-only CLI evidence; not live visual QA or balance improvement.'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result))
    raise SystemExit(0 if result['ok'] else 1)
