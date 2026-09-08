"""Move the real survivor into the game console, preserving sessions and usage.

Check is read-only. Execute requires both exact project Qwen/survivor containers
stopped and the controller paused with no outstanding work. All original files
are retained in a private backup; no existing game model/provider is overwritten.
"""
from __future__ import annotations

import argparse
import base64
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from mcp_server import TOOL_NAMES

ROLE = 'qd-survivor'
PROVIDER = 'qd-survivor-codingplan'
DRIVER = 'numen_survival'
CLIENT_URL = 'http://survivor:8089/mcp'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.survivor-migration.tmp')
    if temporary.exists():
        raise ValueError('partial_migration_write_exists')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    temporary.chmod(0o600)
    temporary.replace(path)


def require_stopped(run=subprocess.run):
    for name in ('qiandengji-survivor-1', 'qiandengji-qwenpaw-1'):
        result = run(['docker', 'inspect', '--format', '{{.State.Running}}', name],
                     capture_output=True, text=True, timeout=15)
        if result.returncode or result.stdout.strip() != 'false':
            raise ValueError('project_runtime_must_be_stopped')


def merge_usage(existing, source):
    result = copy.deepcopy(existing)
    requests = 0
    for day, records in source.items():
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) or not isinstance(records, dict):
            raise ValueError('invalid_usage_schema')
        for key, record in records.items():
            if record.get('agent_id') != ROLE:
                if record.get('call_count', 0):
                    raise ValueError('unscoped_source_usage')
                continue
            if key in result.get(day, {}):
                raise ValueError('survivor_usage_already_present')
            if not isinstance(record.get('call_count'), int) or record['call_count'] < 0:
                raise ValueError('invalid_usage_counter')
            result.setdefault(day, {})[key] = copy.deepcopy(record)
            requests += record['call_count']
    return result, requests


def http_card(names):
    # JSON is a YAML subset; Qwen's native DriverCard loader validates this file.
    return {'name': DRIVER, 'protocol': 'mcp', 'enabled': True,
        'endpoint': {'transport': 'streamable_http', 'url': CLIENT_URL,
            'headers': {'Authorization': {'source': 'credential', 'credential': 'survivor_env',
                'field': 'value', 'format': 'Bearer {value}'}}},
        'credentials': {'survivor_env': {'kind': 'static', 'ref': 'env:SURVIVOR_MCP_TOKEN'}},
        'config': {'display_name': '桐人世界感知与技能', 'description': '共享游戏角色的独立身体执行器'},
        'policy': {'default_effect': 'deny', 'rules': [
            {'subject': '*', 'effect': 'allow', 'target': {'kind': 'tool', 'name': name}}
            for name in names]}}


