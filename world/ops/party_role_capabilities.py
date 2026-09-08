"""Exact optional party-driver contract; no provider, profile, or runtime edits.

Only a public manifest naming the survivor and one registered independent maid
permits qd_party. Provisioners use the native MCP API with client_payload and
policy_payload; credentials must be encrypted by that API, never written into
the manifest or a hand-built DriverCard. Passing these checks does not prove a
conversation, body action, or audible speech succeeded.
"""
import json
import os
from pathlib import Path
import re
import uuid

DRIVER = 'qd_party'
URL = 'http://npc:8091/party/mcp'
TOOLS = ('party_status', 'party_send', 'party_message_read')
MANIFEST_ENV = 'PARTY_ROLES_MANIFEST_FILE'
DEFAULT_MANIFEST = '/party-roles/roles.json'


def party_members(path=None, registered_maids=None):
    explicit = path is not None or MANIFEST_ENV in os.environ
    if path is None:
        path = os.environ.get(MANIFEST_ENV, DEFAULT_MANIFEST)
    assert isinstance(path, (str, Path)) and str(path), 'party manifest path missing'
    path = Path(path)
    assert not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                   for p in (path, *path.parents)), 'linked party manifest'
    if not path.exists():
        assert not explicit, 'configured party manifest missing'
        return ()
    assert path.is_file() and 0 < path.stat().st_size <= 16384, 'party manifest invalid'
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    assert isinstance(value, dict) and set(value) == {'schema', 'enabled', 'partyId', 'revision', 'members'}
    assert type(value['schema']) is int and value['schema'] == 1 and value['enabled'] is True
    assert type(value['revision']) is int and 1 <= value['revision'] <= 10**12
    assert isinstance(value['partyId'], str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', value['partyId'])
    members = value['members']
    assert isinstance(members, list) and len(members) == 2
    if registered_maids is None:
        from role_learning_profiles import maid_roles
        registered_maids = maid_roles()
    for row in members:
        assert isinstance(row, dict) and set(row) == {'agentId', 'bodyUuid', 'displayName', 'kind'}
        assert isinstance(row['agentId'], str) and re.fullmatch(r'[A-Za-z0-9_-]{4,64}', row['agentId'])
        assert isinstance(row['bodyUuid'], str) and str(uuid.UUID(row['bodyUuid'])) == row['bodyUuid']
        assert isinstance(row['displayName'], str) and 1 <= len(row['displayName']) <= 160 and row['displayName'].strip()
        assert '\0' not in row['displayName']
        assert ((row['kind'] == 'survivor' and row['agentId'] == 'qd-survivor')
                or (row['kind'] == 'maid' and row['agentId'] in registered_maids))
    assert {row['kind'] for row in members} == {'survivor', 'maid'}
    assert len({row['agentId'] for row in members}) == len({row['bodyUuid'] for row in members}) == 2
    return tuple(dict(row) for row in sorted(members, key=lambda row: row['agentId']))


def party_roles():
    return {member['agentId'] for member in party_members()}


def expected_drivers(role, base_drivers):
    from world_team_profiles import expected_drivers as team_drivers
    party = set(base_drivers) | ({DRIVER} if role in party_roles() else set())
    return team_drivers(role, 'game', party) if isinstance(role, str) else party


def _authorization(value):
    assert isinstance(value, str) and value.startswith('Bearer ')
    token = value.removeprefix('Bearer ')
    assert re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token), 'invalid party authorization'


def client_payload(authorization):
    """Client field for native POST /mcp; do not persist this plaintext payload."""
    _authorization(authorization)
    return {'name': '千灯纪队伍消息', 'enabled': True, 'transport': 'streamable_http',
            'url': URL, 'headers': {'Authorization': authorization}, 'tools': list(TOOLS)}


def policy_payload():
    """Body for native PUT /mcp/policy/qd_party."""
    return {'default_effect': 'deny', 'client_overrides': [], 'tool_defaults': [],
            'tool_overrides': [{'source_type': 'channel', 'source_value': 'console', 'subject_type': 'all',
                               'subject_value': '', 'effect': 'allow', 'tool_name': name} for name in TOOLS]}


