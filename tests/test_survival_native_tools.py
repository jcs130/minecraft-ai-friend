"""Native driver readiness is distinct from both HTTP liveness and saved config."""
import io
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
import native_tools as native


def tools():
    return [{'name': name, 'enabled': True, 'input_schema': {'type': 'object'}} for name in native.TOOL_NAMES]


def saved():
    return {'key': native.DRIVER, 'enabled': True, 'transport': 'streamable_http',
            'url': native.CLIENT_URL, 'tools': list(native.TOOL_NAMES),
            'headers': {'Authorization': 'PRIVATE'}, 'policy': {'preserved': True}}


class NativeToolConnectionTests(unittest.TestCase):
    def test_request_is_agent_scoped_bounded_and_never_submits_a_model(self):
        with patch.object(native.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = io.BytesIO(json.dumps(tools()).encode())
            self.assertTrue(native.require_ready('http://fixture/api'))
            req = build.return_value.open.call_args.args[0]
            self.assertEqual(req.get_method(), 'GET')
            self.assertEqual(req.full_url, 'http://fixture/api/mcp/tools/numen_survival')
            self.assertEqual(dict(req.header_items())['X-agent-id'], 'qd-survivor')
            self.assertIsNone(req.data)
            build.return_value.open.return_value = io.BytesIO(b'x' * (256 * 1024 + 1))
            self.assertFalse(native.require_ready('http://fixture/api'))

    def test_missing_disabled_extra_duplicate_and_malformed_tools_are_not_ready(self):
        variants = [[], tools()[:-1], tools() + [tools()[0]], tools()[:-1] + [tools()[0]],
                    [{'name': name, 'enabled': False, 'input_schema': {}} for name in native.TOOL_NAMES],
                    [{'name': name, 'enabled': True, 'input_schema': None} for name in native.TOOL_NAMES],
                    {'status': 'ok', 'agents_loaded': ['qd-survivor']}]
        for value in variants:
            with self.subTest(value=value), patch.object(native, 'request', return_value=value):
                self.assertFalse(native.require_ready())
        with patch.object(native, 'request', side_effect=OSError('connection unavailable')):
            self.assertFalse(native.require_ready())

    def test_saved_inactive_driver_reloads_through_exact_whitelist_then_requires_get(self):
        with patch.object(native, 'request', side_effect=[OSError(), saved(), tools(), []]) as request:
            self.assertFalse(native.NativeToolConnection(clock=lambda: 100).ensure_ready())
            self.assertEqual(request.call_args_list[2].args[1:], (native.TOOLS_ROUTE, {'tools': list(native.TOOL_NAMES)}))
            self.assertEqual(request.call_args_list[3].args[1:], (native.TOOLS_ROUTE,))
            self.assertNotIn('PRIVATE', str(request.call_args_list))
        with patch.object(native, 'request', side_effect=[OSError(), saved(), [], tools()]):
            self.assertTrue(native.NativeToolConnection(clock=lambda: 100).ensure_ready())

    def test_no_reload_when_ready_and_retry_is_at_least_30_seconds(self):
        with patch.object(native, 'request', return_value=tools()) as request:
            self.assertTrue(native.NativeToolConnection().ensure_ready())
            self.assertEqual(request.call_count, 1)
        now = [100]
        connection = native.NativeToolConnection(clock=lambda: now[0], retry_seconds=1)
        with patch.object(native, 'request', side_effect=OSError()) as request:
            self.assertFalse(connection.ensure_ready())
            self.assertEqual(request.call_count, 2)
            now[0] = 129
            self.assertFalse(connection.ensure_ready())
            self.assertEqual(request.call_count, 3)
            now[0] = 130
            self.assertFalse(connection.ensure_ready())
            self.assertEqual(request.call_count, 5)

    def test_operator_disabled_changed_endpoint_or_restricted_tools_are_preserved(self):
        for changes in ({'enabled': False}, {'key': 'other'}, {'url': 'http://other/mcp'},
                        {'transport': 'stdio'}, {'tools': []}, {'tools': ['status']}, {'tools': [None]}):
            with self.subTest(changes=changes), patch.object(native, 'request', side_effect=[OSError(), saved() | changes]) as request:
                self.assertFalse(native.NativeToolConnection().ensure_ready())
                self.assertEqual(request.call_count, 2)
                self.assertTrue(all(len(call.args) == 2 for call in request.call_args_list))

    def test_legacy_card_without_config_whitelist_gets_only_existing_allowed_tools(self):
        with patch.object(native, 'request', side_effect=[OSError(), saved() | {'tools': None}, [], tools()]) as request:
            self.assertTrue(native.NativeToolConnection().ensure_ready())
            self.assertEqual(set(request.call_args_list[2].args[2]), {'tools'})

    def test_survivor_health_rejects_live_http_endpoints_without_native_tools(self):
        path = Path(__file__).resolve().parents[1] / 'world/survival/health.py'
        spec = importlib.util.spec_from_file_location('native_tool_health_fixture', path)
        health = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(health)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'survival').mkdir()
            (root / 'game-migration.json').write_text('{}')
            (root / 'survival/heartbeat.json').write_text(json.dumps({'ok': True, 'at': time.time() * 1000, 'status': 'paused'}))
            values = [{'ok': True}, {'status': 'ok', 'agents_loaded': ['qd-survivor']}, {'enabled': False}]
            with patch.object(health, 'Path', return_value=root), patch.object(health.importlib.metadata, 'version', return_value='2.2.0'), \
                 patch.dict(health.os.environ, {'QWENPAW_AUTH_ENABLED': '0', 'SURVIVOR_QWEN_MODE': 'external'}), \
                 patch.object(health.urllib.request, 'urlopen', side_effect=[io.BytesIO(json.dumps(v).encode()) for v in values]), \
                 patch.object(health, 'require_ready', return_value=False):
                with self.assertRaisesRegex(AssertionError, 'native_survivor_tools_unavailable'):
                    health.check()


if __name__ == '__main__':
    unittest.main()
