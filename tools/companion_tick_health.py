"""Read exact companion identity twice; no movement, chunk loading or model requests."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from maid_native_tools import NativeRcon, parse_reply


def check():
    checks = {name: False for name in ('deployed_current_artifact', 'exact_binding', 'native_policy_eligible',
        'bounded_region_ticket', 'actual_entity_ticking', 'body_tick_progress')}
    samples = []
    try:
        expected_raw = (ROOT / 'config/companion-ticking.json').read_bytes()
        expected = json.loads(expected_raw)
        installed = json.loads((ROOT / 'server/mc/config/qiandeng-companion-ticking.json').read_text('utf-8-sig'))
        checks['exact_binding'] = installed == expected and installed['enabled'] is True
        record = json.loads((ROOT / 'world/maid-bridge-src/build/build-record.json').read_text('utf8'))
        checks['deployed_current_artifact'] = (record['ok'] is True and all(
            hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in record['sources'].items())
            and hashlib.sha256((ROOT / 'server/mc/mods/qiandeng-maid-bridge-0.1.0.jar').read_bytes()).hexdigest() == record['sha256'])
        rcon = NativeRcon(host='127.0.0.1', port=25577, password_file=ROOT / 'server/world-data/rcon-secret.txt')
        for index in range(2):
            if index: time.sleep(0.75)
            request = {'schema': 1, 'requestId': uuid.uuid4().hex, 'maidUuid': installed['bodyUuid'],
                       'ownerUuid': installed['ownerUuid'], 'operation': 'identity', 'args': {}}
            encoded = base64.urlsafe_b64encode(json.dumps(request, separators=(',', ':')).encode()).decode().rstrip('=')
            response = parse_reply(rcon('qdmaid invoke ' + encoded))
            if (response.get('ok') is not True or response.get('phase') != 'observed'
                or response.get('requestId') != request['requestId']
                or response.get('identity', {}).get('maidUuid') != installed['bodyUuid']
                or response.get('identity', {}).get('ownerUuid') != installed['ownerUuid']
                or not -5000 <= time.time() * 1000 - response.get('observedAt', 0) <= 15000):
                raise ValueError('unverified_native_sample')
            samples.append(response)
        ticks = [s['state']['ticking'] for s in samples]
        checks['native_policy_eligible'] = all(t['configState'] == 'enabled' and t['eligible'] is True for t in ticks)
        checks['bounded_region_ticket'] = all(t['radius'] == 2 and t['timeoutTicks'] == 40 and t['refreshTicks'] == 20 for t in ticks)
        checks['actual_entity_ticking'] = all(t['entityTicking'] is True for t in ticks)
        body_delta = ticks[1]['bodyTickCount'] - ticks[0]['bodyTickCount']
        server_delta = ticks[1]['serverTick'] - ticks[0]['serverTick']
        checks['body_tick_progress'] = (all(type(t[k]) is int for t in ticks for k in ('bodyTickCount', 'serverTick'))
            and 0 < body_delta <= server_delta <= 400)
    except (OSError, ValueError, KeyError, TypeError, ConnectionError):
        pass
    return {'ok': all(checks.values()), 'checks': checks,
        'samples': [{'identity': s.get('identity'), 'ticking': s.get('state', {}).get('ticking'),
                     'observedAt': s.get('observedAt')} for s in samples],
        'modelRequests': 0, 'worldActions': 0, 'followArrivalVerified': False}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
