"""The shared console's survivor role is limited to its authenticated driver."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('shared_game_health', ROOT / 'world/ops/qwenpaw_health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
from role_learning_profiles import with_learning
from test_role_learning_profiles import learning_fixture, native_fixture_lock
import native_role_capabilities as native


class SharedGameRoleHealthTests(unittest.TestCase):
    def setUp(self):
        native_patch = patch.object(native, 'native_lock', return_value=native_fixture_lock())
        native_patch.start(); self.addCleanup(native_patch.stop)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name) / 'qd-survivor'; self.folder.mkdir()
        self.token = self.folder / 'mcp-token'
        self.token.write_text('f' * 64)
        names = ['status', 'look', 'skill_draft', 'skill_test', 'skill_promote', 'remember']
        self.agent = {'id': 'qd-survivor', 'name': '桐人', 'tools': {'builtin_tools': {'shell': {'enabled': False}}},
            'acp': {'agents': {}}, 'fallback_models': [], 'fallback_policy': {'enabled': False},
            'heartbeat': {'enabled': False}, 'running': {'llm_max_concurrent': 1, 'llm_max_qpm': 4,
            'max_iters': 6, 'llm_retry_enabled': False}, 'mcp': {'clients': {'numen_survival': {
                'enabled': True, 'transport': 'streamable_http', 'url': 'http://survivor:8089/mcp',
                'headers': {'Authorization': 'Bearer ${SURVIVOR_MCP_TOKEN}'}, 'tools': names}}}}
        self.card = SimpleNamespace(enabled=True, endpoint={'transport': 'streamable_http',
            'url': 'http://survivor:8089/mcp', 'headers': {'Authorization': {'source': 'credential',
                'credential': 'token', 'format': 'Bearer {value}'}}},
            credentials={'token': SimpleNamespace(ref='env:SURVIVOR_MCP_TOKEN')},
            policy=SimpleNamespace(default_effect='deny', rules=[SimpleNamespace(
                effect='allow', subject='*', target=SimpleNamespace(name=name, kind='tool')) for name in names]))
        (self.folder / 'drivers/mcp').mkdir(parents=True)
        (self.folder / 'drivers/mcp/numen_survival.yaml').write_text('fixture')
        self.agent = with_learning(self.agent, 'qd-survivor', 'game')
        learning_fixture(self.folder, 'qd-survivor')

    def check(self):
        (self.folder / 'agent.json').write_text(json.dumps(self.agent), encoding='utf8')
        storage = SimpleNamespace(load_card=lambda path: self.party_card if Path(path).stem == 'qd_party' else self.card)
        credentials = SimpleNamespace(AsyncCredentialStore=lambda _: SimpleNamespace(get_sync=lambda name:
            SimpleNamespace(kind='static', secrets={'authorization':'Bearer '+'f'*64}, public={})))
        with patch.dict(sys.modules, {'qwenpaw.drivers.storage': storage, 'qwenpaw.drivers.credentials':credentials}), \
             patch.dict(health.os.environ, {'SURVIVOR_MCP_TOKEN_FILE': str(self.token)}):
            health.check_survivor_config(self.folder)

    def test_real_six_roles_and_scoped_http_config_are_required(self):
        self.assertEqual(health.GAME_ROLES, {'mc-god', 'mc-herald', 'qd-survivor',
            'qd-villager-dialogue', 'qd-guild-planner', 'qd-maid-dialogue'})
        self.check()

    def test_shell_and_stdio_cannot_be_added_to_survivor(self):
        self.agent['tools']['builtin_tools']['shell']['enabled'] = True
        with self.assertRaises(AssertionError):
            self.check()
        self.agent['tools']['builtin_tools']['shell']['enabled'] = False
        self.agent['mcp']['clients']['numen_survival']['transport'] = 'stdio'
        with self.assertRaises(AssertionError):
            self.check()

    def test_model_iterations_must_be_twelve_in_both_native_fields(self):
        valid = copy.deepcopy(self.agent)
        for field in ('max_iters', 'max_iterations', 'enabled'):
            self.agent = copy.deepcopy(valid)
            target = self.agent['running'] if field == 'max_iters' else self.agent['running']['loop']['iteration']
            target[field] = False if field == 'enabled' else 6
            with self.subTest(field=field), self.assertRaises(AssertionError): self.check()

    def test_other_mcp_endpoint_or_wildcard_permissions_fail(self):
        self.card.endpoint['url'] = 'http://other-agent:8089/mcp'
        with self.assertRaises(AssertionError):
            self.check()
        self.card.endpoint['url'] = 'http://survivor:8089/mcp'
        self.card.policy.default_effect = 'allow'
        with self.assertRaises(AssertionError):
            self.check()

    def test_docker_health_reads_secret_file_without_entrypoint_environment(self):
        with patch.dict(health.os.environ, {}, clear=True):
            self.check()
        self.token.write_text('bad')
        with self.assertRaises(AssertionError):
            self.check()

    def test_bound_survivor_requires_real_party_card_and_keeps_body_rules_strict(self):
        from test_party_role_capabilities import manifest, card_fixture
        path = self.folder / 'party-roles.json'
        path.write_text(json.dumps(manifest()))
        maids = self.folder / 'maid-roles.json'
        maids.write_text(json.dumps({'schema':1, 'bindingsValid':True, 'independentSessions':True,
                                    'registeredCount':1, 'activeRoleIds':['fixture-maid']}))
        self.party_card = card_fixture()
        with patch.dict(health.os.environ, {'PARTY_ROLES_MANIFEST_FILE':str(path), 'MAID_ROLES_MANIFEST_FILE':str(maids)}):
            learning_fixture(self.folder, 'qd-survivor')
            with self.assertRaises(AssertionError): self.check()
            (self.folder / 'drivers/mcp/qd_party.yaml').write_text('native fixture')
            self.check()  # Native API Card needs no legacy MCP duplicate.
            self.party_card.policy.default_effect = 'allow'
            with self.assertRaises(AssertionError): self.check()
            self.party_card.policy.default_effect = 'deny'
            self.card.policy.default_effect = 'allow'
            with self.assertRaises(AssertionError): self.check()

    def test_unbound_survivor_cannot_gain_party_card_or_legacy_client(self):
        from test_party_role_capabilities import card_fixture, party
        self.party_card = card_fixture()
        (self.folder / 'drivers/mcp/qd_party.yaml').write_text('unexpected card')
        with self.assertRaises(AssertionError): self.check()
        (self.folder / 'drivers/mcp/qd_party.yaml').unlink()
        self.agent['mcp']['clients']['qd_party'] = party.client_payload('Bearer '+'f'*64)
        with self.assertRaises(AssertionError): self.check()


if __name__ == '__main__':
    unittest.main()
