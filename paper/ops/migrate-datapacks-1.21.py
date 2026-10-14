"""Prepare private 1.21.1 copies of the installed 1.20.6 datapacks.

Never edits the source ZIPs or a world. Keeps resource IDs and NBT bytes, merges
the active 1.20.6 overlays, and migrates the documented directory/loot schema.
Already compatible packs are copied unchanged. Native loading must still be
tested; a changed pack.mcmeta alone does not establish compatibility.
"""
from __future__ import annotations
import argparse, copy, hashlib, json, math, zipfile
from pathlib import Path, PurePosixPath

ELEMENTS = {name: name[:-1] for name in (
    'structures', 'advancements', 'recipes', 'loot_tables', 'predicates', 'item_modifiers', 'functions')}
TAGS = {'functions': 'function', 'items': 'item', 'blocks': 'block',
        'entity_types': 'entity_type', 'fluids': 'fluid', 'game_events': 'game_event'}

def includes(spec, version: int) -> bool:
    if isinstance(spec, int): return spec == version
    if isinstance(spec, list) and len(spec) == 2: return spec[0] <= version <= spec[1]
    if isinstance(spec, dict): return spec['min_inclusive'] <= version <= spec['max_inclusive']
    raise ValueError('Unsupported pack format range')

def renamed(path: str) -> str:
    parts = path.split('/')
    if len(parts) > 3 and parts[0] == 'data':
        parts[2] = ELEMENTS.get(parts[2], parts[2])
        if len(parts) > 4 and parts[2] == 'tags': parts[3] = TAGS.get(parts[3], parts[3])
    return '/'.join(parts)

def loot_schema(value):
    if isinstance(value, list): return [loot_schema(v) for v in value]
    if not isinstance(value, dict): return value
    result = {k: loot_schema(v) for k, v in value.items()}
    kind = result.get('function', '').removeprefix('minecraft:')
    condition = result.get('condition', '').removeprefix('minecraft:')
    if kind == 'enchant_randomly' and 'enchantments' in result:
        if 'options' in result: raise ValueError('Ambiguous old/new enchantment options')
        result['options'] = result.pop('enchantments')
    if kind == 'enchant_with_levels' and 'treasure' in result:
        treasure = result.pop('treasure')
        if not isinstance(treasure, bool): raise ValueError('Nonboolean treasure option')
        result.setdefault('options', '#minecraft:on_random_loot' if treasure else '#minecraft:in_enchanting_table')
    if kind == 'looting_enchant':
        result['function'] = 'minecraft:enchanted_count_increase'
        result['enchantment'] = 'minecraft:looting'
    if condition == 'random_chance_with_looting':
        chance, multiplier = result.pop('chance'), result.pop('looting_multiplier')
        if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (chance, multiplier)):
            raise ValueError('Nonconstant legacy looting chance')
        result.update(condition='minecraft:random_chance_with_enchanted_bonus',
            enchantment='minecraft:looting', unenchanted_chance=chance,
            enchanted_chance={'type':'minecraft:linear','base':chance+multiplier,'per_level_above_first':multiplier})
    if condition in ('entity_properties', 'entity_scores') and 'entity' in result:
        result['entity'] = {'killer':'attacker','direct_killer':'direct_attacker','killer_player':'attacking_player'}.get(result['entity'],result['entity'])
    if kind == 'copy_name' and 'source' in result:
        result['source'] = {'killer':'attacking_entity','killer_player':'last_damage_player'}.get(result['source'],result['source'])
    if set(result) <= {'enchantment','levels'} and 'enchantment' in result:
        result['enchantments'] = result.pop('enchantment')
    return result

def convert(source: Path, destination: Path) -> dict:
    source, destination = source.resolve(), destination.resolve()
    if source == destination or destination.exists(): raise ValueError('Fresh destination outside source required')
    with zipfile.ZipFile(source) as archive:
        entries = {}
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in entry.filename:
                raise ValueError('Unsafe source ZIP path')
            if entry.is_dir(): continue
            if entry.filename in entries: raise ValueError('Duplicate source ZIP path')
            entries[entry.filename] = archive.read(entry)
    meta = json.loads(entries['pack.mcmeta'])
    spec = meta['pack'].get('supported_formats', meta['pack']['pack_format'])
    report = {'source':source.name, 'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'originalPackFormat':meta['pack']['pack_format'], 'targetPackFormat':48,
        'originalCompatible':includes(spec,48), 'appliedOverlays':[], 'renamedFiles':[], 'changedJson':[]}
    destination.parent.mkdir(parents=True, exist_ok=True)
    if report['originalCompatible']:
        destination.write_bytes(source.read_bytes())
        report.update(outputSha256=report['sourceSha256'], nbtUnchanged=True, files=len(entries))
        return report
    overlays = meta.get('overlays',{}).get('entries',[])
    prefixes = tuple(o['directory'].rstrip('/')+'/' for o in overlays)
    active = {p:b for p,b in entries.items() if not p.startswith(prefixes)}
    for overlay in overlays:
        if not includes(overlay['formats'],41): continue
        prefix = overlay['directory'].rstrip('/')+'/'
        report['appliedOverlays'].append(overlay['directory'])
        active.update({p[len(prefix):]:b for p,b in entries.items() if p.startswith(prefix)})
    out = {}
    for name, raw in active.items():
        target = renamed(name)
        if target in out: raise ValueError('Directory conversion collision: '+target)
        if target != name: report['renamedFiles'].append({'from':name,'to':target})
        # Only these native resource kinds contain the changed loot/predicate
        # schemas. Preserve worldgen, mod metadata and JSON structure exports
        # byte-for-byte; those may legitimately use Gson's lenient syntax.
        kind = target.split('/')[2] if target.startswith('data/') and len(target.split('/'))>3 else ''
        if kind in {'loot_table','predicate','item_modifier','advancement'} and target.endswith('.json'):
            original = json.loads(raw)
            updated = loot_schema(original)
            if updated != original:
                raw = (json.dumps(updated,ensure_ascii=False,indent=2)+'\n').encode('utf8')
                report['changedJson'].append(target)
        out[target] = raw
    meta = copy.deepcopy(meta)
    meta.pop('overlays',None)
    meta['pack']['pack_format'] = 48
    meta['pack']['supported_formats'] = [48,48]
    out['pack.mcmeta'] = (json.dumps(meta,ensure_ascii=False,indent=2)+'\n').encode('utf8')
    for name, raw in active.items():
        if name.endswith('.nbt') and out[renamed(name)] != raw: raise AssertionError('Structure NBT changed')
    with zipfile.ZipFile(destination,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name, raw in sorted(out.items()): archive.writestr(name,raw)
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None: raise AssertionError('Output ZIP failed CRC')
    report.update(outputSha256=hashlib.sha256(destination.read_bytes()).hexdigest(), nbtUnchanged=True,files=len(out))
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.source.resolve()==args.output.resolve(): parser.error('Output must be a separate preparation directory')
    rows=[convert(p,args.output/p.name) for p in sorted(args.source.glob('*.zip'))]
    args.report.write_text(json.dumps({'productionModified':False,'packs':rows},ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'packs':len(rows),'converted':sum(not r['originalCompatible'] for r in rows),
        'unchanged':sum(r['originalCompatible'] for r in rows),'renamedFiles':sum(len(r['renamedFiles']) for r in rows),
        'changedJson':sum(len(r['changedJson']) for r in rows),'allStructureNbtUnchanged':all(r['nbtUnchanged'] for r in rows)}))

if __name__ == '__main__': main()
