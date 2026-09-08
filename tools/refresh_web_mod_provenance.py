"""Refresh JAR provenance only after exact resource and fresh registry equivalence.

Never rebuild textures, reload a browser, run a model, export a registry, or
control a service. Export with the existing native command before this tool.
"""
import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPORT = 'vendor/modern-viewer/mod-assets/compatibility-report.json'
EXPORT = 'server/mc/block-registry.json'
MIRROR = 'server/world-data/block-registry.json'
VISUALS = tuple('vendor/modern-viewer/mod-assets/' + name for name in (
    'mod-pack.json', 'mod-blocks-mcdata.json', 'vanilla-state-map.json', 'compatibility-summary.json'))


def path(root, name):
    root = Path(root).resolve()
    target = Path(str(name).replace('\\', '/'))
    if not target.is_absolute(): target = root / target
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (target, *target.parents)):
        raise ValueError('linked_resource_path')
    target = target.resolve()
    if not target.is_relative_to(root): raise ValueError('outside_project')
    return target


def digest(raw): return hashlib.sha256(raw).hexdigest()


def file_hash(target):
    h = hashlib.sha256()
    with target.open('rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''): h.update(block)
    return h.hexdigest()


def read(root, name):
    return json.loads(path(root, name).read_text(encoding='utf-8-sig'))


def registry_semantics(value):
    if value.get('minecraftVersion') != '1.21.1' or not isinstance(value.get('blocks'), list) or not isinstance(value.get('blockStates'), list):
        raise ValueError('invalid_registry')
    return {key: value[key] for key in value if key != 'generatedAt'}


def resources(target):
    """Nested JAR bytes are included whole: never skip nested resource changes."""
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip(): raise ValueError('invalid_jar')
        return {name: digest(archive.read(name)) for name in names if not name.endswith('/')
            and (not name.endswith('.class') or name.startswith(('assets/', 'data/')))}


def prepare(root=ROOT, baselines=(), now=None):
    root = Path(root).resolve(); now = time.time() if now is None else now
    old = read(root, REPORT)
    source, mirror = read(root, EXPORT), read(root, MIRROR)
    generated = source.get('generatedAt')
    if type(generated) not in (int, float) or not -5 <= now - generated / 1000 <= 600:
        raise ValueError('fresh_native_registry_export_required')
    if registry_semantics(source) != registry_semantics(mirror):
        raise ValueError('registry_changed_full_asset_build_required')
    mirror_hash = file_hash(path(root, MIRROR))
    state_map = read(root, VISUALS[2]); canonical = path(root, 'world/node_modules/minecraft-data/minecraft-data/data/pc/1.21.1/blocks.json')
    if not (old['registry']['sha256'] == mirror_hash == old['registry']['mirrorSha256'] == state_map['registrySha256']
            and state_map['canonicalBlocksSha256'] == file_hash(canonical)):
        raise ValueError('active_registry_or_mapping_changed')
    original = {}
    for row in old['jars']:
        if row.get('zipVerified') is not True: raise ValueError('unverified_original_jar')
        for name in row['paths']:
            key = str(name).replace('\\', '/')
            if key in original: raise ValueError('duplicate_original_path')
            original[key] = row
    current = {str(p.relative_to(root)).replace('\\', '/'): file_hash(path(root, p))
        for folder in ('server/mc/mods', 'client/mods') for p in sorted(path(root, folder).glob('*.jar'))}
    if set(current) != set(original): raise ValueError('mod_set_changed_full_asset_build_required')
    baseline_by_hash = {file_hash(path(root, p)): path(root, p) for p in baselines}
    proofs, verified = [], set()
    for name, new_hash in current.items():
        previous = original[name]['sha256']
        if previous == new_hash or (previous, new_hash) in verified: continue
        baseline = baseline_by_hash.get(previous)
        if baseline is None: raise ValueError('exact_old_jar_backup_required')
        before, after = resources(baseline), resources(path(root, name))
        if before != after: raise ValueError('jar_resources_changed_full_asset_build_required')
        verified.add((previous, new_hash))
        proofs.append({'oldSha256': previous, 'newSha256': new_hash,
            'baseline': str(baseline.relative_to(root)), 'comparedPath': name,
            'nonClassResourceCount': len(after), 'nestedJarsComparedByteForByte': True,
            'resourceSetSha256': digest(json.dumps(after, sort_keys=True, separators=(',', ':')).encode())})
    groups = {}
    for name, new_hash in current.items():
        side = 'server' if name.startswith('server/') else 'client'
        if new_hash not in groups:
            row = deepcopy(original[name]); row.update(sha256=new_hash, sides=[], paths=[])
            groups[new_hash] = row
        groups[new_hash]['paths'].append(name)
        if side not in groups[new_hash]['sides']: groups[new_hash]['sides'].append(side)
    counts = {side: sum(side in row['sides'] for row in groups.values()) for side in ('server', 'client')}
    if counts != old['jarCounts']: raise ValueError('jar_grouping_changed_full_asset_build_required')
    updated = deepcopy(old); updated['jars'] = list(groups.values())
    updated['registry'].update(path=MIRROR, sourceExportPath=EXPORT,
        sourceExportSha256=file_hash(path(root, EXPORT)), sourceExportGeneratedAt=generated,
        verifiedAt=int(now*1000), sourceSemanticallyEquivalent=True)
    audit = {'schema': 1, 'verifiedAt': int(now*1000), 'mode': 'provenance_only',
        'jarPathsScanned': len(current), 'changedUniqueJars': len(proofs), 'resourceProofs': proofs,
        'registrySemanticallyEqual': True, 'registrySourceSha256': file_hash(path(root, EXPORT)),
        'activeRegistrySha256': mirror_hash, 'blocks': len(source['blocks']), 'states': len(source['blockStates']),
        'visualHashes': {name: file_hash(path(root, name)) for name in VISUALS},
        'atlasRebuilt': False, 'stateMapRebuilt': False, 'browserRenderTested': False,
        'modelCalls': 0, 'serviceRestarts': 0}
    updated['provenanceRefresh'] = audit
    guards = {REPORT: file_hash(path(root, REPORT)), EXPORT: file_hash(path(root, EXPORT)),
        MIRROR: mirror_hash, **audit['visualHashes'], **current}
    return updated, audit, guards


def apply(root, updated, audit, guards):
    root = Path(root).resolve()
    current = {str(p.relative_to(root)).replace('\\', '/') for folder in ('server/mc/mods', 'client/mods')
               for p in path(root, folder).glob('*.jar')}
    if current != {name for name in guards if name.endswith('.jar')}:
        raise ValueError('mod_set_changed_during_scan')
    if any(file_hash(path(root, name)) != expected for name, expected in guards.items()):
        raise ValueError('input_changed_during_scan')
    backup = path(root, 'runtime/web-provenance-backups/' + uuid.uuid4().hex)
    backup.mkdir(parents=True)
    (backup/'compatibility-report.json').write_bytes(path(root, REPORT).read_bytes())
    (backup/'registry-export.json').write_bytes(path(root, EXPORT).read_bytes())
    (backup/'verification.json').write_text(json.dumps(audit, indent=2)+'\n', encoding='utf8')
    target = path(root, REPORT); stage = target.with_name('.compatibility-report-' + uuid.uuid4().hex + '.json')
    try:
        stage.write_text(json.dumps(updated, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
        if file_hash(target) != guards[REPORT]: raise ValueError('report_changed_before_replace')
        os.replace(stage, target)
    finally:
        if stage.exists(): stage.unlink()
    if any(file_hash(path(root, name)) != expected for name, expected in audit['visualHashes'].items()):
        raise ValueError('visuals_changed_during_refresh')
    return str(backup.relative_to(root))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', action='append', default=[])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    updated, audit, guards = prepare(baselines=args.baseline)
    backup = apply(ROOT, updated, audit, guards) if args.apply else None
    print(json.dumps({'ok': True, **{k: audit[k] for k in ('jarPathsScanned', 'changedUniqueJars',
        'registrySemanticallyEqual', 'blocks', 'states', 'atlasRebuilt', 'stateMapRebuilt')},
        'applied': args.apply, 'backup': backup}, ensure_ascii=False))
