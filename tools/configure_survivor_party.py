"""Register one real Kirito-owned maid and its two fixed-party native Drivers.

Default is read-only. No spawning, owner transfers, provider changes or model
calls. The original Numen body and normal in-game adoption must exist first.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import shutil
import sys
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from maid_registry import MaidRegistry
from maid_native_tools import MaidNativeTools, NativeRcon
from qwen_tasks import read_json, write_json, NoRedirect
from party_config import PartyConfig, PARTY_TOOLS, PARTY_URL
from party_messages import validate_binding
from mcp_configuration import configure_client


def api(method, path, role, body=None):
    request = urllib.request.Request('http://127.0.0.1:18089/api' + path, method=method,
        headers={'X-Agent-Id': role, 'Content-Type': 'application/json'},
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode('utf8'))
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=25) as response:
        value = response.read(262145)
    if len(value) > 262144:
        raise ValueError('native_reply_too_large')
    return json.loads(value)


def prepare(maid_uuid, *, apply=False, name='小灯', persona=None):
    if str(uuid.UUID(maid_uuid)) != maid_uuid:
        raise ValueError('invalid_maid_uuid')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(c in name for c in '\0\r\n'):
        raise ValueError('invalid_party_display_name')
    settings = read_json(ROOT / 'server/survival-agent-state/survival/settings.json')
    life = read_json(ROOT / 'server/survival-agent-state/survival/life-session.json')
    if (life.get('bodyUuid') != settings['bodyUuid'] or life.get('agentId') != 'qd-survivor'
            or life.get('userId') != 'survival-controller' or life.get('channel') != 'console'
            or not isinstance(life.get('primarySessionId'), str)
            or not life['primarySessionId'].startswith('life-')):
        raise ValueError('survivor_life_binding_invalid')
    uuid.UUID(life['primarySessionId'][5:])
    registry = MaidRegistry(ROOT / 'server/mcdata/village/maid-agents', transport=api)
    native = MaidNativeTools(registry, run=NativeRcon('127.0.0.1', 25577, ROOT / 'server/world-data/rcon-secret.txt'))
    found = [m for m in native.discover() if m['maidUuid'] == maid_uuid]
    if len(found) != 1 or found[0].get('ownerUuid') != settings['bodyUuid']:
        raise ValueError('loaded_kirito_owned_maid_required')
    identity = found[0]
    if not apply:
        return {'ok': True, 'mode': 'check', 'bodyLoaded': True, 'ownerVerified': True,
                'alreadyRegistered': registry.path(maid_uuid).exists(), 'modelCalls': 0, 'worldActions': 0}
    if registry.path(maid_uuid).exists():
        maid = registry.ensure(identity)
    else:
        maid = registry.ensure(identity, name=name, persona=persona or (
            '你叫小灯，是桐人的旅行伙伴。你开朗、细心，也有自己的判断与好奇心。'
            '愿意一起探索、准备营地、收集材料和照顾彼此，但会根据真实装备与能力提出分工或不同意见。'
            '用简短自然的中文交流，把自己的发现和经验记在个人资料里。慢慢形成自己的偏好。'))
    root = ROOT / 'server/mcdata/village/party'
    config_path = root / 'binding.json'
    members = [dict(agentId='qd-survivor', bodyUuid=settings['bodyUuid'], ownerUuid=settings['ownerUuid'],
                    sessionId=life['primarySessionId'], userId=life['userId'], channel=life['channel'],
                    displayName='桐人', kind='survivor'),
               dict(agentId=maid['agentId'], bodyUuid=maid['maidUuid'], ownerUuid=maid['ownerUuid'],
                    sessionId=maid['sessionId'], userId='maid-' + maid_uuid, channel='console',
                    displayName=name, kind='maid')]
    if config_path.exists():
        config = PartyConfig(root).private()
        for desired in members:
            saved = next((m for m in config['members'] if m['agentId'] == desired['agentId']), None)
            if saved is None or any(saved[k] != desired[k] for k in ('bodyUuid', 'ownerUuid', 'sessionId', 'userId', 'channel', 'kind')):
                raise ValueError('existing_party_binding_differs')
    else:
        for m in members:
            m['mcpToken'] = secrets.token_urlsafe(48)
        config = {'schema': 1, 'enabled': True, 'partyId': 'kirito-travel-party', 'revision': 1,
                  'members': members, 'limits': {'dailyDispatchCap': 24, 'cooldownSeconds': 60,
                    'maxPending': 16, 'maxTextChars': 160, 'maxTtlSeconds': 86400, 'maxMessages': 10000}}
        validate_binding(config)
        write_json(config_path, config)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = root / 'backups' / stamp
    backup.mkdir(parents=True)
    write_json(backup / 'binding.json', config)
    for member in config['members']:
        role = member['agentId']
        current = api('GET', '/agents/' + role, role)
        write_json(backup / (role + '.json'), current)
        # Console responses mask secret values. Preserve the native encrypted
        # store and card before reconciling this managed client's fixed token.
        folder = ROOT / 'server/agents/work/workspaces' / role
        for relative in ('credentials.yaml', 'drivers/mcp/qd_party.yaml'):
            path = folder / relative
            if path.exists():
                if path.is_symlink() or not path.resolve().is_relative_to(folder.resolve()):
                    raise ValueError('linked_party_driver_backup')
                target = backup / role / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
        client = {'name': '冒险小队交流', 'enabled': True, 'transport': 'streamable_http',
                  'url': PARTY_URL, 'headers': {'Authorization': 'Bearer ' + member['mcpToken']}, 'tools': list(PARTY_TOOLS)}
        inventory = api('GET', '/mcp', role)
        if not isinstance(inventory, list) or any(not isinstance(c, dict) for c in inventory):
            raise ValueError('party_driver_inventory_invalid')
        exists = any(c.get('key') == 'qd_party' for c in inventory)
        if exists:
            saved = api('GET', '/mcp/qd_party', role)
            if (any(saved.get(k) != client[k] for k in ('transport', 'url'))
                    or set(saved.get('headers', {})) != {'Authorization'}
                    or any(saved.get(k) for k in ('command', 'args', 'env', 'cwd'))):
                raise ValueError('existing_party_driver_differs')
            write_json(backup / (role + '-party-client.json'), saved)
            prior_policy = api('GET', '/mcp/policy/qd_party', role)
            write_json(backup / (role + '-party-policy.json'), prior_policy)
            if prior_policy.get('unmanaged_rules_count') != 0:
                raise ValueError('party_driver_unmanaged_policy')
        policy = {'default_effect': 'deny', 'client_overrides': [], 'tool_defaults': [],
                  'tool_overrides': [{'source_type': 'channel', 'source_value': 'console',
                    'subject_type': 'all', 'subject_value': '', 'effect': 'allow', 'tool_name': t} for t in PARTY_TOOLS]}
        configure_client(api, role, 'qd_party', client, policy, exists=exists)
        saved = api('GET', '/mcp/qd_party', role)
        if (saved.get('enabled') is not True or saved.get('transport') != client['transport']
                or saved.get('url') != PARTY_URL or saved.get('name') != client['name']
                or set(saved.get('tools') or []) != set(PARTY_TOOLS)
                or len(saved.get('tools') or []) != len(PARTY_TOOLS)):
            raise ValueError('party_driver_not_applied')
        after = api('GET', '/agents/' + role, role)
        if after['active_model'] != current['active_model']:
            raise ValueError('party_changed_model_selection')
    public = {k: config[k] for k in ('schema', 'enabled', 'partyId', 'revision')} | {
        'members': [{k: m[k] for k in ('agentId', 'bodyUuid', 'displayName', 'kind')} for m in config['members']]}
    write_json(root / 'public/roles.json', public)
    registry.publish()
    return {'ok': True, 'mode': 'applied', 'maidAgentId': maid['agentId'], 'members': len(config['members']),
            'modelCalls': 0, 'worldActions': 0, 'newSkillsNeedNativeSync': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--maid-uuid', required=True)
    parser.add_argument('--apply', choices=['qiandengji'])
    parser.add_argument('--name', default='小灯')
    args = parser.parse_args()
    print(json.dumps(prepare(args.maid_uuid, apply=bool(args.apply), name=args.name), ensure_ascii=True))
