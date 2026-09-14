"""Preview native Scroll for the original life pair; --apply needs maintenance.

Only strategy and SQLite history retention change. Complete tool artifacts keep
their existing native retention; Qwen 2.2.1 does not accept zero for that field.
After applying, the operator restarts the drained GAME Qwen process once. Its
official startup hook imports registered sessions. This tool never imports,
rewrites or deletes a session, starts a model, or restarts any service.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar'), str(ROOT / 'world/survival')]
os.environ.setdefault('PARTY_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/party/public/roles.json'))
os.environ.setdefault('MAID_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/maid-agents/public/roles.json'))
from configure_survivor_party import api
from configure_sao_characters import require_idle
from life_context_policy import apply_profile, validate_profile
from party_role_capabilities import party_members
from qwen_tasks import read_json, write_json


def inventory(workspace):
    """File metadata and hashes only; no prompts or session names in output."""
    workspace = Path(workspace)
    files = sorted((workspace / 'sessions').rglob('*.json'))
    digest = hashlib.sha256()
    total = 0
    for path in files:
        if path.is_symlink():
            raise ValueError('session_symlink_not_supported')
        data = path.read_bytes()
        total += len(data)
        digest.update(path.relative_to(workspace).as_posix().encode())
        digest.update(hashlib.sha256(data).digest())
    chats = workspace / 'chats.json'
    if not chats.is_file() or chats.is_symlink():
        raise ValueError('native_chat_registry_required')
    database = workspace / 'history.db'
    return {'sessionFiles': len(files), 'sessionBytes': total, 'sessionInventorySha256': digest.hexdigest(),
            'chatRegistrySha256': hashlib.sha256(chats.read_bytes()).hexdigest(),
            'historyExists': database.exists(), 'historyBytes': database.stat().st_size if database.exists() else 0}


def require_maintenance(root, members, call):
    maid = next(row['agentId'] for row in members if row['kind'] == 'maid')
    require_idle(maid, root=root, call=call)
    admission = read_json(root / 'server/mcdata/village/qwen-tasks/admission.json')
    if (admission.get('schema') != 1 or admission.get('operator') != 'project-maintenance'
            or admission.get('paused') is not True):
        raise ValueError('npc_admission_must_be_paused')
    life = read_json(root / 'server/mcdata/village/party/life/controller.json')
    if life.get('active'):
        raise ValueError('party_life_not_drained')
    jobs = {}
    for member in members:
        role = member['agentId']
        rows = call('GET', '/cron/jobs', role)
        expected = 'qd-life-review-' + role
        if (not isinstance(rows, list) or sum(row.get('id') == expected for row in rows) != 1
                or any(row.get('enabled') is not False for row in rows)):
            raise ValueError('original_life_cron_jobs_must_be_paused')
        jobs[role] = rows
    return jobs


def backup_history(workspace, destination):
    shutil.copytree(workspace / 'sessions', destination / 'sessions')
    shutil.copy2(workspace / 'chats.json', destination / 'chats.json')
    database = workspace / 'history.db'
    if database.exists():
        if database.is_symlink():
            raise ValueError('native_history_symlink_not_supported')
        with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as source:
            with sqlite3.connect(destination / 'history.db') as target:
                source.backup(target)


def configure(*, apply=False, root=ROOT, call=api):
    root = Path(root)
    members = party_members()
    if (len(members) != 2 or {row['kind'] for row in members} != {'survivor', 'maid'}
            or next(row['agentId'] for row in members if row['kind'] == 'survivor') != 'qd-survivor'):
        raise ValueError('original_life_pair_required')
    plans = []
    for member in members:
        role = member['agentId']
        before = call('GET', '/agents/' + role, role)
        proposed = apply_profile(before, role)
        if validate_profile(proposed, role) is not True:
            raise ValueError('unapproved_life_context_role')
        workspace = root / 'server/agents/work/workspaces' / role
        plans.append({'role': role, 'before': before, 'proposed': proposed,
                      'workspace': workspace, 'inventory': inventory(workspace)})
    result = {'ok': True, 'mode': 'apply' if apply else 'preview', 'modelCalls': 0, 'worldActions': 0,
              'retryAutomatically': False, 'migrationExecuted': False,
              'migration': 'official_qwen_startup_hook',
              'roles': [{'role': row['role'], 'changed': row['before'] != row['proposed'],
                         'inventory': row['inventory']} for row in plans]}
    if not apply or all(row['before'] == row['proposed'] for row in plans):
        return result
    jobs = require_maintenance(root, members, call)
    backup = root / 'runtime/life-context-configuration' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    write_json(backup / 'before.json', {'profiles': {row['role']: row['before'] for row in plans},
                                     'jobs': jobs, 'inventory': result['roles']})
    journal = {'steps': [], 'retryAutomatically': False, 'migrationExecuted': False}
    def mark(step):
        journal['steps'].append(step)
        write_json(backup / 'journal.json', journal)
    for row in plans:
        backup_history(row['workspace'], backup / row['role'])
    mark('history_backed_up')
    try:
        # Verify both profiles before writing either; later checks catch rather
        # than overwrite concurrent edits. Unknown writes are never replayed.
        for row in plans:
            if (call('GET', '/agents/' + row['role'], row['role']) != row['before']
                    or inventory(row['workspace']) != row['inventory']):
                raise ValueError('concurrent_life_context_change')
        if require_maintenance(root, members, call) != jobs:
            raise ValueError('concurrent_life_cron_change')
        for row in plans:
            role = row['role']
            if row['before'] != row['proposed']:
                if call('GET', '/agents/' + role, role) != row['before']:
                    raise ValueError('concurrent_life_profile_change')
                mark(role + ':put_started')
                call('PUT', '/agents/' + role, role,
                     {'id': role, 'name': row['before']['name'], 'running': row['proposed']['running']})
            actual = call('GET', '/agents/' + role, role)
            write_json(backup / role / 'profile-after.json', actual)
            if actual != row['proposed'] or inventory(row['workspace']) != row['inventory']:
                raise ValueError('life_context_readback_mismatch')
            mark(role + ':verified')
        if {row['agentId']: call('GET', '/cron/jobs', row['agentId']) for row in members} != jobs:
            raise ValueError('life_cron_changed_during_configuration')
    except Exception as error:
        journal['errorType'] = type(error).__name__
        mark('failed_or_uncertain')
        raise
    result.update(backup=str(backup), configured=True)
    write_json(backup / 'receipt.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(configure(apply=args.apply), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__,
                          'retryAutomatically': False}), file=sys.stderr)
        raise SystemExit(1)
