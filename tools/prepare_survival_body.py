"""Wake only the pre-existing, UUID-bound Kirito. Never create a new companion."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from numen_gateway import RconClient, NumenGateway, write_json


def inspect():
    import nbtlib
    settings = json.loads((ROOT / 'config/survival-agent.json').read_text(encoding='utf8'))
    registry = ROOT / 'server/mc/shadow/data/numen_companions.dat'
    player = ROOT / 'server/mc/shadow/playerdata' / (settings['bodyUuid'] + '.dat')
    body = nbtlib.load(player)
    entries = nbtlib.load(registry)['data']['companions']
    row = entries[settings['bodyUuid']]
    assert str(row['name']) == settings['bodyName'] and str(row['owner']) == settings['ownerUuid']
    matching = [key for key, item in entries.items()
                if str(item.get('name')) == settings['bodyName'] and str(item.get('owner')) == settings['ownerUuid']]
    assert matching == [settings['bodyUuid']], 'Ambiguous stored companion identity'
    assert int(body.get('DeathTime', 0)) == 0 and float(body['Health']) > 0, 'Not a death-recovery tool'
    assert int(body['playerGameType']) == 0, 'Expected existing survival body'
    result = {'schema': 1, 'project': settings['project'], 'character': '桐人', 'bodyName': settings['bodyName'],
        'bodyUuid': settings['bodyUuid'], 'ownerUuid': settings['ownerUuid'],
        'position': [float(x) for x in body['Pos']], 'dimension': str(body['Dimension']),
        'hp': float(body['Health']), 'hunger': int(body['foodLevel']), 'level': int(body['XpLevel']),
        'inventorySlots': len(body['Inventory']), 'createsNewIdentity': False}
    return settings, registry, player, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', choices=['qiandengji'])
    args = parser.parse_args()
    settings, registry, player, result = inspect()
    rcon = RconClient(host='127.0.0.1', port=25577, secret=ROOT / 'server/world-data/rcon-secret.txt')
    online = rcon.cmd('numen_act list')
    # A live player with this name must be reconciled separately, not summoned twice.
    assert settings['bodyName'] not in online, 'Body name already online; inspect before takeover'
    if args.execute:
        folder = ROOT / 'runtime/survival-body-backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')
        folder.mkdir(parents=True, exist_ok=False)
        shutil.copy2(registry, folder / registry.name)
        shutil.copy2(player, folder / player.name)
        shutil.copy2(ROOT / 'reports/architecture-current.json', folder / 'source-baseline.json')
        write_json(folder / 'identity.json', result)
        # The (owner,name) entry above already exists. No owner substitution is allowed.
        reply = rcon.cmd('numen_act summon ' + settings['ownerUuid'] + ' ' + settings['bodyName'])
        assert settings['bodyUuid'] in reply, 'Wake response identity mismatch; inspect, do not replay'
        stopped = rcon.cmd('numen_act invoke "' + settings['bodyName'] + '" task_stop {}')
        task = json.loads(rcon.cmd('numen_act invoke "' + settings['bodyName'] + '" task_status {}'))
        assert task.get('success') is True and not task.get('data', {}).get('task_id'), 'Old task stop unconfirmed'
        result.update(woken=True, previousTaskStopped=True, backup=str(folder))
        write_json(ROOT / 'reports/survivor-body-binding.json', result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