def _client(client, authorization=None):
    assert isinstance(client, dict) and client.get('enabled') is True
    assert client.get('transport') == 'streamable_http' and client.get('url') == URL
    assert not any(client.get(key) for key in ('command', 'args', 'env', 'cwd'))
    assert isinstance(client.get('tools'), list) and len(client['tools']) == len(TOOLS) and set(client['tools']) == set(TOOLS)
    assert isinstance(client.get('headers'), dict) and set(client['headers']) == {'Authorization'}
    if authorization is not None:
        assert client['headers'] == {'Authorization': authorization}
    else:
        # The public native API may redact the value. The credential store is
        # checked separately; never accept an extra header/endpoint override.
        assert isinstance(client['headers']['Authorization'], str) and client['headers']['Authorization']


def check_party_card(card, authorization, legacy_client=None):
    _authorization(authorization)
    assert card.name == DRIVER and card.protocol == 'mcp' and card.enabled is True
    assert set(card.endpoint) == {'transport', 'url', 'headers'}
    assert card.endpoint['transport'] == 'streamable_http' and card.endpoint['url'] == URL
    assert card.endpoint['headers'] == {'Authorization': {
        'source': 'credential', 'credential': 'static', 'field': 'authorization'}}
    assert set(card.credentials) == {'static'}
    assert card.credentials['static'].kind == 'static' and card.credentials['static'].ref == 'mcp/qd_party'
    names = card.config.get('tools')
    assert isinstance(names, list) and len(names) == len(TOOLS) and set(names) == set(TOOLS)
    assert card.policy.default_effect == 'deny' and len(card.policy.rules) == len(TOOLS)
    seen = set()
    for rule in card.policy.rules:
        assert rule.subject == '*' and rule.effect == 'allow' and rule.target.kind == 'tool'
        assert rule.target.name in TOOLS and rule.target.name not in seen and rule.condition is None
        principal = rule.principal
        assert principal is not None and principal.source_type == 'channel' and principal.source_value == 'console'
        assert principal.subject_type == 'all' and principal.subject_value == ''
        seen.add(rule.target.name)
    if legacy_client is not None:
        _client(legacy_client, authorization)


def check_party_workspace(folder, role, agent, card_paths):
    """The Card is mandatory for a member; a legacy client duplicate is optional."""
    folder = Path(folder)
    path = folder / 'drivers/mcp/qd_party.yaml'
    clients = agent['mcp']['clients']
    if role not in party_roles():
        assert DRIVER not in clients and path not in set(card_paths), 'unbound party driver'
        return False
    assert path in set(card_paths), 'bound party driver missing'
    from qwenpaw.drivers.storage import load_card
    from qwenpaw.drivers.credentials import AsyncCredentialStore
    credential = AsyncCredentialStore(folder / 'credentials.yaml').get_sync('mcp/qd_party')
    assert credential.kind == 'static' and set(credential.secrets) == {'authorization'} and not credential.public
    check_party_card(load_card(path), credential.secrets['authorization'], clients.get(DRIVER))
    return True


def check_party_inventory(get, role, base_drivers):
    inventory = get('/mcp', aid=role)
    expected = expected_drivers(role, base_drivers)
    assert isinstance(inventory, list) and len(inventory) == len(expected)
    assert {row.get('key') for row in inventory} == expected


def check_party_api(get, role):
    assert role in party_roles(), 'unbound party role'
    client = get('/mcp/' + DRIVER, aid=role)
    _client(client)
    policy = get('/mcp/policy/' + DRIVER, aid=role)
    expected = policy_payload()
    assert policy.get('default_effect') == 'deny' and policy.get('client_overrides') == []
    assert policy.get('tool_defaults') == [] and policy.get('unmanaged_rules_count') == 0
    overrides = policy.get('tool_overrides')
    assert isinstance(overrides, list) and len(overrides) == len(TOOLS)
    assert all(row in expected['tool_overrides'] for row in overrides)
    assert {row.get('tool_name') for row in overrides} == set(TOOLS)
    tools = get('/mcp/tools/' + DRIVER, aid=role)
    assert isinstance(tools, list) and len(tools) == len(TOOLS)
    assert {row.get('name') for row in tools if row.get('enabled') is True} == set(TOOLS)
