"""Exercise native dimension-aware travel on a newly owned Numen QA body only."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'server/world-data'
QA = 'QDTravelProbe'
spec = importlib.util.spec_from_file_location('qa_rcon', ROOT / 'world/botgate-src/tests/rcon_live_smoke.py')
rcon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rcon)


def run():
    if sys.argv[1:] != ['--execute', 'qiandengji']:
        raise SystemExit('Use --execute qiandengji for the isolated D server')
    if (DATA / '.qiandengji-smoke').read_text().strip() != 'qiandengji':
        raise ValueError('Missing isolated marker')
    report = {'project': 'qiandengji', 'ok': False, 'startedAt': datetime.now(timezone.utc).isoformat(), 'checks': [], 'cleanup': {}}
    lock_path = DATA / '.qiandengji-smoke.lock'
    lock = lock_path.open('x', encoding='utf-8')
    lock.write(json.dumps({'task': 'waypoint-travel', 'actor': QA})); lock.flush()
    sock = None
    body_id = None
    owner_id = None
    number = 2
    secret = ''

    def command(text):
        nonlocal number
        number += 1
        return rcon.command(sock, number, text)

    def check(name, ok, **extra):
        if not ok:
            raise AssertionError(name)
        report['checks'].append({'name': name, 'ok': True, **extra})

    def envelope(text, action):
        rows = [line for line in text.splitlines() if line.startswith('QD_WARP_JSON ')]
        if len(rows) != 1:
            raise ValueError('Native travel receipt missing or duplicated')
        result = json.loads(rows[0][len('QD_WARP_JSON '):])
        if result.get('schema') != 1 or result.get('action') != action or result.get('actorUuid') != body_id:
            raise ValueError('Travel receipt actor/schema mismatch')
        return result

    def location():
        return envelope(command(f'qdlocation {body_id}'), 'location')

    def warp(dim, x, y, z):
        return envelope(command(f'qdwarp {body_id} "{dim}" {x} {y} {z}'), 'teleport')

    try:
        secret = (DATA / 'rcon-secret.txt').read_text(encoding='utf-8-sig').strip()
        sock = rcon.connect(); rcon.authenticate(sock, secret)
        before = command('numen_act list')
        check('reserved body absent', QA not in before and QA not in command('list'))
        owner = command('data get entity Goddess UUID')
        parts = re.search(r'\[I;\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]', owner)
        if not parts: raise ValueError('Online test owner unavailable')
        owner_id = str(uuid.UUID(hex=''.join(f'{int(n) & 0xffffffff:08x}' for n in parts.groups())))
        reply = command(f'numen_act summon {owner_id} {QA}')
        found = re.search(rf'summoned={QA}\|uuid=([0-9a-f-]{{36}})', reply)
        if not found: raise ValueError('QA body creation unconfirmed')
        body_id = found[1]
        command(f'gamemode spectator {body_id}')
        start = location()
        check('native UUID location', start['ok'] and start['actor'] == QA, dimension=start['dimension'])
        first = warp('minecraft:overworld', -544, 65, 864)
        check('safe town landing confirmed', first['ok'] and first['code'] == 'teleported', landing={k: first[k] for k in ['dimension', 'x', 'y', 'z']})
        cooldown = warp('minecraft:overworld', -544, 65, 864)
        check('shared native cooldown blocks repeat', not cooldown['ok'] and cooldown['code'] == 'cooldown')
        time.sleep(3.2)
        previous = location()
        void = warp('minecraft:overworld', -544, 300, 864)
        after = location()
        check('unsupported sky point refused without movement', not void['ok'] and void['code'] == 'unsafe_destination' and
              all(previous[k] == after[k] for k in ['dimension', 'x', 'y', 'z']))
        absent = warp('qiandengji:missing_dimension', 0, 64, 0)
        check('missing dimension refused', not absent['ok'] and absent['code'] == 'dimension_unavailable')
        # Normal Nether ceiling has solid bedrock at y=127. No terrain edits or
        # temporary platforms are made; if this world differs, the safe API refuses.
        nether = warp('minecraft:the_nether', 0, 128, 0)
        check('Numen travels to actual nether level safely', nether['ok'] and nether['dimension'] == 'minecraft:the_nether',
              landing={k: nether[k] for k in ['dimension', 'x', 'y', 'z']})
        time.sleep(3.2)
        back = warp('minecraft:overworld', -544, 65, 864)
        check('Numen returns from nether to overworld', back['ok'] and location()['dimension'] == 'minecraft:overworld')
        report['ok'] = True
    except Exception as error:
        report['error'] = str(error).replace(secret, '[redacted]') if secret else str(error)
    finally:
        if sock and body_id:
            try:
                command(f'numen_act dismiss {QA}')
                report['cleanup']['bodyDismissed'] = body_id not in command('numen_act list')
                if not report['cleanup']['bodyDismissed']: report['ok'] = False
            except Exception:
                report['cleanup']['bodyDismissed'] = False
                report['ok'] = False
        if sock: sock.close()
        lock.close(); lock_path.unlink()
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        (ROOT / 'reports/waypoint-travel-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    result = run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['ok'] else 1)
