"""Register/sync quiet QwenPaw game roles; apply only to stopped project services."""
from copy import deepcopy
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from world_agent_profiles import WORLD_ROLES, GAME_ROLES, closed_profile as _closed_profile, validate_workspace as _validate_workspace


# Initial registration stays closed until the separate offline native skill scan
# succeeds. Runtime health never uses this staging-only validation mode.
def closed_profile(original, role):
    return _closed_profile(original, role, learning=False)


def validate_workspace(folder, role):
    return _validate_workspace(folder, role, learning=False)


def safe(path):
    path = Path(path)
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_world_agent_path')
    return path


def read(path):
    path = safe(path)
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('world_agent_config_too_large')
    result = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(result, dict):
        raise ValueError('invalid_world_agent_config')
    return result


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def write(path, data):
    safe(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        tmp.write_bytes(data)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def prepare(state, prompts):
    state, prompts = safe(state), safe(prompts)
    config = read(state / 'work/config.json')
    enabled = {aid for aid, ref in config['agents']['profiles'].items() if ref.get('enabled')}
    if not {'mc-god', 'mc-herald', 'qd-survivor'} <= enabled <= GAME_ROLES:
        raise ValueError('unexpected_game_roles')
    template = read(state / 'work/workspaces/mc-herald/agent.json')
    if template.get('id') != 'mc-herald':
        raise ValueError('source_role_identity_invalid')
    marker_path = state / 'work/world-agents-registration.json'
    marker = read(marker_path) if marker_path.exists() else {}
    if marker and (marker.get('project') != 'qiandengji-world-agents' or marker.get('roles') != list(WORLD_ROLES)):
        raise ValueError('world_agent_registration_mismatch')
    files, created = {}, []
    for role in WORLD_ROLES:
        folder = state / 'work/workspaces' / role
        existing = folder.exists()
        if existing:
            if not marker or role not in config['agents']['profiles']:
                raise ValueError('unowned_world_agent_workspace')
            original = read(folder / 'agent.json')
            if original.get('id') != role or original.get('workspace_dir') != '/state/work/workspaces/' + role:
                raise ValueError('world_agent_identity_mismatch')
            # No unknown driver or job is silently deleted to make sync pass.
            from upgrade_qwenpaw_runtime import driver_cards
            if driver_cards(folder) or read(folder / 'jobs.json').get('jobs'):
                raise ValueError('world_agent_unexpected_driver_or_jobs')
            skills = folder / 'skill.json'
            if skills.exists() and any(x.get('enabled') for x in read(skills).get('skills', {}).values()):
                raise ValueError('world_agent_unexpected_skills')
        else:
            if role in config['agents']['profiles']:
                raise ValueError('world_agent_workspace_missing')
            original = template
            created.append(role)
            files[folder / 'jobs.json'] = encode({'jobs': []})
            files[folder / 'skill.json'] = encode({'skills': {}})
        files[folder / 'agent.json'] = encode(closed_profile(original, role))
        for name in ('AGENTS.md', 'SOUL.md', 'PROFILE.md'):
            source = safe(prompts / role / name)
            files[folder / name] = source.read_bytes()
        ref = deepcopy(config['agents']['profiles'].get(role, {}))
        ref.update(id=role, workspace_dir='/state/work/workspaces/' + role, enabled=True)
        ref.setdefault('pinned', False)
        config['agents']['profiles'][role] = ref
    order = config['agents'].get('agent_order', [])
    config['agents']['agent_order'] = order + [role for role in WORLD_ROLES if role not in order]
    files[state / 'work/config.json'] = encode(config)
    record = {'schema': 1, 'project': 'qiandengji-world-agents', 'roles': list(WORLD_ROLES),
              'initialModelSource': 'mc-herald', 'modelsPreservedOnSync': True}
    files[marker_path] = encode(record)
    for path in files:
        safe(path)
    changed = {path: data for path, data in files.items() if not path.exists() or path.read_bytes() != data}
    return changed, created


def register(state=None, prompts=None, backups=None, survivor=None, apply=False, run=subprocess.run):
    state = safe(Path(state or ROOT / 'server/agents').absolute())
    prompts = Path(prompts or ROOT / 'world/ops/qwenpaw-prompts')
    backups = safe(Path(backups or ROOT / 'runtime/world-agent-registration-backups').absolute())
    survivor = Path(survivor or ROOT / 'server/survival-agent-state/survival')
    if backups.is_relative_to(state) or state.is_relative_to(backups):
        raise ValueError('invalid_world_agent_backup_root')
    changes, created = prepare(state, prompts)
    result = {'project': 'qiandengji-world-agents', 'ok': True, 'mode': 'apply' if apply else 'check',
              'roles': list(WORLD_ROLES), 'createdRoles': created, 'changedFiles': len(changes),
              'existingModelsPreserved': True, 'historyAndUsagePreserved': True,
              'maxIterations': 1, 'maxInputLength': 12000, 'requestedMaxOutputTokens': 2048,
              'outputLimitMode': 'prompt-and-task-route; shared provider not modified', 'modelCalls': 0}
    if not apply:
        return result
    for container in ('qiandengji-qwenpaw-1', 'qiandengji-survivor-1'):
        status = run(['docker', 'inspect', '--format', '{{.State.Running}}', container],
                     capture_output=True, text=True, timeout=15)
        if status.returncode or status.stdout.strip() != 'false':
            raise ValueError('project_runtime_must_be_stopped')
    if read(survivor / 'control.json').get('enabled') is not False or read(survivor / 'controller.json').get('active'):
        raise ValueError('survivor_must_be_paused_and_idle')
    # Re-read after the stopped-state check; never apply a stale planning snapshot.
    changes, created = prepare(state, prompts)
    if changes:
        backup = backups / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup.mkdir(parents=True, exist_ok=False)
        manifest = {'schema': 1, 'files': {}, 'newFiles': []}
        for path in changes:
            relative = path.relative_to(state).as_posix()
            if path.exists():
                target = backup / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                manifest['files'][relative] = hashlib.sha256(path.read_bytes()).hexdigest()
            else:
                manifest['newFiles'].append(relative)
        write(backup / 'manifest.json', encode(manifest))
        # The enabled profile index is committed last while the process is stopped.
        config_path = state / 'work/config.json'
        for path, data in changes.items():
            if path != config_path:
                write(path, data)
        if config_path in changes:
            write(config_path, changes[config_path])
        result['backup'] = str(backup)
    for role in WORLD_ROLES:
        validate_workspace(state / 'work/workspaces' / role, role)
    result.update(createdRoles=created, changedFiles=len(changes))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    try:
        print(json.dumps(register(apply=bool(args.apply)), ensure_ascii=False))
        return 0
    except Exception as exc:
        code = str(exc) if isinstance(exc, ValueError) and re.fullmatch('[a-z_]+', str(exc)) else type(exc).__name__
        print(json.dumps({'ok': False, 'project': 'qiandengji-world-agents', 'code': code, 'modelCalls': 0}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
