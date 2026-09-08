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


class SharedGameRoleHealthTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
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
        (self.folder / 'jobs.json').write_text('{"jobs":[]}')

    def check(self):
        (self.folder / 'agent.json').write_text(json.dumps(self.agent), encoding='utf8')
        storage = SimpleNamespace(load_card=lambda path: self.card)
        with patch.dict(sys.modules, {'qwenpaw.drivers.storage': storage}), \
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


if __name__ == '__main__':
    unittest.main()