def plan(source, target):
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve():
        raise ValueError('source_equals_target')
    if (source / 'game-migration.json').exists() or (target / 'work/survivor-migration.json').exists():
        raise ValueError('migration_already_recorded')
    config = read(target / 'work/config.json')
    if {aid for aid, ref in config['agents']['profiles'].items() if ref.get('enabled')} != {'mc-god', 'mc-herald'}:
        raise ValueError('unexpected_game_roles')
    if ROLE in config['agents']['profiles'] or (target / 'work/workspaces' / ROLE).exists():
        raise ValueError('target_role_already_exists')
    folder = source / 'work/workspaces' / ROLE
    agent = read(folder / 'agent.json')
    if agent.get('id') != ROLE or agent.get('workspace_dir') != '/state/work/workspaces/' + ROLE:
        raise ValueError('source_role_identity_invalid')
    # No symlink/reparse traversal when copying model workspace/history.
    if any(p.is_symlink() for p in [folder, *folder.rglob('*')]):
        raise ValueError('workspace_symlink_not_supported')
    selected = agent.get('active_model', {})
    pid = selected.get('provider_id', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', pid):
        raise ValueError('invalid_selected_provider')
    candidates = [p for kind in ('builtin', 'custom')
                  if (p := source / 'secret/providers' / kind / (pid + '.json')).is_file()]
    if len(candidates) != 1:
        raise ValueError('ambiguous_source_provider')
    provider = read(candidates[0])
    if any((target / 'secret/providers' / kind / (PROVIDER + '.json')).exists()
           for kind in ('builtin', 'custom')):
        raise ValueError('dedicated_provider_already_exists')
    key = provider.get('api_key', '')
    if not key.startswith('ENC:'):
        raise ValueError('source_provider_not_encrypted')
    old_master = (source / 'secret/.master_key').read_text(encoding='ascii').strip()
    new_master = (target / 'secret/.master_key').read_text(encoding='ascii').strip()
    plain = Fernet(base64.urlsafe_b64encode(bytes.fromhex(old_master))).decrypt(key[4:].encode())
    provider['api_key'] = 'ENC:' + Fernet(base64.urlsafe_b64encode(bytes.fromhex(new_master))).encrypt(plain).decode()
    provider.update(id=PROVIDER, name='桐人 Coding Plan', is_custom=True)
    if provider.get('generate_kwargs', {}).get('max_tokens') != 2048:
        raise ValueError('survivor_generation_budget_changed')
    usage, requests = merge_usage(read(target / 'work/token_usage.json'),
                                 read(source / 'work/token_usage.json'))
    agent['active_model']['provider_id'] = PROVIDER
    agent['mcp'] = {'clients': {DRIVER: {'name': DRIVER, 'enabled': True,
        'transport': 'streamable_http', 'url': CLIENT_URL,
        'headers': {'Authorization': 'Bearer ${SURVIVOR_MCP_TOKEN}'},
        'tools': list(TOOL_NAMES)}}}
    config['agents']['profiles'][ROLE] = {'id': ROLE, 'workspace_dir': agent['workspace_dir'],
                                         'enabled': True, 'pinned': False}
    order = config['agents'].get('agent_order', [])
    config['agents']['agent_order'] = [*order, ROLE]
    token_path = source / 'mcp-token'
    token = token_path.read_text(encoding='ascii').strip() if token_path.exists() else secrets.token_urlsafe(48)
    if not 32 <= len(token) <= 256 or any(c.isspace() for c in token):
        raise ValueError('invalid_existing_mcp_token')
    return {'config': config, 'agent': agent, 'provider': provider, 'usage': usage,
            'requests': requests, 'token': token, 'providerSource': candidates[0]}


def migrate(source=None, target=None, backups=None, execute=False, run=subprocess.run):
    source = Path(source or ROOT / 'server/survival-agent-state').resolve()
    target = Path(target or ROOT / 'server/agents').resolve()
    default_backups = backups is None
    backups = Path(backups or ROOT / 'runtime/survivor-game-migration-backups').resolve()
    if default_backups and not backups.is_relative_to((ROOT / 'runtime').resolve()):
        raise ValueError('backup_outside_project_runtime')
    if backups.is_relative_to(source) or backups.is_relative_to(target):
        raise ValueError('backup_inside_live_state')
    prepared = plan(source, target)
    summary = {'project': 'qiandengji-survivor', 'ok': True, 'mode': 'execute' if execute else 'check',
        'role': ROLE, 'console': 'http://127.0.0.1:18089/agents',
        'model': prepared['agent']['active_model'], 'preservedModelRequests': prepared['requests'],
        'preservedGameRoles': ['mc-god', 'mc-herald'], 'modelCalls': 0, 'worldActionsExecuted': 0}
    if not execute:
        return summary
    require_stopped(run)
    control = read(source / 'survival/control.json')
    controller = read(source / 'survival/controller.json')
    if control.get('enabled') is not False or controller.get('active'):
        raise ValueError('survivor_must_be_paused_and_idle')
    if (source / 'survival/unknown.json').exists():
        raise ValueError('unknown_action_must_be_resolved_before_migration')
    job = source / 'survival/skill-job.json'
    if job.exists() and read(job).get('status') in ('pending', 'running', 'dispatching'):
        raise ValueError('skill_must_be_stopped_before_migration')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = backups / stamp
    backup.mkdir(parents=True, exist_ok=False)
    # Copy the two full configs/accounting and exactly the selected role/body state.
    # Credentials never leave ignored local directories or enter reports/stdout.
    for root, label in ((source, 'source'), (target, 'target')):
        for relative in ('work/config.json', 'work/token_usage.json'):
            destination = backup / label / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / relative, destination)
    shutil.copytree(source / 'work/workspaces' / ROLE, backup / 'source/work/workspaces' / ROLE)
    shutil.copytree(source / 'survival', backup / 'source/survival')
    original_game = {aid: (target / 'work/workspaces' / aid / 'agent.json').read_bytes()
                     for aid in ('mc-god', 'mc-herald')}
    hashes = {str(p.relative_to(backup)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in backup.rglob('*') if p.is_file()}
    write(backup / 'manifest.json', {'schema': 1, 'files': hashes, 'source': str(source.resolve()),
                                    'target': str(target.resolve())})
    target_role = target / 'work/workspaces' / ROLE
    shutil.copytree(source / 'work/workspaces' / ROLE, target_role)
    write(target_role / 'agent.json', prepared['agent'])
    write(target_role / 'drivers/mcp' / (DRIVER + '.yaml'), http_card(TOOL_NAMES))
    (target_role / 'AGENTS.md').write_bytes((ROOT / 'world/survival/AGENT.md').read_bytes())
    (target_role / 'PROFILE.md').write_text('# 桐人\n\n真实角色 qd-survivor；身体 Kirito；'
        '游戏 QwenPaw 18089 统一会话，独立 survivor 调度和执行。\n', encoding='utf8')
    write(target / 'secret/providers/custom' / (PROVIDER + '.json'), prepared['provider'])
    write(target / 'work/token_usage.json', prepared['usage'])
    if not (source / 'mcp-token').exists():
        (source / 'mcp-token').write_text(prepared['token'], encoding='ascii')
        (source / 'mcp-token').chmod(0o600)
    source_config = read(source / 'work/config.json')
    source_config['agents']['profiles'][ROLE]['enabled'] = False
    write(source / 'work/config.json', source_config)
    write(target / 'work/config.json', prepared['config'])
    manifest = {**summary, 'schema': 1, 'backup': str(backup.resolve()),
                'completedAt': datetime.now(timezone.utc).isoformat(),
                'sourceNativeRoleDisabled': True, 'sourceBodyStateRetained': True}
    write(source / 'game-migration.json', manifest)
    write(target / 'work/survivor-migration.json', manifest)
    for aid, original in original_game.items():
        assert (target / 'work/workspaces' / aid / 'agent.json').read_bytes() == original
    return manifest


def sync_role(source=None, target=None, backups=None, run=subprocess.run):
    """Refresh the paused migrated role's tool contract/prompt, never its model."""
    source = Path(source or ROOT / 'server/survival-agent-state').resolve()
    target = Path(target or ROOT / 'server/agents').resolve()
    default_backups = backups is None
    backups = Path(backups or ROOT / 'runtime/survivor-game-migration-backups').resolve()
    if default_backups and not backups.is_relative_to((ROOT / 'runtime').resolve()):
        raise ValueError('backup_outside_project_runtime')
    if backups.is_relative_to(source) or backups.is_relative_to(target):
        raise ValueError('backup_inside_live_state')
    require_stopped(run)
    if not (source / 'game-migration.json').is_file() or not (target / 'work/survivor-migration.json').is_file():
        raise ValueError('shared_migration_required')
    if read(source / 'survival/control.json').get('enabled') is not False or read(source / 'survival/controller.json').get('active'):
        raise ValueError('survivor_must_be_paused_and_idle')
    config = read(target / 'work/config.json')
    enabled_roles = {aid for aid, ref in config['agents']['profiles'].items() if ref.get('enabled')}
    base_roles = {'mc-god', 'mc-herald', ROLE}
    if enabled_roles not in (base_roles, base_roles | {'qd-villager-dialogue', 'qd-guild-planner', 'qd-maid-dialogue'}):
        raise ValueError('unexpected_game_roles')
    folder = target / 'work/workspaces' / ROLE
    agent = read(folder / 'agent.json')
    if agent.get('id') != ROLE or agent.get('workspace_dir') != '/state/work/workspaces/' + ROLE:
        raise ValueError('source_role_identity_invalid')
    client = agent.get('mcp', {}).get('clients', {}).get(DRIVER, {})
    if (client.get('transport') != 'streamable_http' or client.get('url') != CLIENT_URL
            or client.get('headers') != {'Authorization': 'Bearer ${SURVIVOR_MCP_TOKEN}'}):
        raise ValueError('unexpected_shared_mcp_binding')
    protected = {path: path.read_bytes() for path in [target / 'work/config.json', target / 'work/token_usage.json',
        *(target / 'work/workspaces' / aid / 'agent.json' for aid in enabled_roles - {ROLE})]}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-sync'
    backup = backups / stamp
    backup.mkdir(parents=True, exist_ok=False)
    for relative in ('agent.json', 'AGENTS.md', 'drivers/mcp/numen_survival.yaml'):
        destination = backup / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(folder / relative, destination)
    client['tools'] = list(TOOL_NAMES)
    write(folder / 'agent.json', agent)
    write(folder / 'drivers/mcp/numen_survival.yaml', http_card(TOOL_NAMES))
    (folder / 'AGENTS.md').write_bytes((ROOT / 'world/survival/AGENT.md').read_bytes())
    for path, original in protected.items():
        assert path.read_bytes() == original
    report = {'schema': 1, 'project': 'qiandengji-survivor', 'ok': True, 'mode': 'sync', 'role': ROLE,
        'tools': list(TOOL_NAMES), 'modelPreserved': True, 'usagePreserved': True, 'sessionsPreserved': True,
        'backup': str(backup), 'updatedAt': datetime.now(timezone.utc).isoformat(),
        'modelCalls': 0, 'worldActionsExecuted': 0}
    write(backup / 'manifest.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--execute', choices=['qiandengji'])
    mode.add_argument('--sync', choices=['qiandengji'], help='Refresh an already migrated role while both runtimes are stopped')
    args = parser.parse_args()
    try:
        result = sync_role() if args.sync else migrate(execute=bool(args.execute))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        # Never echo upstream text or provider payloads containing credentials.
        code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r'[a-z_]+', str(exc)) else type(exc).__name__
        print(json.dumps({'project': 'qiandengji-survivor', 'ok': False, 'error': code,
                          'modelCalls': 0, 'worldActionsExecuted': 0}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
