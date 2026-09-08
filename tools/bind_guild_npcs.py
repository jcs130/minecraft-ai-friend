"""Bind six already-existing guild NPC UUIDs. Default: read-only preflight.

No summon, kill, teleport, forceload, inventory or name commands are present.
Execute requires the exact NPC sidecar to be stopped, preserves all profiles,
backs up the old registry and only adds each reviewed tag to its existing UUID.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
sys.path.insert(0, str(ROOT / 'world/survival'))
from guild_requests import atomic_json
from npc_identity import binding, parse_name, parse_position, parse_uuid, typed_uuid_selector, valid_position
from numen_gateway import RconClient

KEYS = {'guild_lan', 'jingshui', 'shilei', 'zhujiu', 'xiaoman', 'hesu'}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def checksum(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_plan(plan, profiles):
    if plan.get('schema') != 1 or plan.get('world') != 'shadow' or plan.get('strategy') != 'bind_existing_only':
        raise ValueError('invalid_binding_plan')
    rows = plan.get('npcs', [])
    if len(rows) != 6 or {r.get('key') for r in rows} != KEYS or len({r.get('uuid') for r in rows}) != 6:
        raise ValueError('exact_six_existing_npcs_required')
    for row in rows:
        matches = [p for p in profiles['villagers'] if p.get('key') == row['key']]
        if len(matches) != 1:
            raise ValueError('ambiguous_profile')
        profile = matches[0]
        typed_uuid_selector(row['uuid'], row['tag'])
        if (profile['display'] != row['display'] or profile['tag'] != row['tag'] or row['tag'] != 'npc_' + row['key']
                or row['entityType'] != 'minecraft:villager' or row['dimension'] != 'minecraft:overworld'
                or not valid_position(row['lastKnownPosition'])
                or abs(row['lastKnownPosition'][0] + 544) > 160 or abs(row['lastKnownPosition'][2] - 864) > 160):
            raise ValueError('profile_or_town_identity_mismatch')
        previous = binding(profile)
        if previous and previous['uuid'] != row['uuid']:
            raise ValueError('refusing_to_replace_bound_identity')


def probe(rcon, row):
    identity = row['uuid']
    native_type = rcon.cmd('execute in minecraft:overworld if entity ' + typed_uuid_selector(identity))
    if not native_type.strip().startswith('Test passed'):
        raise ValueError('reviewed_vanilla_npc_not_loaded_in_overworld:' + row['key'])
    facts = {key: rcon.cmd('data get entity ' + identity + ' ' + key)
             for key in ('UUID', 'Pos', 'CustomName', 'Tags', 'VillagerData', 'Inventory', 'Offers')}
    position = parse_position(facts['Pos'])
    if (parse_uuid(facts['UUID']) != identity or parse_name(facts['CustomName']) != row['display'] or not position
            or abs(position[0] + 544) > 160 or abs(position[2] - 864) > 160):
        raise ValueError('live_identity_or_town_mismatch:' + row['key'])
    return {'key': row['key'], 'uuid': identity, 'position': list(position), 'observedAt': int(time.time() * 1000), 'raw': facts}


def merged_profiles(profiles, rows, facts):
    result = copy.deepcopy(profiles)
    by_key = {r['key']: r for r in rows}
    for profile in result['villagers']:
        row = by_key.get(profile['key'])
        if not row:
            continue
        profile['carrier'] = 'vanilla'
        if not profile.get('entityBinding'):
            seen = facts[profile['key']]
            profile['entityBinding'] = {'uuid': row['uuid'], 'entityType': 'minecraft:villager',
                'dimension': 'minecraft:overworld', 'lastKnownPosition': seen['position'], 'observedAt': seen['observedAt'],
                'preservePosition': True, 'source': 'existing_unique_named_villager'}
    return result


def add_existing_tag(rcon, row):
    raw = rcon.cmd('data get entity ' + row['uuid'] + ' Tags')
    if not re.search(r'"' + re.escape(row['tag']) + r'"', raw):
        rcon.cmd('tag ' + row['uuid'] + ' add ' + row['tag'])
    confirmed = rcon.cmd('execute in minecraft:overworld if entity ' + typed_uuid_selector(row['uuid'], row['tag']))
    if not confirmed.strip().startswith('Test passed'):
        raise ValueError('tag_result_requires_reconciliation:' + row['key'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', choices=['qiandengji'])
    args = parser.parse_args()
    plan = read(ROOT / 'config/guild-npc-bindings.json')
    profile_path = ROOT / 'server/mcdata/village/villagers.json'
    profiles, before_hash = read(profile_path), checksum(profile_path)
    validate_plan(plan, profiles)
    if args.execute:
        state = subprocess.run(['docker', 'inspect', '-f', '{{.State.Status}}', 'qiandengji-npc-1'],
                               capture_output=True, text=True, check=True, timeout=20).stdout.strip()
        if state not in ('exited', 'created'):
            raise ValueError('stop_exact_qiandengji_npc_before_binding')
    rcon = RconClient(host='127.0.0.1', port=25577, secret=ROOT / 'server/world-data/rcon-secret.txt')
    facts = {row['key']: probe(rcon, row) for row in plan['npcs']}
    proposed = merged_profiles(profiles, plan['npcs'], facts)
    report = {'ok': True, 'mode': 'execute' if args.execute else 'read_only', 'world': 'shadow',
              'profileCount': len(profiles['villagers']), 'createsEntities': False, 'movesEntities': False,
              'npcs': [{key: f[key] for key in ('key', 'uuid', 'position', 'observedAt')} for f in facts.values()]}
    if args.execute:
        backups = (ROOT / 'runtime/guild-npc-binding-backups').resolve()
        if not backups.is_relative_to((ROOT / 'runtime').resolve()):
            raise ValueError('backup_path_escape')
        backup = backups / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup.mkdir(parents=True, exist_ok=False)
        for path in (profile_path, ROOT / 'server/mcdata/village/skin-registry.json', ROOT / 'config/guild-npc-bindings.json'):
            shutil.copy2(path, backup / path.name)
        atomic_json(backup / 'live-before.json', facts)
        if checksum(profile_path) != before_hash:
            raise ValueError('profiles_changed_since_preflight')
        for row in plan['npcs']:
            add_existing_tag(rcon, row)
        if checksum(profile_path) != before_hash:
            raise ValueError('profiles_changed_during_binding')
        if proposed != profiles:
            atomic_json(profile_path, proposed)
        report.update(backup=str(backup), profileChanges=proposed != profiles)
        atomic_json(backup / 'result.json', report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
