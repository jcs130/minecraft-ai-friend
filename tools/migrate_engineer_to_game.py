"""Stage one native Qwen backup for an explicit ID migration; never deploy.

Input must be the SHA-verified native export of only operations:mc-god. The
original signed archive is immutable. A separately named, unsigned archive is
produced for native import with explicit legacy trust; this is not the original
signature. Native restore has no ID mapping and would otherwise hit the goddess.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar')]
SOURCE_ROLE, TARGET_ROLE = 'mc-god', 'qd-engineer'
SOURCE_PREFIX = 'data/workspaces/mc-god/'
TARGET_PREFIX = 'data/workspaces/qd-engineer/'
TARGET_WORKSPACE = '/state/work/workspaces/qd-engineer'
DRIVERS = {'qiandeng_operations', 'qd_learning', 'qd_world_team', 'qd_engineering'}
MAX_TOTAL = 2 * 1024 ** 3
MAX_FILE = 128 * 1024 ** 2


def sha_file(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while chunk := stream.read(1024 * 1024): value.update(chunk)
    return value.hexdigest()


def unlinked(path):
    path = Path(path)
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_migration_path')
    return path


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def workspace_inventory(folder):
    """Hash a quiescent source before native export; never changes its files."""
    folder = unlinked(folder)
    profile = json.loads((folder / 'agent.json').read_text(encoding='utf-8-sig'))
    if profile.get('id') != SOURCE_ROLE or set(profile.get('mcp', {}).get('clients', {})) != DRIVERS:
        raise ValueError('unexpected_source_profile_identity')
    files, size = {}, 0
    for path in sorted(folder.rglob('*')):
        unlinked(path)
        if path.is_dir(): continue
        if not path.is_file(): raise ValueError('special_source_workspace_file')
        observed = path.stat(); size += observed.st_size
        if observed.st_size > MAX_FILE or size > MAX_TOTAL or len(files) >= 100000:
            raise ValueError('migration_source_limit')
        files[path.relative_to(folder).as_posix()] = {'sha256': sha_file(path), 'size': observed.st_size}
        after = path.stat()
        if after.st_size != observed.st_size or after.st_mtime_ns != observed.st_mtime_ns:
            raise ValueError('source_changed_during_inventory')
    return {'schema': 1, 'logicalActor': 'operations:mc-god', 'files': files}


def archive_inventory(archive):
    seen, rows, size = set(), [], 0
    for info in archive.infolist():
        name = info.filename
        if (not name or '\\' in name or any(ord(c) < 32 for c in name)
                or name.startswith('/') or ':' in name
                or any(p in ('', '.', '..') for p in name.rstrip('/').split('/'))):
            raise ValueError('unsafe_migration_archive_path')
        if name.casefold() in seen: raise ValueError('duplicate_migration_archive_path')
        seen.add(name.casefold())
        mode = info.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('special_migration_archive_entry')
        if info.is_dir():
            if not name.startswith(SOURCE_PREFIX): raise ValueError('unexpected_migration_directory')
            continue
        if name != 'meta.json' and not name.startswith(SOURCE_PREFIX):
            raise ValueError('backup_must_contain_only_source_engineer')
        size += info.file_size
        if info.file_size > MAX_FILE or size > MAX_TOTAL or len(rows) >= 100000:
            raise ValueError('migration_archive_limit')
        rows.append(info)
    if 'meta.json' not in seen or SOURCE_PREFIX + 'agent.json' not in seen:
        raise ValueError('incomplete_native_backup')
    return rows


@contextmanager
def target_contract():
    """Only this staging process sees the proposed final host policy."""
    from world_team_hosts import ENGINEER, SOURCE, TARGET, MIGRATION
    with tempfile.TemporaryDirectory(prefix='qd-engineer-contract-') as temporary:
        path = Path(temporary) / 'runtime-hosts.json'
        path.write_bytes(encoded({'schema': 1, 'migration': MIGRATION, 'phase': 'active',
                                 'logicalActor': ENGINEER, 'source': SOURCE, 'target': TARGET}))
        previous = os.environ.get('TEAM_RUNTIME_HOSTS_FILE')
        os.environ['TEAM_RUNTIME_HOSTS_FILE'] = str(path)
        try: yield
        finally:
            if previous is None: os.environ.pop('TEAM_RUNTIME_HOSTS_FILE', None)
            else: os.environ['TEAM_RUNTIME_HOSTS_FILE'] = previous


def transform_profile(profile):
    from qwenpaw.config.config import AgentProfileConfig
    from operations_team_mcp import operation_arguments
    from role_learning_profiles import with_learning, validate_learning_profile
    from world_team_profiles import bindings
    if profile.get('id') != SOURCE_ROLE or profile.get('workspace_dir') != '/state/work/workspaces/mc-god':
        raise ValueError('unexpected_source_profile_identity')
    if set(profile.get('mcp', {}).get('clients', {})) != DRIVERS:
        raise ValueError('unexpected_source_driver_inventory')
    operations_cwd = profile['mcp']['clients']['qiandeng_operations'].get('cwd')
    if operations_cwd not in (None, '', '/state/work/workspaces/mc-god'):
        raise ValueError('unexpected_source_operations_cwd')
    if not profile.get('language') or not profile.get('active_model', {}).get('provider_id'):
        raise ValueError('source_language_and_model_required')
    memory = profile['running']['reme_light_memory_config']
    if profile['heartbeat']['enabled'] or memory['dream_cron_enabled'] or memory['auto_memory_interval']:
        raise ValueError('source_automatic_memory_requires_separate_migration')
    result = deepcopy(profile)
    result.update(id=TARGET_ROLE, workspace_dir=TARGET_WORKSPACE)
    result = with_learning(result, TARGET_ROLE, 'game')
    # This is an identity move, not a runtime-policy upgrade. The existing
    # policy must still pass validate_learning_profile below unchanged.
    result['running'] = deepcopy(profile['running'])
    result['mcp']['clients'].update(bindings(TARGET_ROLE, 'game'))
    result['mcp']['clients']['qiandeng_operations']['args'] = operation_arguments(SOURCE_ROLE, TARGET_ROLE, 'game')
    # The absolute tool entrypoint and explicitly mounted state roots do not
    # need a cwd. Keeping the old mc-god path here would select the goddess's
    # workspace after migration to game, despite correct native-role args.
    result['mcp']['clients']['qiandeng_operations']['cwd'] = ''
    # The source has already passed native config; re-validate the target too.
    # Native before-validators may normalize nested dicts in place. Validation
    # must not rewrite the preservation payload or its original legacy fields.
    AgentProfileConfig.model_validate(deepcopy(result))
    validate_learning_profile(result, TARGET_ROLE, 'game')
    for key in ('active_model', 'fallback_models', 'running', 'language', 'name'):
        if result.get(key) != profile.get(key): raise ValueError('unrelated_profile_change:' + key)
    return result


def stage(source, output, expected_sha256, source_inventory=None, prior_jobs=None):
    from dataclasses import replace
    from qwenpaw.backup.models import BackupMeta, RestoreBackupRequest
    from qwenpaw.drivers.storage import load_card, dump_card
    from role_learning_profiles import validate_jobs
    from world_team_schedule import team_job
    source, output = unlinked(source), unlinked(output)
    if not re.fullmatch(r'[0-9a-f]{64}', expected_sha256) or sha_file(source) != expected_sha256:
        raise ValueError('source_backup_sha256_mismatch')
    if output.exists(): raise ValueError('migration_output_must_be_new')
    output.mkdir(parents=True)
    changes, preserved, ready_cards = {}, {}, {}
    try:
        with zipfile.ZipFile(source) as archive, target_contract():
            inventory = archive_inventory(archive)
            if source_inventory is not None:
                if (source_inventory.get('schema') != 1 or source_inventory.get('logicalActor') != 'operations:mc-god'
                        or not isinstance(source_inventory.get('files'), dict)):
                    raise ValueError('invalid_source_inventory')
                expected_files = source_inventory['files']
                members = {i.filename[len(SOURCE_PREFIX):]: i for i in inventory if i.filename != 'meta.json'}
                if set(expected_files) != set(members): raise ValueError('native_backup_missing_or_extra_source_files')
                for name, row in expected_files.items():
                    digest = hashlib.sha256()
                    with archive.open(members[name]) as stream:
                        while chunk := stream.read(1024 * 1024): digest.update(chunk)
                    if row != {'sha256': digest.hexdigest(), 'size': members[name].file_size}:
                        raise ValueError('native_backup_source_bytes_differ')
            meta = BackupMeta.model_validate_json(archive.read('meta.json'))
            if (meta.agent_count != 1 or not meta.scope.include_agents or meta.scope.include_global_config
                    or meta.scope.include_secrets or meta.scope.include_skill_pool):
                raise ValueError('native_backup_scope_not_single_agent')
            original = json.loads(archive.read(SOURCE_PREFIX + 'agent.json'))
            ready = transform_profile(original)
            (output / 'ready-agent.json').write_bytes(encoded(ready))
            inactive = deepcopy(ready)
            for client in inactive['mcp']['clients'].values(): client['enabled'] = False
            changes['agent.json'] = encoded(inactive)
            original_jobs = json.loads(archive.read(SOURCE_PREFIX + 'jobs.json'))
            if {j['id'] for j in original_jobs['jobs']} != {'qd-learning-mc-god', 'qd-team-engineer'}:
                raise ValueError('unexpected_source_jobs')
            ready_jobs = deepcopy(original_jobs)
            if prior_jobs is not None:
                prior = prior_jobs if isinstance(prior_jobs, list) else prior_jobs['jobs']
                prior_by_id = {j['id']: j for j in prior}
                if len(prior_by_id) != len(prior) or set(prior_by_id) != {j['id'] for j in ready_jobs['jobs']}:
                    raise ValueError('prior_job_identity_mismatch')
                for job in ready_jobs['jobs']:
                    old = prior_by_id[job['id']]
                    if type(old.get('enabled')) is not bool or {k: v for k, v in old.items() if k != 'enabled'} != {
                            k: v for k, v in job.items() if k != 'enabled'}:
                        raise ValueError('source_jobs_changed_beyond_pause')
                    job['enabled'] = old['enabled']
            for job in ready_jobs['jobs']:
                if job['id'] == 'qd-team-engineer':
                    # Keep actual cadence, session and history; only add the
                    # explicitly authorized native host to the logical job.
                    expected = team_job('operations:mc-god')
                    job['meta'] = expected['meta']
            validate_jobs(ready_jobs, TARGET_ROLE, 'game')
            (output / 'ready-jobs.json').write_bytes(encoded(ready_jobs))
            inactive_jobs = deepcopy(ready_jobs)
            for job in inactive_jobs['jobs']: job['enabled'] = False
            changes['jobs.json'] = encoded(inactive_jobs)
            card_paths = {i.filename[len(SOURCE_PREFIX):] for i in inventory
                          if i.filename.startswith(SOURCE_PREFIX + 'drivers/mcp/')}
            if card_paths != {'drivers/mcp/' + key + '.yaml' for key in DRIVERS}:
                raise ValueError('unexpected_source_driver_files')
            cards_dir = output / 'ready-cards'; cards_dir.mkdir()
            for key in sorted(DRIVERS):
                relative = 'drivers/mcp/' + key + '.yaml'
                path = cards_dir / (key + '.yaml')
                path.write_bytes(archive.read(SOURCE_PREFIX + relative))
                card = load_card(path)
                if not card.enabled or card.name != key or card.protocol != 'mcp' or card.credentials:
                    raise ValueError('source_driver_requires_separate_migration')
                client = ready['mcp']['clients'][key]
                endpoint = {k: client[k] for k in ('transport', 'command', 'args', 'env')}
                card = replace(card, endpoint=endpoint)
                dump_card(card, path)
                ready_cards[key] = hashlib.sha256(path.read_bytes()).hexdigest()
                inactive_path = output / ('inactive-' + key + '.yaml')
                dump_card(replace(card, enabled=False), inactive_path)
                changes[relative] = inactive_path.read_bytes()
                inactive_path.unlink()
            new_meta = meta.model_copy(update={
                'id': 'qd-engineer-migration-' + expected_sha256[:16],
                'name': 'Single engineer native host migration', 'signature': None,
                'accepted_via_trust': None,
                'description': 'Transformed local copy of ' + meta.id + '; source SHA256 ' + expected_sha256
                               + '; operations:mc-god -> game:qd-engineer; jobs and MCP initially disabled.'})
            target = output / 'qd-engineer-quarantined.zip'
            with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as dest:
                dest.writestr('meta.json', new_meta.model_dump_json(indent=2))
                for info in inventory:
                    if info.filename == 'meta.json': continue
                    relative = info.filename[len(SOURCE_PREFIX):]
                    new_info = deepcopy(info); new_info.filename = TARGET_PREFIX + relative
                    if relative in changes:
                        dest.writestr(new_info, changes[relative])
                    else:
                        digest = hashlib.sha256()
                        with archive.open(info) as inp, dest.open(new_info, 'w') as out:
                            while chunk := inp.read(1024 * 1024): digest.update(chunk); out.write(chunk)
                        preserved[relative] = digest.hexdigest()
            # Verify every supposedly preserved byte from the emitted archive.
            with zipfile.ZipFile(target) as verify:
                if any(n.startswith(SOURCE_PREFIX) for n in verify.namelist()): raise ValueError('old_native_id_in_archive_path')
                for relative, expected in preserved.items():
                    digest = hashlib.sha256()
                    with verify.open(TARGET_PREFIX + relative) as stream:
                        while chunk := stream.read(1024 * 1024): digest.update(chunk)
                    if digest.hexdigest() != expected: raise ValueError('migration_preservation_failed')
            restore = RestoreBackupRequest(include_agents=True, agent_ids=[TARGET_ROLE],
                include_global_config=False, include_secrets=False, include_skill_pool=False,
                mode='custom', preserve_local_protected_config=True)
            report = {'schema': 1, 'ok': True, 'phase': 'staged-not-imported',
                'createdAt': datetime.now(timezone.utc).isoformat(), 'logicalActor': 'operations:mc-god',
                'sourceBackupSha256': expected_sha256, 'sourceBackupUnchanged': sha_file(source) == expected_sha256,
                'sourceInventoryVerified': source_inventory is not None,
                'priorJobEnableStatesRestored': prior_jobs is not None,
                'targetBackupId': new_meta.id, 'archiveSha256': sha_file(target),
                'targetWorkspace': TARGET_WORKSPACE, 'changedWorkspaceFiles': sorted(changes),
                'preservedFiles': preserved, 'readyCards': ready_cards,
                'nativeImport': {'endpoint': '/api/backups/import', 'trust_mode': 'legacy',
                                 'reason': 'This transformed archive is intentionally unsigned; original signature is preserved only on source.'},
                'nativeRestore': restore.model_dump(mode='json', exclude_none=True),
                'schedulingQuarantined': True, 'driversQuarantined': True,
                'modelCalls': 0, 'productionMutations': 0,
                'next': 'Root must verify target provider, retire source role, import/restore target, apply ready native profiles/cards while jobs remain paused, activate exact host mapping and then enable only the retained schedules.'}
            (output / 'migration.json').write_bytes(encoded(report))
            return report
    except BaseException as exc:
        code = str(exc) if type(exc) is ValueError and re.fullmatch(r'[a-z_]+(?::[a-z_]+)?', str(exc)) else 'staging_failed'
        (output / 'failed.json').write_bytes(encoded({'ok': False, 'errorType': type(exc).__name__,
            'code': code, 'productionMutations': 0}))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory-workspace', type=Path)
    parser.add_argument('--source-backup', type=Path)
    parser.add_argument('--source-inventory', type=Path)
    parser.add_argument('--prior-jobs', type=Path)
    parser.add_argument('--expected-source-sha256')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.inventory_workspace:
            if args.source_backup or args.source_inventory or args.expected_source_sha256 or args.prior_jobs:
                parser.error('inventory and archive staging are separate operations')
            if args.output.resolve().is_relative_to(args.inventory_workspace.resolve()):
                raise ValueError('inventory_output_must_be_outside_source')
            result = workspace_inventory(args.inventory_workspace)
            with unlinked(args.output).open('xb') as stream: stream.write(encoded(result))
            print(json.dumps({'ok': True, 'inventoryFiles': len(result['files']), 'productionMutations': 0}))
            raise SystemExit(0)
        if not args.source_backup or not args.source_inventory or not args.expected_source_sha256 or not args.prior_jobs:
            parser.error('staging requires source-backup, source-inventory, prior-jobs and expected-source-sha256')
        result = stage(args.source_backup, args.output, args.expected_source_sha256,
            json.loads(unlinked(args.source_inventory).read_text(encoding='utf-8-sig')),
            json.loads(unlinked(args.prior_jobs).read_text(encoding='utf-8-sig')))
        print(json.dumps({key: result[key] for key in ('ok', 'phase', 'archiveSha256', 'changedWorkspaceFiles',
            'sourceBackupUnchanged', 'schedulingQuarantined', 'driversQuarantined', 'modelCalls', 'productionMutations')}))
    except Exception as exc:
        print(json.dumps({'ok': False, 'errorType': type(exc).__name__, 'code': 'staging_failed',
                          'productionMutations': 0}))
        raise SystemExit(1)
