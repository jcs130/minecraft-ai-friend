"""Shared-game boot supervises one body driver, without a second Qwen instance."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    item = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(item)
    return item


game_service = module('game_service_fixture', ROOT / 'world/survival/game_service.py')
with patch.dict(sys.modules, {'fcntl': SimpleNamespace()}):
    service = module('survival_service_fixture', ROOT / 'world/survival/service.py')


class SharedSurvivalServiceTests(unittest.TestCase):
    def test_default_launches_http_mcp_and_never_second_qwen(self):
        self.assertEqual(service.child_command({}), ['python', '-u', '/survival/mcp_server.py', '--http'])
        with self.assertRaisesRegex(ValueError, 'invalid_qwen_mode'):
            service.child_command({'SURVIVOR_QWEN_MODE': 'other'})

    def test_migrated_old_state_cannot_be_started_as_embedded_agent(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(service, 'STATE', Path(tmp) / 'survival'):
            (Path(tmp) / 'game-migration.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'cannot_run_embedded'):
                service.child_command({'SURVIVOR_QWEN_MODE': 'embedded'})

    def test_game_entrypoint_injects_only_secret_in_child_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'token'
            path.write_text('s' * 64)
            original = {'SURVIVOR_MCP_TOKEN_FILE': str(path), 'KEEP': 'same'}
            result = game_service.environment(original)
            self.assertEqual(result['SURVIVOR_MCP_TOKEN'], 's' * 64)
            self.assertEqual(result['KEEP'], 'same')
            self.assertNotIn('SURVIVOR_MCP_TOKEN', original)
            path.write_text('short')
            with self.assertRaisesRegex(ValueError, 'invalid_survivor_mcp_token'):
                game_service.environment(original)

    def test_readiness_requires_real_qwen_role_and_live_mcp_child(self):
        values = [{'status': 'ok', 'agents_loaded': ['mc-god', 'mc-herald', 'qd-survivor']}, {'ok': True}]
        with patch.object(service.urllib.request, 'urlopen', side_effect=[io.BytesIO(json.dumps(x).encode()) for x in values]) as call:
            self.assertTrue(service.readiness({}))
            self.assertEqual(call.call_args_list[0].args[0], 'http://qwenpaw:8088/api/healthz')
            self.assertEqual(call.call_args_list[1].args[0], 'http://127.0.0.1:8089/livez')
        with patch.object(service.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"status":"ok","agents_loaded":["mc-god"]}')):
            self.assertFalse(service.readiness({}))


if __name__ == '__main__':
    unittest.main()
