"""Exercise the shipped Python CLI against one newly created, isolated Numen body."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'server/world-data'
QA = 'QDCliProbe'
sys.path.insert(0, str(ROOT / 'world/sidecar/guard'))
from skill_cli_client import request_skill

spec = importlib.util.spec_from_file_location('verified_rcon', ROOT / 'world/botgate-src/tests/rcon_live_smoke.py')
rcon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rcon)

def run():
    if (DATA / '.qiandengji-smoke').read_text().strip() != 'qiandengji':
        raise ValueError('Independent runtime marker missing')
    report = {'ok': False, 'actor': QA, 'startedAt': datetime.now(timezone.utc).isoformat(), 'checks': [], 'cleanup': {}}
    sock = None
    body_uuid = None
    owner_uuid = None
    request_no = 2
    lock_path = DATA / '.qiandengji-smoke.lock'
    lock = lock_path.open('x', encoding='utf-8')
    lock.write(json.dumps({'task': 'skill-cli', 'actor': QA})); lock.flush()
    def command(value):
        nonlocal request_no
        request_no += 1
        return rcon.command(sock, request_no, value)
    def check(name, condition, **extra):
        if not condition: raise AssertionError(name)
        report['checks'].append({'name': name, 'ok': True, **extra})
    def cli(value):
        return request_skill(DATA, QA, value, 20)
    try:
        secret = (DATA / 'rcon-secret.txt').read_text(encoding='utf-8-sig').strip()
        sock = rcon.connect(); rcon.authenticate(sock, secret)
        registry = command('numen_act list')
        check('reserved QA absent', re.match(r'^count=\d+', registry.strip()) and QA not in registry)
        owner = command('data get entity Goddess UUID')
        match = re.search(r'\[I;\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]', owner)
        if not match: raise ValueError('Online world companion UUID unavailable')
        raw = ''.join(f'{int(x) & 0xffffffff:08x}' for x in match.groups())
        owner_uuid = f'{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}'
        created = command(f'numen_act summon {owner_uuid} {QA}')
        match = re.search(rf'summoned={QA}\|uuid=([0-9a-f-]{{36}})', created)
        if not match: raise ValueError('Fresh QA creation not confirmed')
        body_uuid = match[1]
        command(f'gamemode spectator {QA}')
        command(f'experience set {QA} 1 levels')
        time.sleep(1)
        probe = subprocess.run([sys.executable, str(ROOT / 'tools/skill_cli.py'), '--actor', QA, 'status'],
                               cwd=ROOT, capture_output=True, encoding='utf-8', timeout=30)
        status = json.loads(probe.stdout)
        check('shipped Python CLI correlated status', probe.returncode == 0 and status.get('ok') and status.get('actor') == QA and bool(status.get('requestId')))
        typo = cli('please cast feather_fall')
        check('unknown command rejected', not typo['ok'] and typo['code'] == 'invalid_command')
        passive = cli('cast night_eye')
        check('passive cannot claim cast', not passive['ok'] and passive['code'] == 'passive')
        before = cli('status')
        cast = cli('cast feather_fall')
        check('legacy cast real success', cast.get('ok') and cast.get('code') == 'ok' and cast.get('skillId') == 'feather_fall', receipt=cast)
        check('real game effect', 'minecraft:slow_falling' in command(f'data get entity {body_uuid} active_effects'))
        check('normal legacy mana charged once', 6 <= before['mana'] - cast['manaLeft'] <= 8)
        replay = request_skill(DATA, QA, 'cast feather_fall', 20, cast['requestId'])
        check('same request ID returns same immutable receipt', replay == cast)
        cd = cli('cast feather_fall')
        check('cooldown denial is structured failure', not cd['ok'] and cd['code'] == 'cooldown', code=cd['code'])
        invalid = cli('cast feather_fall distance=2')
        check('undeclared parameter is rejected', not invalid['ok'] and invalid['code'] == 'invalid_params')
        assigned = cli('skillbar set 8 feather_fall')
        check('slot eight retained', assigned['ok'] and any(s['slot'] == 8 and s['id'] == 'feather_fall' for s in assigned['skillbar']))
        time.sleep(7)
        by_slot = cli('cast 8')
        check('slot eight casts same effect', by_slot['ok'] and by_slot.get('slot') == 8 and by_slot['skillId'] == 'feather_fall')
        report['ok'] = True
    except Exception as exc:
        # Deliberately omit command payloads and credentials from failures.
        report['error'] = type(exc).__name__ + ': ' + str(exc)[:220]
    finally:
        try:
            if body_uuid:
                row = next((x for x in command('numen_act list').splitlines() if x.startswith(QA + '|')), '')
                if f'uuid={body_uuid}' not in row or f'owner={owner_uuid}' not in row:
                    raise ValueError('Refusing cleanup: QA identity mismatch')
                if f'dismissed={QA}' not in command(f'numen_act dismiss {QA}'):
                    raise ValueError('QA dismissal not confirmed')
                report['cleanup']['bodyDismissed'] = QA not in command('numen_act list')
            if sock: sock.close()
        except Exception as exc:
            report['ok'] = False; report['cleanup']['error'] = str(exc)[:180]
        lock.close(); lock_path.unlink()
        report['cleanup']['lockReleased'] = True
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        (ROOT / 'reports/skill-cli-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    result = run()
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
