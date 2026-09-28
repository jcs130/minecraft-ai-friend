"""Offline, scoped tool-list update; never changes personas, models or services.

Default mode is a read-only plan. --apply requires the two exact containers
stopped and the original survivor drained. Only two config files can be written,
with original bytes backed up privately before any replacement.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from mcp_server import TOOL_NAMES

ROLE = 'qd-survivor'
DRIVER = 'numen_survival'
ENDPOINT = 'http://survivor:8089/mcp'
FOLDER = Path('server/agents/work/workspaces') / ROLE
FILES = (FOLDER / 'agent.json', FOLDER / 'drivers/mcp/numen_survival.yaml')
PERSONAL_FILES = ('AGENTS.md', 'SOUL.md', 'PROFILE.md', 'MEMORY.md', 'skill.json')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(root, relative):
    root, path = Path(root).absolute(), Path(root).absolute() / relative
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_survivor_config_path')
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('survivor_config_outside_project')
    return path


def read_document(path, maximum=1048576):
    raw = path.read_bytes()
    if len(raw) > maximum:
        raise ValueError('survivor_config_too_large')
    value = json.loads(raw.decode('utf-8-sig')) if path.suffix == '.json' else yaml.safe_load(raw.decode('utf-8-sig'))
    if not isinstance(value, dict):
        raise ValueError('invalid_survivor_config')
    return raw, value


def desired_documents(agent, card):
    names = list(TOOL_NAMES)
    if len(names) < 45 or len(set(names)) != len(names) or not {'drop_items', 'say', 'say_status'} <= set(names):
        raise ValueError('review_survivor_tool_contract')
    if agent.get('id') != ROLE or agent.get('workspace_dir') != '/state/work/workspaces/' + ROLE:
        raise ValueError('wrong_survivor_role')
    client = agent['mcp']['clients'][DRIVER]
    if (client.get('enabled') is not True or client.get('transport') != 'streamable_http'
            or client.get('url') != ENDPOINT
            or client.get('headers') != {'Authorization': 'Bearer ${SURVIVOR_MCP_TOKEN}'}):
        raise ValueError('survivor_legacy_driver_changed')
    if (card.get('name') != DRIVER or card.get('protocol') != 'mcp' or card.get('enabled') is not True
            or card.get('endpoint') != {'transport': 'streamable_http', 'url': ENDPOINT,
                'headers': {'Authorization': {'source': 'credential', 'credential': 'survivor_env',
                                              'field': 'value', 'format': 'Bearer {value}'}}}
            or card.get('credentials') != {'survivor_env': {'kind': 'static', 'ref': 'env:SURVIVOR_MCP_TOKEN'}}):
        raise ValueError('survivor_native_driver_changed')
    old = client.get('tools')
    accepted = (set(names), set(names) - {'navigate_plan'}, set(names) - {'drop_items'},
                set(names) - {'say', 'say_status'}, set(names) - {'navigate'},
                set(names) - {'navigate', 'navigate_plan', 'say', 'say_status'})
    card_tools = card.get('config', {}).get('tools')
    if (not isinstance(old, list) or not all(isinstance(name, str) for name in old)
            or len(set(old)) != len(old) or set(old) not in accepted
            or not isinstance(card_tools, list) or len(set(card_tools)) != len(card_tools)
            or not (card_tools == old or
                set(old) == set(names) - {'navigate', 'navigate_plan', 'say', 'say_status'}
                and set(card_tools) == set(names) - {'navigate_plan'})):
        raise ValueError('survivor_tool_scope_not_known')
    policy = card.get('policy', {})
    rules = policy.get('rules')
    if policy.get('default_effect') != 'deny' or not isinstance(rules, list) or len(rules) != len(card_tools):
        raise ValueError('survivor_native_policy_changed')
    rule_names = []
    for rule in rules:
        if (not isinstance(rule, dict) or set(rule) - {'subject', 'effect', 'target', 'principal', 'condition'}
                or rule.get('subject') != '*' or rule.get('effect') != 'allow'
                or set(rule.get('target', {})) != {'kind', 'name'} or rule['target']['kind'] != 'tool'
                or rule.get('condition') is not None
                or ('principal' in rule and rule['principal'] != {'source_type': '*', 'source_value': '*',
                                                                'subject_type': '*', 'subject_value': '*'})):
            raise ValueError('survivor_native_policy_changed')
        rule_names.append(rule['target']['name'])
    if len(set(rule_names)) != len(card_tools) or set(rule_names) != set(card_tools):
        raise ValueError('survivor_native_policy_scope_changed')
    updated_agent, updated_card = deepcopy(agent), deepcopy(card)
    updated_agent['mcp']['clients'][DRIVER]['tools'] = names
    updated_card['config']['tools'] = names
    for name in names:
        if name not in rule_names:
            rule = deepcopy(rules[0]); rule['target']['name'] = name
            updated_card['policy']['rules'].append(rule)
    # Only these three managed leaves may differ. Preserve every existing rule.
    compare_agent, compare_card = deepcopy(updated_agent), deepcopy(updated_card)
    compare_agent['mcp']['clients'][DRIVER]['tools'] = old
    compare_card['config']['tools'] = card['config']['tools']
    compare_card['policy']['rules'] = card['policy']['rules']
    if compare_agent != agent or compare_card != card or updated_card['policy']['rules'][:len(rules)] != rules:
        raise ValueError('survivor_sync_exceeded_scope')
    return updated_agent, updated_card, [name for name in names if name not in card_tools]


def require_stopped(root, run=subprocess.run):
    services = ('qwenpaw', 'survivor')
    names = ['qiandengji-' + service + '-1' for service in services]
    result = run(['docker', 'inspect', *names], capture_output=True, text=True,
                 encoding='utf-8', errors='replace', timeout=15,
                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('exact_project_containers_must_exist_and_be_stopped')
    containers = json.loads(result.stdout)
    if not isinstance(containers, list) or len(containers) != 2:
        raise ValueError('exact_project_containers_must_exist_and_be_stopped')
    proof = []
    for service, name, container in zip(services, names, containers):
        labels = container.get('Config', {}).get('Labels', {}) or {}
        state = container.get('State', {})
        if (container.get('Name') != '/' + name or labels.get('com.docker.compose.project') != 'qiandengji'
                or labels.get('com.docker.compose.service') != service
                or state.get('Running') is not False or state.get('Paused') is not False
                or state.get('Restarting') is not False or state.get('Status') not in ('exited', 'created')):
            raise ValueError('exact_project_containers_must_be_stopped')
        target = safe_path(root, Path('server/agents' if service == 'qwenpaw' else 'server/survival-agent-state'))
        mounts = [mount for mount in container.get('Mounts', []) if mount.get('Destination') == '/state']
        if (len(mounts) != 1 or mounts[0].get('Type') != 'bind'
                or Path(mounts[0].get('Source', '')).resolve() != target.resolve()):
            raise ValueError('container_uses_other_project_state')
        proof.append({'name': name, 'id': container['Id'], 'status': state['Status']})
    return proof


def require_idle(root):
    state = Path('server/survival-agent-state/survival')
    control = read_document(safe_path(root, state / 'control.json'))[1]
    controller = read_document(safe_path(root, state / 'controller.json'), 2 * 1024 * 1024)[1]
    if (control.get('schema') != 1 or control.get('enabled') is not False
            or controller.get('status') != 'paused' or controller.get('active')
            or controller.get('actionExecution', {}).get('inFlight')):
        raise ValueError('survivor_must_be_paused_and_idle')
    if safe_path(root, state / 'unknown.json').exists():
        raise ValueError('survivor_unknown_must_be_reconciled')
    if safe_path(root, state / 'inflight-action.json').exists():
        raise ValueError('survivor_action_must_be_idle')
    job = safe_path(root, state / 'skill-job.json')
    if job.exists() and read_document(job)[1].get('status') not in ('done', 'replan', 'paused', 'completed', 'failed', 'cancelled'):
        raise ValueError('survivor_skill_must_be_idle')
    lease = safe_path(root, state / 'lease.json')
    if lease.exists():
        item = read_document(lease)[1]
        exhausted = (item.get('status') == 'used' and type(item.get('actionLimit')) is int
                     and item['actionLimit'] in (1, 6) and type(item.get('actionsUsed')) is int
                     and item['actionsUsed'] == item['actionLimit'])
        if item.get('status') not in ('closed', 'revoked', 'expired') and not exhausted:
            raise ValueError('survivor_lease_must_be_closed')
    return {'paused': True, 'activeDecision': False, 'unknown': False}


def atomic_bytes(path, raw):
    temporary = path.with_name(path.name + '.scope-' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def sync(root=ROOT, *, apply=False, run=subprocess.run):
    root = Path(root).absolute()
    paths = [safe_path(root, relative) for relative in FILES]
    old_raw, documents = zip(*(read_document(path) for path in paths))
    agent, card, added = desired_documents(*documents)
    values = (agent, card)
    changed = [i for i in range(2) if values[i] != documents[i]]
    report = {'schema': 1, 'ok': True, 'mode': 'apply' if apply else 'plan', 'role': ROLE,
              'toolCount': len(TOOL_NAMES), 'addedTools': added, 'modelCalls': 0, 'worldActions': 0,
              'changedFiles': [str(FILES[i]).replace('\\', '/') for i in changed],
              'allowedJsonPaths': ['agent.json:/mcp/clients/numen_survival/tools',
                                   'drivers/mcp/numen_survival.yaml:/config/tools',
                                   'drivers/mcp/numen_survival.yaml:/policy/rules (append only)'],
              'otherFieldsPreserved': True, 'startsOrStopsServices': False}
    if not apply:
        report['applyRequires'] = ['exact_qwenpaw_and_survivor_stopped', 'paused_idle_no_unknown', 'private_original_backup']
        return report
    report['containers'] = require_stopped(root, run)
    report['bodyState'] = require_idle(root)
    if not changed:
        report['changed'] = False
        return report
    personal = {name: digest(safe_path(root, FOLDER / name).read_bytes())
                for name in PERSONAL_FILES if safe_path(root, FOLDER / name).exists()}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = safe_path(root, Path('runtime/survivor-driver-scope-backups') / stamp)
    backup.mkdir(parents=True, exist_ok=False)
    originals = {}
    for i in changed:
        destination = backup / ('agent.json' if i == 0 else 'numen_survival.yaml')
        destination.write_bytes(old_raw[i]); destination.chmod(0o600)
        if digest(destination.read_bytes()) != digest(old_raw[i]):
            raise ValueError('survivor_scope_backup_not_verified')
        originals[str(FILES[i]).replace('\\', '/')] = digest(old_raw[i])
    report.update(backup=str(backup), changed=True, originalSha256=originals, preservedPersonalSha256=personal,
                  phase='backed_up')
    manifest = backup / 'manifest.json'
    atomic_bytes(manifest, (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode())
    require_stopped(root, run); require_idle(root)
    if any(path.read_bytes() != old_raw[i] for i, path in enumerate(paths)):
        raise ValueError('survivor_config_changed_during_plan')
    try:
        for i in changed:
            # JSON is valid YAML and preserves native credential references.
            atomic_bytes(paths[i], (json.dumps(values[i], ensure_ascii=False, indent=2) + '\n').encode())
        if any(read_document(path)[1] != values[i] for i, path in enumerate(paths)):
            raise ValueError('survivor_scope_readback_failed')
        if any(digest(safe_path(root, FOLDER / name).read_bytes()) != sha for name, sha in personal.items()):
            raise ValueError('survivor_personal_file_changed')
    except Exception:
        # Config-only rollback to exact original bytes; services remain stopped.
        for i in changed:
            atomic_bytes(paths[i], old_raw[i])
        report['phase'] = 'rolled_back'
        atomic_bytes(manifest, (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode())
        raise
    report.update(phase='verified', updatedSha256={str(FILES[i]).replace('\\', '/'): digest(paths[i].read_bytes()) for i in changed})
    atomic_bytes(manifest, (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode())
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Update only the stopped original survivor MCP scope')
    args = parser.parse_args()
    print(json.dumps(sync(apply=args.apply), ensure_ascii=False, indent=2))
