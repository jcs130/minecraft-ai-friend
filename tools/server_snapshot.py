"""Create an isolated server snapshot. Does not run RCON or control services.

The root coordinator must freeze Minecraft saves first. Runtime JSON files are
read consistently one by one and SQLite uses its online backup API; this does
NOT imply an atomic snapshot of the Minecraft and AI processes together.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
import sys

from import_save import (PROJECT_ROOT, MigrationError, copy_file, copy_save,
                         inspect_save, iter_files, mod_plan, new_directory,
                         project_target, redact_object, safe_name, secret_key,
                         sha256, stable_bytes, write_json)

DEFAULT_SOURCE = Path(r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow')
RUNTIME_CONFIG = PROJECT_ROOT / 'config' / 'server-runtime.json'
OMIT_NAMES = re.compile(r'(^\.env|secret|credential|password|\.bak|backup|\.old$|\.pem$|\.key$|token)', re.I)
SAFE_PROPERTIES = {'allow-flight', 'allow-nether', 'difficulty', 'enable-command-block',
                   'force-gamemode', 'gamemode', 'generate-structures', 'hardcore',
                   'initial-disabled-packs', 'initial-enabled-packs', 'level-seed',
                   'level-type', 'max-players', 'max-world-size', 'motd', 'pvp',
                   'simulation-distance', 'spawn-animals', 'spawn-monsters', 'spawn-npcs',
                   'spawn-protection', 'view-distance', 'function-permission-level'}


def read_properties(path):
    result = {}
    if path.is_file():
        for line in stable_bytes(path).decode('utf-8-sig').splitlines():
            if not line.lstrip().startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                if key.strip() in SAFE_PROPERTIES:
                    result[key.strip()] = value.strip()
    return result


def sqlite_snapshot(source, target, changes, records):
    """Read-only source connection + backup; redact only the NEW database."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise MigrationError(f'Destination already exists: {target}')
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=20)) as src:
            with closing(sqlite3.connect(target)) as dst:
                src.backup(dst, pages=256, sleep=0.05)
                # A backup of a WAL-mode source inherits WAL mode. Switch the
                # private target before redaction so the final .db alone is
                # complete and its hash cannot change on connection close.
                dst.execute('PRAGMA journal_mode=DELETE')
                dst.execute('PRAGMA secure_delete=ON')
                tables = [r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
                for table in tables:
                    quote = lambda name: '"' + name.replace('"', '""') + '"'
                    columns = list(dst.execute(f'PRAGMA table_info({quote(table)})'))
                    for col in columns:
                        name = col[1]
                        if secret_key(name):
                            dst.execute(f'UPDATE {quote(table)} SET {quote(name)} = ?', ('',))
                            changes.append({'path': str(source), 'key': f'{table}.{name}', 'action': 'credential_column_cleared'})
                    # Structured JSON cells may contain provider credentials.
                    # Work with rowid only when the table has one; other tables
                    # are still protected by credential-column redaction.
                    try:
                        rows = dst.execute(f'SELECT rowid, * FROM {quote(table)}').fetchall()
                    except sqlite3.OperationalError:
                        continue
                    names = [c[1] for c in columns]
                    for row in rows:
                        for index, value in enumerate(row[1:]):
                            if isinstance(value, str) and value.lstrip().startswith(('{', '[')):
                                try:
                                    obj = json.loads(value)
                                except ValueError:
                                    continue
                                count = len(changes)
                                clean = redact_object(obj, changes, str(source), f'{table}.{names[index]}')
                                if len(changes) > count:
                                    dst.execute(f'UPDATE {quote(table)} SET {quote(names[index])}=? WHERE rowid=?', (json.dumps(clean, ensure_ascii=False), row[0]))
                dst.commit()
                dst.execute('VACUUM')
                if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise MigrationError(f'SQLite integrity check failed: {source.name}')
    except sqlite3.Error:
        raise MigrationError(f'Cannot create a sanitized SQLite backup: {source.name}') from None
    records.append({'source': str(source), 'path': str(target.relative_to(PROJECT_ROOT)), 'bytes': target.stat().st_size,
                    'sha256': sha256(target), 'action': 'sqlite_online_backup_sanitized'})


def copy_config_tree(source, target, records, changes, omissions):
    target.mkdir(parents=True, exist_ok=False)
    for path in iter_files(source):
        rel = path.relative_to(source)
        if any(OMIT_NAMES.search(part) for part in rel.parts):
            omissions.append({'path': str(path), 'reason': 'backup_or_credential_filename'})
            continue
        try:
            copy_file(path, target / rel, records, changes, sanitize=True)
        except MigrationError as error:
            if str(error).startswith(('Cannot parse configuration safely:', 'Cannot safely rewrite multiline credential')):
                omissions.append({'path': str(path), 'reason': 'unparsed_configuration_not_copied'})
            else:
                raise


def copy_plain_tree(source, target, records, changes):
    target.mkdir(parents=True, exist_ok=False)
    for path in iter_files(source):
        copy_file(path, target / path.relative_to(source), records, changes)


def count_skills(path):
    if not path.is_file():
        return None
    obj = json.loads(path.read_text(encoding='utf-8-sig'))
    if isinstance(obj, list):
        return len(obj)
    for key in ('atoms', 'skills', 'definitions'):
        if isinstance(obj, dict) and isinstance(obj.get(key), (list, dict)):
            return len(obj[key])
    return {'top_level_type': type(obj).__name__, 'top_level_keys': list(obj) if isinstance(obj, dict) else []}


def supplement_runtime(source, target):
    """Add missing runtime references, then verify/re-hash this private copy.

    Existing gameplay/config files are never overwritten. SQLite repair only
    checkpoints and compacts this tool's NEW copied databases, not the source.
    """
    source, target = Path(source).resolve(), project_target(target)
    manifest_path = target / 'snapshot-manifest.json'
    if not manifest_path.is_file():
        raise MigrationError('A completed snapshot-manifest.json is required for supplementation')
    if (target / 'runtime-supplement-manifest.json').exists():
        raise MigrationError('Runtime supplement already exists; refusing to overwrite')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if Path(manifest['source']).resolve() != source:
        raise MigrationError('Supplement source does not match the snapshot source')
    config = json.loads(RUNTIME_CONFIG.read_text(encoding='utf-8'))
    records, changes, omissions, preserved = [], [], [], []
    def add(path, destination):
        if destination.exists():
            preserved.append(str(destination.relative_to(target)))
        else:
            copy_file(path, destination, records, changes, sanitize=True)
    for source_name, target_name in [('data', 'world-data'), ('mcdata', 'mcdata')]:
        root = source / source_name
        for name in config.get('runtime_supplement_files', []):
            if (root / name).is_file():
                add(root / name, target / target_name / name)
        for directory in config.get('runtime_supplement_directories', []):
            if (root / directory).is_dir():
                for path in iter_files(root / directory):
                    relative = path.relative_to(root)
                    if any(OMIT_NAMES.search(part) for part in relative.parts):
                        omissions.append({'path': str(path), 'reason': 'backup_or_credential_filename'})
                    elif path.suffix.lower() in {'.json', '.jsonl', '.md', '.png', '.jpg', '.jpeg', '.webp'}:
                        add(path, target / target_name / relative)
        # Check referenced personas/backstories explicitly, rather than merely
        # relying on the default directory convention.
        roster = target / target_name / 'transmigrators.json'
        if roster.is_file():
            obj = json.loads(roster.read_text(encoding='utf-8'))
            for entry in obj.get('transmigrators', []):
                for key in ('personaFile', 'backstoryFile'):
                    if entry.get(key):
                        reference = (root / entry[key]).resolve()
                        if not reference.is_relative_to(root) or not reference.is_file():
                            raise MigrationError(f'Missing or escaping runtime reference: {source_name}/{key}')
                        add(reference, target / target_name / reference.relative_to(root))
    # Revisit strict-JSON exclusions with the JSONC-aware parser.
    for omission in manifest.get('omissions', []):
        if omission.get('reason') == 'unparsed_configuration_not_copied':
            path = Path(omission['path'])
            if path.resolve().is_relative_to(source / 'mc' / 'config'):
                add(path, target / 'mc' / 'config' / path.relative_to(source / 'mc' / 'config'))
    db_paths = [target / 'mc/database.db', target / 'world-data/world.db']
    for db_path in db_paths:
        if db_path.is_file():
            with closing(sqlite3.connect(db_path)) as database:
                database.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                database.execute('PRAGMA journal_mode=DELETE')
                database.execute('PRAGMA secure_delete=ON')
                database.execute('VACUUM')
                if database.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise MigrationError(f'Supplement SQLite integrity check failed: {db_path.name}')
    verified, mismatches = [], []
    old_root = Path(manifest['destination'])
    for item in manifest['files']:
        original = PROJECT_ROOT / item['path']
        path = target / original.relative_to(old_root)
        actual = sha256(path)
        verified.append({'path': str(path.relative_to(target)), 'sha256': actual, 'bytes': path.stat().st_size})
        if actual != item['sha256']:
            mismatches.append({'path': str(path.relative_to(target)), 'previous_sha256': item['sha256'], 'sha256': actual,
                               'reason': 'SQLite checkpoint/compaction' if path in db_paths else 'unexpected_hash_change'})
    unexpected = [m for m in mismatches if m['reason'] == 'unexpected_hash_change']
    if unexpected:
        raise MigrationError('Unexpected copied-file hash changes; review the private snapshot before launch')
    report = {'completed_utc': datetime.now(timezone.utc).isoformat(), 'source': str(source), 'destination': str(target),
              'new_files': records, 'redactions': changes, 'omissions': omissions, 'existing_files_preserved': preserved,
              'verified_files': verified, 'corrected_hashes': mismatches,
              'runtime_load_verified': False, 'cross_process_atomic': False}
    write_json(target / 'runtime-supplement-manifest.json', report)
    return report


def snapshot(source, target, *, source_quiesced=False, world_name='shadow', copy_runtime_cache=True):
    if not source_quiesced:
        raise MigrationError('Root coordinator must stop the source or run save-off + save-all flush before --source-quiesced')
    source = Path(source).resolve()
    mc = source / 'mc'
    world_name = safe_name(world_name)
    config = json.loads(RUNTIME_CONFIG.read_text(encoding='utf-8'))
    target = project_target(target)
    if target.exists():
        raise MigrationError(f'Destination already exists: {target}')
    if source.is_relative_to(target) or target.is_relative_to(source):
        raise MigrationError('Source and destination must not overlap')
    mods = mod_plan(mc / 'mods')
    world = inspect_save(mc / world_name, mods['mod_ids'])
    target = new_directory(target)
    records, changes, omissions = [], [], []
    write_json(target / 'SNAPSHOT-IN-PROGRESS.json', {'started_utc': datetime.now(timezone.utc).isoformat(), 'source': str(source)})
    # Leave this marker as an audit record. A complete snapshot requires BOTH
    # snapshot-manifest.json and runtime-supplement-manifest.json; an existing
    # directory or a copy-phase manifest alone may represent a partial attempt.
    copy_save(mc / world_name, target / 'mc' / world_name, records, changes)
    print('World copy completed; copying mods and sanitized configuration.', flush=True)
    (target / 'mc' / 'mods').mkdir()
    for item in mods['kept']:
        copy_file(mc / 'mods' / item['filename'], target / 'mc' / 'mods' / item['filename'], records, changes)
    for name in config['copy_content_directories']:
        path = mc / name
        if path.is_dir():
            copy_config_tree(path, target / 'mc' / name, records, changes, omissions)
    for name in config['copy_root_files']:
        if (mc / name).is_file():
            copy_file(mc / name, target / 'mc' / name, records, changes, sanitize=True)
    if (mc / 'database.db').is_file() and (mc / 'database.db').stat().st_size:
        sqlite_snapshot(mc / 'database.db', target / 'mc' / 'database.db', changes, records)
    if copy_runtime_cache and (mc / 'libraries').is_dir():
        copy_plain_tree(mc / 'libraries', target / 'mc' / 'libraries', records, changes)
    # Startup scripts are regenerated, never copied with production JVM paths.
    for state_source, state_target in [('data', 'world-data'), ('mcdata', 'mcdata')]:
        output = target / state_target
        output.mkdir()
        for name in config['runtime_state_files']:
            path = source / state_source / name
            if path.is_file():
                copy_file(path, output / name, records, changes, sanitize=True)
        if state_source == 'data' and (source / state_source / 'world.db').is_file():
            sqlite_snapshot(source / state_source / 'world.db', output / 'world.db', changes, records)
        # New isolated queues must not replay production commands.
        for name in ['spell-requests.jsonl', 'status-requests.jsonl', 'chant-requests.jsonl']:
            (output / name).write_text('', encoding='utf-8')
    props = read_properties(mc / 'server.properties')
    props.update({'server-ip': '', 'server-port': str(config['container_server_port']),
                  'level-name': world_name, 'online-mode': 'false',
                  'enable-rcon': 'false', 'rcon.port': str(config['container_rcon_port']),
                  'rcon.password': '', 'enable-query': 'false', 'enable-jmx-monitoring': 'false'})
    (target / 'mc' / 'server.properties').write_text('# Isolated copy: publish this server only on 127.0.0.1.\n' + '\n'.join(f'{k}={v}' for k, v in sorted(props.items())) + '\n', encoding='utf-8')
    for filename in ['ops.json', 'whitelist.json', 'banned-ips.json', 'banned-players.json']:
        (target / 'mc' / filename).write_text('[]\n', encoding='utf-8')
    # Mount target/mcdata as /mcdata when using these local JVM arguments.
    jvm = '-Xms2G\n-Xmx6G\n-Dsettlementsfix.mcdataDir=/mcdata\n-Dsettlementsfix.spellFile=/mcdata/spell-requests.jsonl\n-Dsettlementsfix.statusFile=/mcdata/status-requests.jsonl\n-Dsettlementsfix.testHooks=false\n'
    (target / 'mc' / 'user_jvm_args.txt').write_text(jvm, encoding='utf-8')
    launcher = f'libraries/net/neoforged/neoforge/{config["neoforge"]}'
    (target / 'mc' / 'run.bat').write_text(f'@echo off\r\njava @user_jvm_args.txt @{launcher}/win_args.txt %*\r\n', encoding='utf-8')
    (target / 'mc' / 'run.sh').write_text(f'#!/bin/sh\nexec java @user_jvm_args.txt @{launcher}/unix_args.txt "$@"\n', encoding='utf-8')
    report = {'schema_version': 1, 'completed_utc': datetime.now(timezone.utc).isoformat(),
              'source': str(source), 'destination': str(target), 'source_quiesced_asserted_by_caller': True,
              'cross_process_atomic': False, 'runtime_load_verified': False, 'world': world,
              'supplement_manifest': 'runtime-supplement-manifest.json',
              'complete_requires': ['snapshot-manifest.json', 'runtime-supplement-manifest.json'],
              'mods': mods, 'redactions': changes, 'omissions': omissions, 'files': records,
              'skill_counts': {name: count_skills(target / name / 'magic-atoms.json') for name in ['world-data', 'mcdata']},
              'limitations': ['The caller asserted a stopped source or save-off + flush; this script issues no save or service-control commands.',
                             'SQLite online backups are individually consistent; JSON files were checked individually. Cross-process state is not atomic.',
                             'Production API credentials were cleared by key. Maid/agent model connectivity requires local credentials and is not verified.',
                             'Only allowlisted runtime state is imported. Production account sessions, credentials, raw logs and pending command queues are excluded.',
                             'This private snapshot contains a runtime library cache; omit libraries from redistribution.']}
    write_json(target / 'snapshot-manifest.json', report)
    write_json(target / 'registry-risk-report.json', world)
    # A fresh one-command snapshot includes all referenced runtime documents.
    # The standalone option also repairs snapshots made by the earlier version.
    supplement_runtime(source, target)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--target', type=Path, default=PROJECT_ROOT / 'server')
    parser.add_argument('--world-name', default='shadow')
    parser.add_argument('--source-quiesced', action='store_true')
    parser.add_argument('--skip-runtime-cache', action='store_true')
    parser.add_argument('--supplement-runtime', action='store_true', help='Add missing runtime references to a completed private snapshot and verify hashes')
    args = parser.parse_args()
    try:
        if args.supplement_runtime:
            report = supplement_runtime(args.source, args.target)
            print(json.dumps({'destination': report['destination'], 'new_files': len(report['new_files']),
                              'verified_files': len(report['verified_files']), 'corrected_hashes': report['corrected_hashes']}, ensure_ascii=False))
            return
        report = snapshot(args.source, args.target, source_quiesced=args.source_quiesced,
                          world_name=args.world_name, copy_runtime_cache=not args.skip_runtime_cache)
        print(json.dumps({'destination': report['destination'], 'files': len(report['files']),
                          'mods': len(report['mods']['kept']), 'redactions': len(report['redactions']),
                          'omissions': len(report['omissions']), 'skill_counts': report['skill_counts'],
                          'runtime_load_verified': False}, ensure_ascii=False))
    except (MigrationError, OSError) as error:
        parser.exit(2, f'{error}\n')


if __name__ == '__main__':
    main()
