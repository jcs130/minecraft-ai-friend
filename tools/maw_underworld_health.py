"""Read-only installed story/skill/market contract; no gameplay or model dispatch."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.request import urlopen
import zipfile
from society_lab import DEFAULT_ROOT, REPO
from society_content import verify


def probe(root: Path = DEFAULT_ROOT) -> dict:
    checks = {}
    report = {'schemaVersion': 1, 'scope': 'installed_underworld_content_and_menu_contract',
              'checks': checks, 'modelRequests': 0, 'worldActions': 0,
              'allGameplayVerified': False, 'actualPhoneTested': False, 'ok': False}
    try:
        server = root/'server'
        bridge = server/'mods/maw_agent_bridge-0.1.0.jar'
        record = json.loads((root/'build/society-bridge/build-record.json').read_bytes())
        checks['compiled-artifact'] = hashlib.sha256(bridge.read_bytes()).hexdigest() == record['sha256']
        checks['owned-life-pack'] = verify(server, 'world-life')['ok']
        with zipfile.ZipFile(bridge) as archive:
            formulas = json.loads(archive.read('maw-system-call-catalog.json'))['formulas']
            life = json.loads(archive.read('maw-life-catalog.json'))
            rpg = json.loads(archive.read('maw-rpg-catalog.json'))
            checks['owned-catalogue-bytes'] = all(archive.read(name) ==
                (REPO/'world/society-bridge-src/src/main/resources'/name).read_bytes()
                for name in ('maw-system-call-catalog.json', 'maw-life-catalog.json', 'maw-native-operations.json'))
            checks['bounded-real-skill-formulas'] = len(formulas) == 10 and all(
                f['skillId'] in rpg['skills'] for f in formulas)
            checks['native-story-providers'] = (life['story']['questProvider'] == 'simplequests'
                and life['story']['economyProvider'] == 'economycraft' and len(life['story']['questIds']) == 12)
            checks['quest-graph'] = len(life['quests']) == 34 and all(
                p in {q['id'] for q in life['quests']} for q in life['quests'] for p in q.get('parents', []))
            checks['compiled-menu-services'] = all('dev/qiandeng/maw/'+n+'.class' in archive.namelist()
                for n in ('SystemCallBridge', 'SystemCallSyntax', 'SocietyLifeBridge', 'RpgMigrationBridge'))
            ops = json.loads(archive.read('maw-native-operations.json'))['operations']
            menus = {o['id']: o['parameters']['properties']['menu']['enum'] for o in ops
                     if o['id'] in ('rpg.open', 'society.open')}
            checks['native-menu-discovery'] = ({'stacia', 'systemcall'} <= set(menus['rpg.open'])
                and {'auction', 'sell', 'transactions'} <= set(menus['society.open']))
        checks['vendor-economy-installed'] = (server/'mods/economycraft-neoforge-1.10.0_1.21.1.jar').is_file()
        health = json.load(urlopen('http://127.0.0.1:28985/healthz', timeout=5))
        checks['existing-owned-watchdog'] = health['healthy'] is True and 0 <= time.time()-health['heartbeatEpoch'] < 20
    except Exception as error:
        report['error'] = str(error)[:300]
    report['ok'] = len(checks) == 10 and all(checks.values())
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    result = probe(parser.parse_args().root)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['ok'] else 1)
