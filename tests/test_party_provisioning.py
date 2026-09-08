"""Provisioning/health fixtures never contact a game server or model endpoint."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


configure = load('party_configure_qa', 'configure_survivor_party.py')
health = load('party_health_qa', 'party_health.py')
smoke = load('party_smoke_health_qa', 'smoke_survivor_party.py')
from qwen_tasks import write_json, read_json
from party_role_capabilities import policy_payload, TOOLS


class ProvisioningFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.maid_uuid, self.body_uuid, self.owner_uuid = [str(uuid.UUID(int=n)) for n in (2, 1, 3)]
        self.settings = {'bodyUuid': self.body_uuid, 'ownerUuid': self.owner_uuid}
        self.life = {'schema': 1, 'agentId': 'qd-survivor', 'bodyUuid': self.body_uuid,
            'primarySessionId': 'life-' + uuid.UUID(int=4).hex,
            'userId': 'survival-controller', 'channel': 'console', 'chatId': str(uuid.UUID(int=5))}
        self.state = self.root / 'server/survival-agent-state/survival'
        write_json(self.state / 'settings.json', self.settings)
        write_json(self.state / 'life-session.json', self.life)
        self.maid = {'schema': 1, 'status': 'ready', 'agentId': 'maid-test', 'maidUuid': self.maid_uuid,
            'ownerUuid': self.body_uuid, 'generation': 'a' * 12,
            'sessionId': 'maid-' + self.maid_uuid + '-' + 'a' * 12, 'mcpToken': 'registry_' * 8}
        self.registry_root = self.root / 'server/mcdata/village/maid-agents'
        self.registry = SimpleNamespace(path=lambda body: self.registry_root / 'bindings' / (body + '.json'))
        self.ensured = []
        def ensure(identity, **kwargs):
            self.ensured.append(kwargs)
            write_json(self.registry.path(self.maid_uuid), self.maid)
            return deepcopy(self.maid)
        def publish():
            write_json(self.registry_root / 'public/roles.json', {'activeRoleIds': ['maid-test']})
        self.registry.ensure, self.registry.publish = ensure, publish
        self.native = SimpleNamespace(discover=lambda: [{'maidUuid': self.maid_uuid, 'ownerUuid': self.body_uuid}])
        self.clients, self.policies, self.calls = {}, {}, []
        self.fail_after_create = False
        self.model = {'provider_id': 'fixture-provider', 'model': 'fixture-model'}
        self.patches = [patch.object(configure, 'ROOT', self.root), patch.object(health, 'ROOT', self.root),
            patch.object(configure, 'MaidRegistry', return_value=self.registry),
            patch.object(configure, 'NativeRcon', return_value=lambda command: self.fail('RCON not allowed')),
            patch.object(configure, 'MaidNativeTools', return_value=self.native),
            patch.object(configure, 'api', side_effect=self.api)]
        for p in self.patches:
            p.start(); self.addCleanup(p.stop)

    def api(self, method, path, role, body=None):
        self.calls.append((method, path, role))
        if method == 'GET' and path == '/agents/' + role:
            return {'id': role, 'active_model': deepcopy(self.model)}
        if method == 'GET' and path == '/mcp':
            return [{'key': key} for r, key in self.clients if r == role]
        if method == 'GET' and path == '/mcp/tools/qd_party':
            return [{'name': name, 'enabled': True} for name in TOOLS]
        if method == 'POST' and path == '/mcp':
            self.assertEqual(set(body), {'client_key', 'client'})
            self.assertEqual(body['client_key'], 'qd_party')
            key = (role, 'qd_party')
            self.assertNotIn(key, self.clients, 'Unknown create must be recovered with GET, never copied again')
            self.clients[key] = deepcopy(body['client'])
            self.policies[role] = {'default_effect': 'deny', 'tool_overrides': [], 'client_overrides': [],
                                   'tool_defaults': [], 'unmanaged_rules_count': 0}
            if self.fail_after_create:
                self.fail_after_create = False
                raise TimeoutError('fixture lost create acknowledgement')
            return self.client_info(role)
        if path == '/mcp/qd_party':
            if method == 'PUT': self.clients[(role, 'qd_party')] = deepcopy(body)
            elif method != 'GET': self.fail('Unexpected client mutation')
            return self.client_info(role)
        if path == '/mcp/policy/qd_party':
            if method == 'PUT': self.policies[role] = deepcopy(body) | {'unmanaged_rules_count': 0}
            elif method != 'GET': self.fail('Unexpected policy mutation')
            return deepcopy(self.policies[role])
        self.fail('Unexpected API call: ' + str((method, path, role)))

    def client_info(self, role):
        return deepcopy(self.clients[(role, 'qd_party')]) | {'key': 'qd_party', 'headers': {'Authorization': 'MASKED'}}

    def apply(self):
        return configure.prepare(self.maid_uuid, apply=True, name='小灯')


class ConfigurePartyTests(ProvisioningFixture):
    def test_current_roster_keeps_history_binding_and_excludes_session_credentials(self):
        from party_config import PartyConfig
        self.apply()
        party_root = self.root / 'server/mcdata/village/party'
        config = PartyConfig(party_root)
        before = config.binding()
        private = config.private()
        next(m for m in private['members'] if m['kind'] == 'maid')['displayName'] = '结衣'
        write_json(party_root / 'binding.json', private)
        roster = config.roster()
        self.assertEqual(next(m for m in roster if m['agentId'] == 'maid-test')['displayName'], '结衣')
        self.assertTrue(all(set(m) == {'agentId', 'bodyUuid', 'displayName'} for m in roster))
        self.assertEqual(config.binding(), before)

    def test_read_only_default_has_no_registration_or_configuration_writes(self):
        result = configure.prepare(self.maid_uuid)
        self.assertTrue(result['ok'])
        self.assertEqual(self.ensured, [])
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / 'server/mcdata/village/party').exists())

    def test_native_create_and_masked_idempotent_update_preserve_tokens_and_models(self):
        self.assertTrue(self.apply()['ok'])
        path = self.root / 'server/mcdata/village/party/binding.json'
        before = path.read_bytes()
        self.assertTrue(self.apply()['ok'])
        self.assertEqual(before, path.read_bytes())
        self.assertEqual(len([c for c in self.calls if c[:2] == ('POST', '/mcp')]), 2)
        self.assertFalse(any(c[0] != 'GET' and c[1].startswith('/agents/') for c in self.calls))
        for role in ('qd-survivor', 'maid-test'):
            self.assertEqual(self.policies[role], policy_payload() | {'unmanaged_rules_count': 0})
        self.assertNotIn('mcpToken', json.dumps(self.apply()))

    def test_unknown_driver_create_is_reconciled_from_saved_identity(self):
        self.fail_after_create = True
        with self.assertRaises(TimeoutError): self.apply()
        path = self.root / 'server/mcdata/village/party/binding.json'
        before = path.read_bytes()
        self.assertFalse(path.with_name('public').joinpath('roles.json').exists())
        self.assertTrue(self.apply()['ok'])
        self.assertEqual(before, path.read_bytes())
        self.assertEqual(len([c for c in self.calls if c[:2] == ('POST', '/mcp')]), 2)

    def test_foreign_endpoint_or_unmanaged_policy_is_not_overwritten(self):
        self.apply()
        self.clients[('qd-survivor', 'qd_party')]['url'] = 'http://unrelated.invalid/mcp'
        self.calls.clear()
        with self.assertRaisesRegex(ValueError, 'existing_party_driver_differs'): self.apply()
        self.assertFalse(any(c[0] in ('PUT', 'POST') for c in self.calls))
        self.clients[('qd-survivor', 'qd_party')]['url'] = configure.PARTY_URL
        self.policies['qd-survivor']['unmanaged_rules_count'] = 1
        with self.assertRaisesRegex(ValueError, 'party_driver_unmanaged_policy'): self.apply()

    def test_invalid_life_identity_cannot_register_new_character(self):
        self.life['userId'] = 'other-user'
        write_json(self.state / 'life-session.json', self.life)
        with self.assertRaisesRegex(ValueError, 'survivor_life_binding_invalid'): self.apply()
        self.assertEqual(self.ensured, [])
        self.assertEqual(self.calls, [])


class PartyHealthTests(ProvisioningFixture):
    def setUp(self):
        super().setUp()
        self.apply()
        self.config = read_json(self.root / 'server/mcdata/village/party/binding.json')
        self.members = [{k: m[k] for k in ('agentId', 'bodyUuid', 'displayName', 'kind')} for m in self.config['members']]
        for member in self.members:
            write_json(self.root / 'server/agents/work/workspaces' / member['agentId'] / 'skill.json',
                       {'skills': {'qd-party-cooperation': {'enabled': True}}})
        self.now = 100000
        self.public = {'schema': 1, 'enabled': True, 'status': 'running', 'error': None,
                       'updatedAt': self.now * 1000, 'partyId': self.config['partyId'], 'members': self.members}
        self.panel = {'available': True, 'enabled': True, 'stale': False, 'status': 'running', 'error': None,
                      'members': [{k: m[k] for k in ('agentId', 'displayName', 'kind')} for m in self.members]}
        self.report = {'schema': 1, 'ok': True, 'partyId': self.config['partyId'], 'bindingRevision': self.config['revision'],
            'transport': 'game_channel_v1',
            'members': [{k: m[k] for k in ('agentId', 'bodyUuid')} for m in self.members],
            'lifeSession': {k: self.life[k] for k in ('primarySessionId', 'userId', 'channel')},
            'checks': {k: True for k in ('same_life_session', 'maid_owned_by_kirito', 'party_request_answer', 'native_tools_active', 'game_world_communication')}}
        self.assertGreaterEqual(len(smoke.BEHAVIOR_SOURCES), 13)
        for name in smoke.BEHAVIOR_SOURCES:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture only: ' + name, encoding='utf-8')
        self.report['behaviorSourceHashes'] = smoke.behavior_source_hashes(self.root)
        self.save()

    def save(self):
        write_json(self.root / 'server/panel-state/party.json', self.public)
        write_json(self.root / 'reports/survivor-party-smoke.json', self.report)

    def get(self, url, role=None):
        if url == 'http://127.0.0.1:19091/api/state': return {'party': deepcopy(self.panel)}
        self.assertIn(role, ('qd-survivor', 'maid-test'))
        if url.endswith('/mcp/tools/qd_party'): return [{'name': name, 'enabled': True} for name in TOOLS]
        if url.endswith('/mcp/qd_party'): return self.client_info(role)
        if url.endswith('/mcp/policy/qd_party'): return deepcopy(self.policies[role])
        self.fail('Unexpected read-only API request: ' + url)

    def probe(self):
        before = list(sys.path)
        with patch.object(health, 'get', side_effect=self.get), patch.object(health.time, 'time', return_value=self.now):
            result = health.check()
        self.assertEqual(sys.path, before)
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(result['worldActions'], 0)
        self.assertNotIn('mcpToken', json.dumps(result))
        return result

    def test_live_binding_policy_session_and_correlated_evidence_pass(self):
        self.assertTrue(self.probe()['ok'])

    def test_running_dispatch_error_is_not_hidden_by_fresh_heartbeat(self):
        self.public.update(status='waiting', error='body_unavailable'); self.save()
        self.assertFalse(self.probe()['checks']['supervised_dispatch_fresh'])

    def test_policy_default_allow_is_not_equal_to_enabled_tools(self):
        self.policies['maid-test']['default_effect'] = 'allow'
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertTrue(result['checks']['maid_party_tools'])
        self.assertFalse(result['checks']['maid_party_policy'])

    def test_old_success_report_does_not_cover_different_binding_or_session(self):
        for field, value in (('bindingRevision', 2), ('partyId', 'other-party'), ('members', []),
                             ('lifeSession', {**self.report['lifeSession'], 'primarySessionId': 'old-life'})):
            with self.subTest(field=field):
                saved = deepcopy(self.report)
                self.report[field] = value; self.save()
                result = self.probe()
                self.assertTrue(result['checks']['verified_behavior'])
                self.assertFalse(result['checks']['behavior_matches_binding'])
                self.report = saved

    def test_private_session_drift_and_panel_member_substitution_fail(self):
        self.life['primarySessionId'] = 'life-' + uuid.UUID(int=7).hex
        write_json(self.state / 'life-session.json', self.life)
        self.assertFalse(self.probe()['checks']['persistent_life_identity'])
        self.panel['members'][1]['agentId'] = 'unrelated-maid'
        self.assertFalse(self.probe()['checks']['panel_party_live'])

    def test_old_transport_missing_world_check_and_stale_source_hashes_fail(self):
        for change in ({'transport': 'queue_only_v0'}, {'behaviorSourceHashes': {}},
                       {'checks': {k: v for k, v in self.report['checks'].items() if k != 'game_world_communication'}}):
            with self.subTest(change=change):
                before = deepcopy(self.report)
                self.report.update(change); self.save()
                self.assertFalse(self.probe()['ok'])
                self.report = before
        self.save()
        (self.root / smoke.BEHAVIOR_SOURCES[0]).write_text('changed implementation', encoding='utf8')
        self.assertFalse(self.probe()['checks']['verified_game_transport'])

    def test_importlib_health_load_resolves_real_tools_without_callers_sys_path(self):
        tools_path = str(ROOT / 'tools')
        before = list(sys.path)
        try:
            sys.path[:] = [item for item in sys.path if item != tools_path]
            previous = sys.modules.pop('smoke_survivor_party', None)
            try:
                self.assertTrue(self.probe()['ok'])
            finally:
                if previous is not None:
                    sys.modules['smoke_survivor_party'] = previous
        finally:
            sys.path[:] = before


if __name__ == '__main__': unittest.main()
