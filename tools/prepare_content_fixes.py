"""Build narrowly scoped 1.21.1 content fixes from the installed, pinned JARs.

Leaves upstream JARs, terrain and player progress untouched. The resulting
datapack is server-side; also installable in an individual singleplayer save.
"""
from copy import deepcopy
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACK = 'qiandeng_fixes'
SPECS = [
    ('spawn-4.0.7-1.21.1.jar', 'data/spawn/loot_table/archaeology/anthill.json', 'anthill'),
    ('touhou_little_maid_spell-1.21.1-1.8.4-neoforge.jar', 'data/touhou_little_maid_spell/loot_table/entities/shadow_assassin.json', 'assassin'),
    ('DungeonsArise-1.21.1-2.1.68-release.jar', 'data/dungeons_arise/advancement/find_thornborn_towers.json', 'advancement'),
    ('DungeonsArise-1.21.1-2.1.68-release.jar', 'data/dungeons_arise/advancement/find_fishing_hut.json', 'advancement'),
]


def repair(original, kind):
    fixed = deepcopy(original)
    if kind == 'anthill':
        entries = fixed['pools'][0]['entries']
        hits = [i for i, entry in enumerate(entries) if entry.get('name') == 'spawn:roly_poly']
        if len(hits) != 1:
            raise ValueError('Unexpected anthill table; review the upstream change')
        old = entries[hits[0]]
        # Retain the unavailable entry's probability as an empty outcome.
        # All seven supported rewards retain their original weights.
        entries[hits[0]] = {'type': 'minecraft:empty', 'weight': old.get('weight', 1)}
    elif kind == 'assassin':
        levels = fixed['pools'][0]['entries'][0]['functions'][0]['components']['minecraft:enchantments']['levels']
        if levels.pop('farmersdelight:backstabbing') != 3:
            raise ValueError('Unexpected optional enchantment level')
    elif kind == 'advancement':
        if fixed['parent'] != 'dungeons_arise:find_small_prairie_house':
            raise ValueError('Unexpected advancement parent; review upstream')
        fixed['parent'] = 'dungeons_arise:wda_root'
        icon = fixed['display']['icon']
        if 'item' in icon:
            icon['id'] = icon.pop('item')
    else:
        raise ValueError(kind)
    return fixed


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deploy', action='store_true', help='Install only into the D project shadow save; reload separately')
    args = parser.parse_args()
    entries = {'pack.mcmeta': encode({'pack': {'pack_format': 48, 'description': '千灯纪：考古掉落、刺客奖励与探索进度修复（1.21.1）'}})}
    sources = []
    pinned_path = ROOT/'manifests/content-fixes.lock.json'
    pinned = json.loads(pinned_path.read_text(encoding='utf-8')) if pinned_path.exists() else None
    for jar, resource, kind in SPECS:
        path = ROOT/'server/mc/mods'/jar
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if pinned and not any(row['jar'] == jar and row['jar_sha256'] == digest for row in pinned['sources']):
            raise ValueError('Upstream JAR changed; review fixes before rebuilding: ' + jar)
        with zipfile.ZipFile(path) as archive:
            if kind == 'advancement':
                assert 'data/dungeons_arise/advancement/wda_root.json' in archive.namelist()
                assert 'data/dungeons_arise/advancement/find_small_prairie_house.json' not in archive.namelist()
            original = archive.read(resource)
            entries[resource] = encode(repair(json.loads(original), kind))
            sources.append({'jar': jar, 'jar_sha256': digest, 'resource': resource,
                            'resource_sha256': hashlib.sha256(original).hexdigest(), 'repair': kind})
    source_dir = ROOT/'content/datapacks'/PACK
    for name, raw in entries.items():
        target = source_dir/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    output = ROOT/'dist/QiandengJi-content-fixes-1.21.1.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, raw in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2026, 9, 7, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    if args.deploy:
        save = ROOT/'server/mc/shadow'
        if not (save/'level.dat').is_file():
            raise ValueError('The imported project save is missing')
        destination = save/'datapacks'/PACK
        for name, raw in entries.items():
            target = destination/name
            if target.exists() and target.read_bytes() != raw:
                raise ValueError('Refusing to overwrite a modified datapack file: ' + name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
    manifest = {'schema_version': 1, 'minecraft': '1.21.1', 'pack_format': 48, 'sources': sources,
                'files': [{'path': name, 'sha256': hashlib.sha256(raw).hexdigest()} for name, raw in sorted(entries.items())],
                'distribution': output.relative_to(ROOT).as_posix(),
                'distribution_sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
    pinned_path.write_bytes(encode(manifest))
    print(json.dumps({'ok': True, 'files': len(entries), 'deployed': args.deploy,
                      'world_regenerated': False, 'output': str(output)}))


if __name__ == '__main__':
    main()
