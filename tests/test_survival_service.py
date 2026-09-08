"""Shared-game boot supervises one body driver, without a second Qwen instance."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

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

    def test_external_startup_only_checks_owned_mcp_child(self):
        with patch.object(service.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"ok":true}')) as call:
            self.assertTrue(service.local_readiness({}))
            self.assertEqual(call.call_count, 1)
            self.assertEqual(call.call_args.args[0], 'http://127.0.0.1:8089/livez')
        with patch.object(service.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"ok":false}')):
            self.assertFalse(service.local_readiness({}))

    def test_probe_throttles_failures_recovers_and_never_submits(self):
        connection = Mock()
        connection.ensure_ready.side_effect = [OSError('offline'), False, True]
        probe = service.QwenConnectionProbe(connection, interval=1, clock=lambda: 123)
        snapshots, delays = [], []
        def wait(delay):
            delays.append(delay)
            snapshots.append(probe.snapshot())
            return len(delays) == 3
        probe._stop = SimpleNamespace(is_set=lambda: False, wait=wait)
        probe._run()
        self.assertEqual(delays, [30, 30, 30])
        self.assertEqual([v['ready'] for v in snapshots], [False, False, True])
        self.assertEqual(snapshots[0]['warning'], 'qwen_probe_OSError')
        self.assertEqual(snapshots[1]['warning'], 'native_survivor_tools_unavailable')
        self.assertIsNone(snapshots[2]['warning'])
        self.assertEqual(snapshots[2]['checkedAt'], 123000)
        self.assertEqual([call[0] for call in connection.mock_calls], ['ensure_ready'] * 3)


class FastSurvivalServiceTests(unittest.TestCase):
    def setUp(self):
        # Reuse the isolated body/lease fixtures; no live Qwen, RCON or files.
        sys.path.insert(0, str(ROOT / 'tests'))
        import test_survival_controller as fixtures
        self.fixture = fixtures.ControllerTests(methodName='runTest')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.backend.usage = Mock(return_value={
            'modelRequests': 7, 'promptTokens': 200, 'completionTokens': 80})

    def test_main_runs_queued_program_while_qwen_probe_is_blocked(self):
        f = self.fixture
        f.job()
        f.controller.data['decisions'] = [{'startedAt': f.clock() - 1}] * 2
        f.skills.reply = {'action': {'tool': 'mine', 'args': {'block_ids': ['minecraft:oak_log'], 'count': 1}},
                          'memory': {'attempts': 1}}
        entered, release = threading.Event(), threading.Event()
        probe_threads = []
        def offline_probe():
            probe_threads.append(threading.get_ident())
            entered.set()
            release.wait(2)
            return False
        connection = Mock()
        connection.ensure_ready.side_effect = offline_probe
        child = Mock()
        child.poll.return_value = None
        signals = {}
        tick_errors = []
        real_tick = f.controller.tick
        def tick_once():
            try:
                self.assertTrue(entered.wait(1), 'background probe did not start')
                self.assertFalse(release.is_set())
                real_tick()
                self.assertEqual(len(f.gateway.actions), 1)
                self.assertFalse(f.backend.submitted)
                self.assertEqual(len(f.controller.data['decisions']), 2)
            except Exception as exc:
                tick_errors.append(exc)
                raise
            finally:
                release.set()
                signals[service.signal.SIGTERM](None, None)
        with patch.dict(service.os.environ, {'SURVIVOR_QWEN_MODE': 'external'}), \
                patch.object(service, 'STATE', f.state), \
                patch.object(service, 'fcntl', SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *_: None)), \
                patch.object(service.signal, 'signal', side_effect=lambda sig, fn: signals.__setitem__(sig, fn)), \
                patch.object(service.subprocess, 'Popen', return_value=child), \
                patch.object(service, 'Controller', return_value=f.controller), \
                patch.object(service, 'WorldPerception'), \
                patch.object(service, 'SkillLibrary'), \
                patch.object(service, 'NativeToolConnection', return_value=connection), \
                patch.object(service, 'local_readiness', return_value=True), \
                patch.object(service, 'readiness') as remote_readiness, \
                patch.object(f.controller, 'tick', side_effect=tick_once):
            service.main()
        self.assertEqual(tick_errors, [])
        self.assertEqual(len(f.gateway.actions), 1)
        self.assertFalse(f.backend.submitted)
        self.assertEqual(len(probe_threads), 1)
        self.assertNotEqual(probe_threads[0], threading.get_ident())
        remote_readiness.assert_not_called()
        f.backend.usage.assert_not_called()
        self.assertTrue(f.controller.data['qwenReadiness']['warning'])
        child.terminate.assert_called_once()
        self.assertFalse(any(t.name == 'survivor-qwen-probe' and t.is_alive() for t in threading.enumerate()))

    def test_offline_submission_preserves_budget_and_recovery_checks_live_tools(self):
        f = self.fixture
        # A diagnostic cache must never authorize a model submission.
        f.controller.data['qwenReadiness'] = {'ready': True, 'checkedAt': 1, 'warning': None}
        with patch.dict(service.os.environ, {'SURVIVOR_QWEN_MODE': 'external'}), \
                patch('native_tools.require_ready', return_value=False) as check:
            f.controller.tick()
            check.assert_called_once()
            self.assertEqual(f.controller.data['status'], 'waiting_for_tools')
            self.assertFalse(f.controller.data['decisions'])
            self.assertFalse(f.backend.submitted)
            self.assertFalse(f.gateway.opened)
        with patch.dict(service.os.environ, {'SURVIVOR_QWEN_MODE': 'external'}), \
                patch('native_tools.require_ready', return_value=True) as check:
            f.controller.tick()
            check.assert_called_once()
        self.assertEqual(len(f.backend.submitted), 1)
        self.assertEqual(len(f.controller.data['decisions']), 1)
        self.assertTrue(f.controller.data['active'])

    def test_usage_offline_is_unknown_without_read_and_failed_reads_are_throttled(self):
        f = self.fixture
        with patch.dict(service.os.environ, {'SURVIVOR_QWEN_MODE': 'external'}):
            f.controller.data['qwenReadiness'] = {'ready': False}
            self.assertTrue(all(v is None for v in f.controller.usage().values()))
            f.backend.usage.assert_not_called()
            f.controller.data['qwenReadiness'] = {'ready': True}
            f.backend.usage.side_effect = OSError('offline statistics')
            self.assertTrue(all(v is None for v in f.controller.usage().values()))
            for _ in range(5):
                f.clock.now += 10
                self.assertTrue(all(v is None for v in f.controller.usage().values()))
            self.assertEqual(f.backend.usage.call_count, 1)
            f.clock.now += 10
            f.backend.usage.side_effect = None
            self.assertEqual(f.controller.usage()['modelRequests'], 7)
            self.assertEqual(f.backend.usage.call_count, 2)
            f.controller.data['qwenReadiness'] = {'ready': False}
            self.assertTrue(all(v is None for v in f.controller.usage().values()))
            self.assertEqual(f.backend.usage.call_count, 2)


if __name__ == '__main__':
    unittest.main()
