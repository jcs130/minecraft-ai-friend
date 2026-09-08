"""Review/add native TLM bridge settings only for models used by existing saved maids.

The check writes an ignored review plan and one administrator-verified owned
unloaded identity. It never assigns an owner, changes an entity or calls models.
Apply requires the exact project MC container stopped and preserves all presets.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid
import zipfile
import zlib
import nbtlib
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from configure_maid_bridge import guarded, _require_stopped

GENERIC = 'Your stable identity, personality and long-term memory are managed by the QwenPaw character bound to your actual maid UUID. Treat the game observations as context. Answer the owner naturally using that character; do not generate or replace a character setting. Native TLM behavior controls your body.'
PACK_SETTINGS = Path('server/mc/tlm_custom_pack/qiandeng-native-chat-1.0.0/assets/qiandeng_bridge/settings')
LEGACY_SETTINGS = Path('server/mc/config/touhou_little_maid/settings')


def uuid_tag(value):
    if isinstance(value, str): return str(uuid.UUID(value))
    if len(value) != 4: raise ValueError('invalid_saved_uuid')
    return str(uuid.UUID(bytes=b''.join((int(n) & 0xffffffff).to_bytes(4, 'big') for n in value)))


def saved_maids(root=ROOT):
    root = Path(root).resolve(); world = guarded(root / 'server/mc/shadow', root)
    rows = []; evidence = []; now = int(time.time() * 1000)
    for path in sorted(world.rglob('entities/r.*.*.mca')):
        path = guarded(path, root)
        before = path.stat(); raw = path.read_bytes(); after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('saved_region_changed_during_read')
        if not raw: continue  # Vanilla may leave an empty region file with no entity chunks.
        if len(raw) < 8192 or len(raw) > 268435456: raise ValueError('invalid_entity_region')
        relative = path.relative_to(world).as_posix()
        if relative.startswith('DIM-1/'): dimension = 'minecraft:the_nether'
        elif relative.startswith('DIM1/'): dimension = 'minecraft:the_end'
        elif relative.startswith('dimensions/'):
            parts = relative.split('/'); dimension = parts[1] + ':' + '/'.join(parts[2:-2])
        else: dimension = 'minecraft:overworld'
        found = False
        for index in range(1024):
            entry = int.from_bytes(raw[index * 4:index * 4 + 4], 'big'); offset, sectors = entry >> 8, entry & 255
            if not offset: continue
            start = offset * 4096
            if not sectors or start < 8192 or start + 5 > len(raw): raise ValueError('invalid_region_offset')
            size = int.from_bytes(raw[start:start + 4], 'big'); compression = raw[start + 4]
            if size < 2 or size > sectors * 4096 - 4 or start + size + 4 > len(raw): raise ValueError('invalid_chunk_size')
            payload = raw[start + 5:start + size + 4]
            if compression in (1, 2):
                inflater = zlib.decompressobj(31 if compression == 1 else 15)
                decoded = inflater.decompress(payload, 67108865)
                if len(decoded) > 67108864 or not inflater.eof: raise ValueError('entity_chunk_limit')
            elif compression == 3: decoded = payload
            else: raise ValueError('unsupported_entity_compression')
            tag = nbtlib.File.parse(io.BytesIO(decoded))
            for entity in tag.get('Entities', []):
                if str(entity.get('id')) != 'touhou_little_maid:maid': continue
                found = True
                model = str(entity.get('model_id', ''))
                if not re.fullmatch('[a-z0-9_.-]+:[a-z0-9_./-]+', model): raise ValueError('invalid_saved_maid_model')
                uid = uuid_tag(entity['UUID'])
                owner = uuid_tag(entity['Owner']) if entity.get('Owner') is not None else None
                row = {'schema': 1, 'maidUuid': uid, 'ownerUuid': owner, 'entityId': 0,
                    'displayName': '女仆', 'hasCustomName': False, 'modelId': model, 'dimension': dimension,
                    'position': [float(n) for n in entity['Pos']], 'loaded': False, 'observedAt': now}
                if 'CustomName' in entity:
                    name = json.loads(str(entity['CustomName']))
                    # A display label is data, never persona or an instruction.
                    if isinstance(name, str): text = name
                    elif isinstance(name, dict) and isinstance(name.get('text'), str): text = name['text']
                    else: text = ''
                    if text:
                        row['displayName'] = text[:80]; row['hasCustomName'] = True
                rows.append(row)
        if found: evidence.append({'region': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(raw).hexdigest()})
    if len(rows) > 64 or len({r['maidUuid'] for r in rows}) != len(rows): raise ValueError('ambiguous_saved_maids')
    return rows, evidence


def native_models(root=ROOT):
    """Read only metadata; character body content is neither used nor exported."""
    root = Path(root); models = set(); files = 0
    def inspect(stream):
        nonlocal files
        lines = []
        for _ in range(100):
            line = stream.readline(4097)
            if not line or re.match(r'^(setting|prompt|personality)\s*:', line): break
            if len(line) > 4096: raise ValueError('setting_metadata_limit')
            lines.append(line)
        meta = (yaml.safe_load(''.join(lines)) or {}).get('meta', {})
        ids = meta.get('model_id', [])
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids): raise ValueError('invalid_setting_metadata')
        models.update(ids); files += 1
    for base in (root / 'server/mc/config/touhou_little_maid/settings', root / 'server/mc/tlm_custom_pack'):
        for path in base.rglob('*.yml'):
            if '/settings/' not in path.as_posix(): continue
            path = guarded(path, root)
            with path.open(encoding='utf8') as stream: inspect(stream)
    for path in (root / 'server/mc/tlm_custom_pack').glob('*.zip'):
        with zipfile.ZipFile(guarded(path, root)) as archive:
            for info in archive.infolist():
                if re.fullmatch(r'assets/[^/]+/settings/[^/]+\.yml', info.filename):
                    if info.file_size > 65536: raise ValueError('setting_metadata_limit')
                    with archive.open(info) as raw:
                        with io.TextIOWrapper(raw, encoding='utf8') as stream: inspect(stream)
    return models, files


def content(model):
    return ('# Native chat entry only; individual persona remains in the UUID-bound QwenPaw Agent.\n'
        'meta:\n  version: 1\n  author: QiandengJi bridge\n  model_id: [' + json.dumps(model) + ']\n'
        '  language: zh_cn\nsetting: ' + GENERIC + '\n')


def confirm_owned_unloaded(row):
    uid = str(uuid.UUID(row['maidUuid']))
    dimension = row['dimension']
    if not re.fullmatch('[a-z0-9_.-]+:[a-z0-9_./-]+', dimension): raise ValueError('invalid_saved_dimension')
    result = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli',
        'execute in ' + dimension + ' run data get entity ' + uid + ' UUID'],
        capture_output=True, text=True, encoding='utf8', errors='replace', timeout=15)
    if result.returncode != 0 or 'No entity was found' not in result.stdout:
        raise ValueError('owned_unloaded_status_not_confirmed')


def candidate(root=ROOT):
    root = Path(root); maids, evidence = saved_maids(root); models, files = native_models(root)
    missing = sorted({r['modelId'] for r in maids} - models)
    entries = []
    for model in missing:
        name = 'qd-bridge-' + hashlib.sha256(model.encode()).hexdigest()[:16] + '.yml'
        # TLM's server pack reload clears SettingReader, then reads only custom
        # packs. Config-only settings disappear again at startup/pack reload.
        target = guarded(root / PACK_SETTINGS / name, root)
        if target.exists(): raise ValueError('existing_setting_target_requires_review')
        entries.append({'modelId': model, 'target': target.relative_to(root).as_posix(), 'content': content(model),
            'sha256': hashlib.sha256(content(model).encode('utf8')).hexdigest(), 'existingTarget': False})
    return {'schema': 1, 'project': 'qiandengji', 'maidCount': len(maids), 'ownedMaidCount': sum(r['ownerUuid'] is not None for r in maids),
        'existingSettingFiles': files, 'missingModels': missing, 'entries': entries, 'sourceEvidence': evidence,
        'entityMutations': 0, 'ownerMutations': 0, 'modelCalls': 0, 'preservesAllExistingSettings': True}, maids


def apply_plan(root, plan_path, ensure_stopped=_require_stopped):
    root = Path(root).resolve(); plan = json.loads(guarded(plan_path, root).read_text('utf8'))
    if plan.get('schema') != 1 or plan.get('project') != 'qiandengji': raise ValueError('invalid_setting_plan')
    ensure_stopped()
    fresh, _ = candidate(root)
    if plan['entries'] != fresh['entries'] or plan['maidCount'] != fresh['maidCount']:
        raise ValueError('setting_candidate_changed_recheck')
    targets = []
    for row in fresh['entries']:
        target = guarded(root / row['target'], root)
        if target.exists(): raise ValueError('setting_target_exists')
        targets.append((target, row['content']))
    backup = guarded(root / 'runtime/maid-native-settings-backups' / uuid.uuid4().hex, root)
    backup.mkdir(parents=True)
    (backup / 'plan.json').write_text(json.dumps(fresh, ensure_ascii=False, indent=2) + '\n', 'utf8')
    written = []
    for target, text in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('x', encoding='utf8', newline='\n') as stream:
            stream.write(text); stream.flush(); os.fsync(stream.fileno())
        written.append(target.relative_to(root).as_posix())
    return {'ok': True, 'settingsCreated': len(written), 'createdFiles': written, 'backup': str(backup),
        'existingFilesOverwritten': 0, 'entityMutations': 0, 'ownerMutations': 0, 'modelCalls': 0}


def persist_generated(root, plan_path):
    """Copy only our exact reviewed legacy outputs into the native pack loader.

    No existing settings are edited. This does not reload the running server;
    the administrator follows it with the native `tlm pack reload` command.
    """
    root = Path(root).resolve()
    plan = json.loads(guarded(plan_path, root).read_text('utf8'))
    if plan.get('schema') != 1 or plan.get('project') != 'qiandengji':
        raise ValueError('invalid_setting_plan')
    entries = plan.get('entries')
    if not isinstance(entries, list) or not 1 <= len(entries) <= 64:
        raise ValueError('invalid_generated_settings')
    targets = []; seen = set()
    for row in entries:
        model = row.get('modelId', '')
        if not isinstance(model, str) or not re.fullmatch('[a-z0-9_.-]+:[a-z0-9_./-]+', model) or model in seen:
            raise ValueError('invalid_generated_model')
        seen.add(model)
        name = 'qd-bridge-' + hashlib.sha256(model.encode()).hexdigest()[:16] + '.yml'
        expected = content(model).encode('utf8')
        if (row.get('target') != (LEGACY_SETTINGS / name).as_posix()
                or row.get('content', '').encode('utf8') != expected
                or row.get('sha256') != hashlib.sha256(expected).hexdigest()):
            raise ValueError('not_exact_generated_legacy_setting')
        source = guarded(root / LEGACY_SETTINGS / name, root)
        target = guarded(root / PACK_SETTINGS / name, root)
        if not source.is_file() or source.read_bytes() != expected:
            raise ValueError('generated_setting_changed_preserve_owner_content')
        if target.exists() and (not target.is_file() or target.read_bytes() != expected):
            raise ValueError('existing_pack_setting_requires_review')
        targets.append((source, target, expected))
    backup = guarded(root / 'runtime/maid-native-settings-backups' / uuid.uuid4().hex, root)
    backup.mkdir(parents=True)
    shutil.copy2(guarded(plan_path, root), backup / 'plan.json')
    for source, _, _ in targets: shutil.copy2(source, backup / source.name)
    written = []
    for source, target, expected in targets:
        if source.read_bytes() != expected: raise ValueError('generated_setting_changed_during_copy')
        if target.exists(): continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(expected); stream.flush(); os.fsync(stream.fileno())
        written.append(target.relative_to(root).as_posix())
    return {'ok': True, 'settingsCreated': len(written), 'createdFiles': written,
        'backup': str(backup), 'nativeReloadCommand': 'tlm pack reload', 'restartRequired': False,
        'existingFilesOverwritten': 0, 'entityMutations': 0, 'ownerMutations': 0, 'modelCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true'); mode.add_argument('--apply', choices=['qiandengji'])
    mode.add_argument('--persist', choices=['qiandengji'], help='Copy exact previously generated config settings into the reload-safe native pack')
    parser.add_argument('--plan', type=Path, default=ROOT / 'runtime/maid-native-settings-plan.json')
    args = parser.parse_args()
    if args.persist: result = persist_generated(ROOT, args.plan)
    elif args.apply: result = apply_plan(ROOT, args.plan)
    else:
        plan, maids = candidate()
        path = guarded(args.plan, ROOT); path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', 'utf8')
        owned = [row for row in maids if row['ownerUuid'] is not None]
        if len(owned) != 1: raise ValueError('expected_one_owned_saved_maid_for_administrator_review')
        confirm_owned_unloaded(owned[0])
        # This is persisted identity, not a claim that the entity is currently loaded.
        identity_path = ROOT / 'runtime/maid-production-identity.json'
        identity_path.write_text(json.dumps(owned[0], ensure_ascii=False, indent=2) + '\n', 'utf8')
        result = {'ok': True, 'mode': 'check', 'maidCount': plan['maidCount'], 'ownedMaidCount': len(owned),
            'missingModels': len(plan['missingModels']), 'plan': str(path), 'identityFile': str(identity_path),
            'nativeModelRecognizedForOwnedMaid': owned[0]['modelId'] not in plan['missingModels'],
            'ownedUnloadedVerifiedByRcon': True,
            'entityMutations': 0, 'ownerMutations': 0, 'modelCalls': 0}
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__': main()
