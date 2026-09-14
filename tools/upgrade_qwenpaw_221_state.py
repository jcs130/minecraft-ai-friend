"""Migrate only reviewed native skills/permissions in the stopped game state.

Run in a disposable QwenPaw 2.2.1 container with --network none, /state pointing
to the stopped and separately backed-up game volume, and /ops at reviewed code.
The host must verify the game Qwen container is stopped; /proc checks here can
only detect writers in this container's PID namespace. No initializer, app,
model, cron, MCP process, full synchronization or persona generator is invoked.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import uuid

OPS = Path('/ops') if Path('/ops').is_dir() else Path(__file__).resolve().parents[1]/'world/ops'
sys.path.insert(0, str(OPS))
ROLES = frozenset({'mc-god', 'mc-herald', 'qd-survivor', 'qd-villager-dialogue',
    'qd-guild-planner', 'qd-maid-dialogue', '2PZ2gA', '5swvhK', 'qd-engineer', 'qd-steward'})
NATIVE_FIELDS = ('tools', 'security', 'approval_level')
OLD_NATIVE_SHA = {
    'mc-god': '5371345517f9712054463738ce4af8c05ba7c7a044121f59a88aa2da889a7246',
    'mc-herald': 'c9a379f30cefc3fd54ab81e5afcf6edeb09b394fa20e763841e9f213e8fd25b7',
    'qd-survivor': 'a20f4f27551f69ee8fda5fa84d91bd67511ed4002f68928450445cd5375a51a3',
    'qd-villager-dialogue': '3b7b39fd1c5c6b623cece1509ee4f534f61908318b3d6b941e6f9f353f996d9b',
    'qd-guild-planner': '4cba9a4a4ac3fefaae512367d6c2c7a6824e0fe00fff8780e269bd331af4402d',
    'qd-maid-dialogue': '014da19aeece9bceb0d556150d3a05a2d586b7f07160cd04b8a0412bd34c2ca8',
    '2PZ2gA': 'e7140d4fcc073e72f954c0ec4e2638ff376cf89e7a9d3df97ec0ad3d88418687',
    '5swvhK': '27b7e3a769131c68f03a840dbc1ee5a4352e7a68e98828bc16998949680013d5',
    'qd-engineer': 'd4efc309fb6858652f40fd7a4cd6bf237676e4deb688d0a8670476d7e4064dc2',
    'qd-steward': 'eb8793297c90a6e1d4a2548133782722b264c242cc0a772b44dc87673e7ccbce',
}
EVOLUTION_OLD_SHA = '5f6ac2b955db92124d0a78411c4d57296b8c7242b9c34401f69db6e256e50186'
EVOLUTION_NEW_SHA = '2d4c1fa91a0fdd51e318d4555875a706a0bbe46246cdd6747d2ed172d9189a79'
PROMPT_REPLACEMENTS = (
    ('普通流程技能用 materialize_skill 创建（名称不要使用保留的 qd- 前缀）',
     '普通流程技能用官方 make-skill 2.0 的四个本地脚本创建（名称不要使用保留的 qd- 前缀）'),
    ('成熟流程可通过原生 materialize_skill 保存，已启用官方 make-skill 时优先参照其流程。',
     '成熟流程参照已启用的官方 make-skill 2.0，通过四个本地脚本保存并校验。'),
    ('原生 shell 当前只开放本角色已有周任务的 qwenpaw cron list/get/state/pause/resume（显式 --agent-id）',
     '原生 shell 开放本角色已有周任务的 qwenpaw cron list/get/state/pause/resume（显式 --agent-id），'
     '以及官方 make-skill 目录的 create_plan/init_draft/validate_skill/publish_skill 四个脚本；'
     '输入 JSON 用原生文件工具保存到本角色 notes/ 或 drafts/ 下，然后执行 '
     'python -B scripts/<脚本>.py --input /state/work/workspaces/<当前角色>/notes/<输入>.json，'
     'cwd 必须是 /state/work/workspaces/<当前角色>/skills/make-skill，'
     'JSON 的 workspace 也必须是当前角色工作区。publish_skill 只在本工作区安装；不上传市场'),
)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def require_plain(path):
    path = Path(path)
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_migration_path')
    return path


def read_json(path):
    return json.loads(require_plain(path).read_text(encoding='utf8'))


def write_bytes(path, content):
    path = require_plain(path)
    temporary = path.with_name(path.name + '.upgrade221-' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            temporary.chmod(path.stat().st_mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path, value):
    write_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode())


def prompt_bytes(raw):
    """Only three exact known sentences; preserve all other bytes/newlines."""
    result = raw
    for old, new in PROMPT_REPLACEMENTS:
        old, new = old.encode(), new.encode()
        counts = (result.count(old), result.count(new))
        if counts == (1, 0):
            result = result.replace(old, new, 1)
        elif counts != (0, 1):
            raise ValueError('unknown_native_prompt_shape')
    return result


def retained_profile(value):
    return {key: deepcopy(item) for key, item in value.items() if key not in NATIVE_FIELDS}


def propose_profile(before, role):
    from native_role_capabilities import configure_native, validate_native
    if before.get('id') != role or before.get('workspace_dir') != '/state/work/workspaces/' + role:
        raise ValueError('migration_role_identity_mismatch')
    proposed = configure_native(before, role, 'game')
    if retained_profile(proposed) != retained_profile(before):
        raise ValueError('unrelated_profile_fields_changed')
    current_scope = {key: before.get(key) for key in NATIVE_FIELDS}
    if sha(canonical(current_scope)) != OLD_NATIVE_SHA[role] and before != proposed:
        raise ValueError('unreviewed_native_role_settings:' + role)
    validate_native(proposed, role, 'game')
    return proposed


def inventory(root):
    root = require_plain(root)
    result = {}
    # One directory traversal checks each node once. Rechecking all ancestors
    # for every file creates tens of thousands of Docker Desktop bind-mount
    # round trips while adding no assurance after the parent was checked.
    pending = [(root, '')]
    while pending:
        directory, prefix = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.is_symlink() or getattr(os.path, 'isjunction', lambda _: False)(entry.path):
                    raise ValueError('linked_migration_path')
                relative = prefix + entry.name
                if entry.is_dir(follow_symlinks=False):
                    pending.append((Path(entry.path), relative + '/'))
                elif entry.is_file(follow_symlinks=False):
                    raw = Path(entry.path).read_bytes()
                    result[relative] = {'sha256': sha(raw), 'bytes': len(raw)}
    return dict(sorted(result.items()))


def changed_files(before, after):
    return [name for name in sorted(set(before) | set(after)) if before.get(name) != after.get(name)]


def allowed_path(relative):
    from native_role_capabilities import NATIVE_SKILLS
    if relative == 'config.json' or relative == 'skill_pool/skill.json':
        return True
    if any(relative.startswith('skill_pool/' + name + '/') for name in NATIVE_SKILLS):
        return True
    for role in ROLES:
        prefix = 'workspaces/' + role + '/'
        if relative in {prefix + name for name in ('agent.json', 'AGENTS.md', 'skill.json', 'skills/qd-skill-evolution/SKILL.md')}:
            return True
        if any(relative.startswith(prefix + 'skills/' + name + '/') for name in NATIVE_SKILLS):
            return True
    return False


def check_packages(folder, manifest, *, pool=False):
    from native_role_capabilities import NATIVE_SKILLS, directory_hashes, native_lock, native_package_files
    for name in NATIVE_SKILLS:
        native_package_files(name, version='2.2.1')
        target = folder / name
        entry = manifest.get('skills', {}).get(name)
        if not target.exists() and entry is None and pool:
            continue
        if not target.is_dir() or entry is None or entry.get('source') != 'builtin':
            raise ValueError('native_skill_not_reviewed:' + name)
        if pool and entry.get('builtin_language') not in (None, '', 'zh'):
            raise ValueError('native_pool_language_changed:' + name)
        old = {'SKILL.md': native_lock('2.2.0')['skills'][name]['sha256']}
        new = native_lock('2.2.1')['skills'][name]['files']
        if directory_hashes(target) not in (old, new):
            raise ValueError('user_modified_native_package:' + name)


def plan(state, source=OPS):
    from native_role_capabilities import configure_native_scanner
    from party_role_capabilities import party_roles, is_bound_yui
    if party_roles() != {'qd-survivor', '5swvhK'} or not is_bound_yui('game:5swvhK'):
        raise ValueError('original_life_role_bindings_required')
    config = read_json(state/'config.json')
    active = {name for name, ref in config['agents']['profiles'].items() if ref.get('enabled') is True}
    if active != ROLES:
        raise ValueError('game_role_set_changed')
    proposed_config = deepcopy(config)
    scanner = config.get('security', {}).get('skill_scanner', {})
    if scanner.get('mode') != 'block':
        raise ValueError('global_scanner_policy_changed')
    proposed_config['security']['skill_scanner'] = configure_native_scanner(scanner, version='2.2.1')
    evolution = require_plain(source/'skills/qd-skill-evolution/SKILL.md').read_bytes()
    if sha(evolution) != EVOLUTION_NEW_SHA:
        raise ValueError('review_new_evolution_source')
    pool_manifest = read_json(state/'skill_pool/skill.json') if (state/'skill_pool/skill.json').exists() else {'skills': {}}
    check_packages(state/'skill_pool', pool_manifest, pool=True)
    rows = []
    for role in sorted(ROLES):
        folder = state/'workspaces'/role
        before = read_json(folder/'agent.json')
        proposed = propose_profile(before, role)
        manifest = read_json(folder/'skill.json')
        check_packages(folder/'skills', manifest)
        if 'qd-skill-evolution' not in manifest['skills']:
            raise ValueError('evolution_skill_missing:' + role)
        old_evolution = (folder/'skills/qd-skill-evolution/SKILL.md').read_bytes()
        if sha(old_evolution) not in (EVOLUTION_OLD_SHA, EVOLUTION_NEW_SHA):
            raise ValueError('user_modified_evolution_skill:' + role)
        agents = (folder/'AGENTS.md').read_bytes()
        rows.append({'role': role, 'before': before, 'proposed': proposed,
                     'manifest': manifest, 'agents': agents, 'proposedAgents': prompt_bytes(agents),
                     'evolutionChanged': old_evolution != evolution})
    return {'beforeConfig': config, 'config': proposed_config, 'rows': rows, 'evolution': evolution}


def preserve_manifest_settings(before, after, names, *, native_origins=None):
    """Preserve settings/unknown fields; native derived metadata stays fresh."""
    result = deepcopy(after)
    generated = {'metadata', 'requirements', 'updated_at'}
    for name in names:
        old, new = before['skills'][name], after['skills'][name]
        settings = {key: deepcopy(value) for key, value in old.items() if key not in generated}
        if name in (native_origins or {}):
            # The official package now contains the pinned 2.2.1 bytes. Keep
            # its native new provenance, rather than label it as the old build.
            settings['installed_from'] = native_origins[name]
        result['skills'][name] = {**settings, **{key: deepcopy(new[key]) for key in generated if key in new}}
    for name in set(before['skills']) - set(names):
        if after['skills'].get(name) != before['skills'][name]:
            raise ValueError('unrelated_skill_manifest_changed:' + name)
    for key in set(before) | set(after):
        if key != 'skills' and before.get(key) != after.get(key):
            if (key == 'version' and type(before.get(key)) is int and type(after.get(key)) is int
                    and after[key] >= before[key]):
                continue  # Native monotonic mutation timestamp invalidates caches.
            raise ValueError('unrelated_skill_manifest_root_changed')
    return result


def ensure_offline_stopped(state, proc=Path('/proc')):
    from qwenpaw_runtime_contract import release
    from qwenpaw.constant import WORKING_DIR
    if release() != '2.2.1' or Path(state) != Path('/state/work') or Path(WORKING_DIR) != Path(state):
        raise ValueError('require_exact_221_game_container')
    if {name for _, name in socket.if_nameindex()} != {'lo'}:
        raise ValueError('require_network_none')
    if read_json(state.parent/'init-manifest.json').get('project') != 'qiandengji':
        raise ValueError('wrong_game_state')
    for path in proc.glob('[0-9]*/cmdline'):
        try:
            command = path.read_bytes().split(b'\0')
        except (FileNotFoundError, PermissionError):
            continue
        if (b'/survival/game_service.py' in command or b'/ops/learning_service.py' in command
                or (b'app' in command and any(item.endswith(b'qwenpaw') for item in command))
                or any(b'uvicorn qwenpaw.app' in item for item in command)):
            raise ValueError('qwen_app_must_be_stopped')


def migrate(state, backup_root, *, execute=False, source=OPS):
    state, backup_root = require_plain(state).resolve(), require_plain(backup_root).resolve()
    if (backup_root != state.parent/'upgrade-221-backups'
            or backup_root == state or backup_root.is_relative_to(state)):
        raise ValueError('backup_requires_state_upgrade_221_directory')
    ensure_offline_stopped(state)
    proposed = plan(state, source)
    if not execute:
        return {'ok': True, 'preview': True, 'roles': [row['role'] for row in proposed['rows']],
                'packageVersion': '2.2.1', 'modelCalls': 0, 'changesAuthorized': list(NATIVE_FIELDS)}
    from qwenpaw.agents.skill_system.workspace_service import SkillService
    from native_role_capabilities import NATIVE_SKILLS, native_lock
    from native_skill_sync import sync_native_pool, sync_native_skill
    backup = backup_root / ('221-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True, exist_ok=False)
    before_files = inventory(state)
    write_json(backup/'before-files.json', before_files)
    preserved = backup/'original'
    backed_up = {}
    for relative, record in before_files.items():
        if allowed_path(relative):
            target = preserved / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(state/relative, target)
            if sha(target.read_bytes()) != record['sha256']:
                raise ValueError('backup_byte_mismatch')
            backed_up[relative] = record
    write_json(backup/'backup-files.json', backed_up)
    # Re-read exactly the originals we can replace. The final whole-state
    # comparison below separately rejects any unrelated concurrent mutation.
    if any(sha((state/name).read_bytes()) != row['sha256'] for name, row in backed_up.items()):
        raise ValueError('state_changed_while_backing_up')
    report = {'schema': 1, 'project': 'qiandengji', 'ok': False, 'packageVersion': '2.2.1',
              'backup': str(backup), 'startedAt': datetime.now(timezone.utc).isoformat(),
              'modelCalls': 0, 'network': 'none', 'backupFiles': len(backed_up), 'roles': [],
              'hostStopRequired': True, 'writerCheck': 'current-pid-namespace'}
    report['migrationSourceSha256'] = sha(Path(__file__).read_bytes())
    report['nativeSourceSha256'] = {name: sha((OPS/name).read_bytes()) for name in
        ('native_skill_sync.py', 'native_role_capabilities.py', 'native-role-skills.json')}
    after_files = None
    try:
        if proposed['config'] != proposed['beforeConfig']:
            write_json(state/'config.json', proposed['config'])
        report['pool'] = sync_native_pool(state, backup)
        for row in proposed['rows']:
            role = row['role']; folder = state/'workspaces'/role
            if row['proposed'] != row['before']:
                write_json(folder/'agent.json', row['proposed'])
            service = SkillService(folder)
            installed = [sync_native_skill(service, folder, name, backup, version='2.2.1') for name in NATIVE_SKILLS]
            if row['evolutionChanged']:
                result = service.save_skill(skill_name='qd-skill-evolution', content=proposed['evolution'].decode('utf8'))
                if result.get('success') is not True:
                    raise ValueError('native_evolution_save_failed:' + role)
            actual_manifest = read_json(folder/'skill.json')
            origins = {name: 'qwenpaw:2.2.1:' + native_lock('2.2.1')['skills'][name]['source'] for name in NATIVE_SKILLS}
            kept = preserve_manifest_settings(row['manifest'], actual_manifest, [*NATIVE_SKILLS, 'qd-skill-evolution'], native_origins=origins)
            if kept != actual_manifest:
                write_json(folder/'skill.json', kept)
            if row['agents'] != row['proposedAgents']:
                write_bytes(folder/'AGENTS.md', row['proposedAgents'])
            if read_json(folder/'agent.json') != row['proposed']:
                raise ValueError('native_role_readback_mismatch')
            if (folder/'skills/qd-skill-evolution/SKILL.md').read_bytes() != proposed['evolution']:
                raise ValueError('evolution_body_readback_mismatch')
            report['roles'].append({'role': role, 'nativeSkills': installed,
                'settingsChanged': row['before'] != row['proposed'], 'promptChanged': row['agents'] != row['proposedAgents'],
                'evolutionChanged': row['evolutionChanged'], 'unrelatedProfilePreserved': True})
        after_files = inventory(state)
        changes = changed_files(before_files, after_files)
        if any(not allowed_path(name) for name in changes):
            raise ValueError('unexpected_state_file_changed')
        if read_json(state/'config.json') != proposed['config']:
            raise ValueError('unrelated_global_config_changed')
        # A second complete dry plan must produce no configuration/text edits.
        after_plan = plan(state, source)
        if after_plan['config'] != after_plan['beforeConfig'] or any(
                row['before'] != row['proposed'] or row['agents'] != row['proposedAgents']
                or row['evolutionChanged'] for row in after_plan['rows']):
            raise ValueError('migration_not_idempotent')
        report.update(ok=True, changedFiles=changes, untouchedFiles=len(before_files)-len(set(changes)&set(before_files)),
                      originalSessionsMemoryJobsAndPersonaPreserved=True)
    except BaseException as error:
        report['errorType'] = type(error).__name__
        report['error'] = str(error)[:250]
        raise
    finally:
        if after_files is None:
            after_files = inventory(state)
        write_json(backup/'after-files.json', after_files)
        report['observedChangedFiles'] = changed_files(before_files, after_files)
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        write_json(backup/'result.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path('/state/work'))
    parser.add_argument('--backup-root', type=Path, default=Path('/state/upgrade-221-backups'))
    parser.add_argument('--source', type=Path, default=OPS)
    parser.add_argument('--execute', choices=['qiandengji'])
    args = parser.parse_args()
    result = migrate(args.state, args.backup_root, execute=bool(args.execute), source=args.source)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
