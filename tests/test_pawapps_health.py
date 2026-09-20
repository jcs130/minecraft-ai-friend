"""A visible PawApp needs current data and browser evidence, not just HTTP 200."""
import ast
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pawapps_health', ROOT/'tools/pawapps_health.py')
health = importlib.util.module_from_spec(spec); spec.loader.exec_module(health)
spec = importlib.util.spec_from_file_location('pawapp_bridge_fixture', ROOT/'world/ops/pawapp_bridge.py')
bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)


class PawAppHealthTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name); self.now = 10000
        self.projection = {'schema': 2, 'at': self.now, 'generation': {'status': 'current', 'memoryEpoch': 'embodied-test'},
            'runtime': {'status': 'paused', 'pauseReason': 'operator_pause', 'enabled': False},
            'evidence': {'errors': []}, 'closedLoop': {'sampled': 0, 'rate': None, 'objectiveSuccessRate': None},
            'decisionGaps': None}
        self.board = {'schema': 2, 'generatedAt': self.now, 'roles': [{'role': 'qd-survivor'}, {'role': 'qd-engineer'}],
                      'metrics': {'survival': deepcopy(self.projection)}}
        self.apps = {'apps': [{'id': app, 'entry_page': '/apps/' + app, 'status': 'installed'} for app in health.APP_IDS]}
        self.js = {app: bridge.build_frontend(app, app, '*') for app in health.APP_IDS}
        self.config = {'agents': {'profiles': {role: {'enabled': enabled, 'workspace_dir': '/state/work/workspaces/' + role}
                       for role, enabled in [('qd-survivor', True), ('qd-engineer', True), ('retired', False), ('default', True)]}}}
        self.config['agents']['profiles']['foreign'] = {'enabled': True, 'workspace_dir': '/somewhere/foreign'}
        self.put('server/agents/work/config.json', self.config)
        self.put('server/survival-agent-state/survival/settings.json', {'memoryEpoch': 'embodied-test'})
        self.put('server/panel-state/survival-metrics.json', self.projection)
        hashes = {}
        for name in health.SOURCES:
            p = self.root/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('# fixture ' + name, 'utf8')
            hashes[name] = hashlib.sha256(p.read_bytes()).hexdigest()
        self.report = {'schema': 1, 'ok': True, 'modelCalls': 0, 'worldActions': 0,
            'checks': [{'name': n, 'ok': True} for n in health.REQUIRED_CHECKS], 'sourceHashes': hashes}
        self.put(health.REPORT, self.report)
        self.requests = []

    def put(self, name, value):
        p = self.root/name; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(value), 'utf8')

    def fetch(self, path):
        self.requests.append(path)
        if path == '/api/pawapps': return json.dumps(self.apps).encode()
        if path == '/api/evolution-board/board': return json.dumps(self.board).encode()
        app = path.split('/')[3]
        return self.js[app].encode()

    def check(self):
        return health.check(self.root, self.fetch, clock=lambda: self.now)

    def test_real_sdk_registration_paused_runtime_and_current_roles_are_healthy_readonly(self):
        before = {str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.check()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['runtime'], self.projection['runtime'])
        self.assertEqual(result['expectedRoleCount'], 2)
        self.assertEqual(self.requests, list(health.PATHS))
        self.assertEqual(before, {str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        self.assertEqual((result['modelCalls'], result['worldActions']), (0, 0))

    def test_manifest_legacy_route_duplicate_or_missing_app_cannot_pass(self):
        original = deepcopy(self.apps)
        for change in ('legacy', 'duplicate', 'missing'):
            self.apps = deepcopy(original)
            if change == 'legacy': self.apps['apps'][0]['entry_page'] = '/plugin/evolution-board'
            elif change == 'duplicate': self.apps['apps'].append(deepcopy(self.apps['apps'][0]))
            else: self.apps['apps'].pop()
            with self.subTest(change=change): self.assertFalse(self.check()['checks']['native_discovery'])

    def test_http_success_with_legacy_sdk_or_wrong_app_is_not_page_registration(self):
        original = self.js['evolution-board']
        for text in ('<html>login</html>', original.replace('ui.registerPage(', 'ui.registerFake('),
                     bridge.build_frontend('wrong-app', 'Wrong', '*')):
            self.js['evolution-board'] = text
            self.assertFalse(self.check()['checks']['sdk_pages'])

    def test_freshness_rejects_stale_future_nonfinite_boolean_and_missing_timestamps(self):
        for value in (self.now-361, self.now+1, float('inf'), float('nan'), True, '10000', None):
            with self.subTest(value=value):
                self.board['metrics']['survival']['at'] = value
                self.assertFalse(self.check()['ok'])
        for age in (300, 301, 360):
            self.board['metrics']['survival']['at'] = self.now-age
            with self.subTest(age=age): self.assertTrue(self.check()['ok'])
        self.board['generatedAt'] = self.now-361
        self.assertFalse(self.check()['checks']['fresh_metrics'])

    def test_wrong_generation_old_schema_and_missing_runtime_fail(self):
        original = deepcopy(self.board)
        for change in ('epoch', 'schema', 'runtime'):
            self.board = deepcopy(original)
            if change == 'epoch': self.board['metrics']['survival']['generation']['memoryEpoch'] = 'old'
            elif change == 'schema': self.board['schema'] = True
            else: del self.board['metrics']['survival']['runtime']
            with self.subTest(change=change): self.assertFalse(self.check()['ok'])

    def test_disabled_foreign_duplicate_missing_roles_fail_without_fake_zero(self):
        for roles in ([], [{'role': 'qd-survivor'}], [{'role': 'qd-survivor'}]*2,
                      [{'role': 'qd-survivor'}, {'role': 'retired'}],
                      [{'role': 'qd-survivor'}, {'role': 'foreign'}]):
            self.board['roles'] = roles
            self.assertFalse(self.check()['checks']['current_roles'])
        self.put('server/agents/work/config.json', {})
        result = self.check()
        self.assertFalse(result['ok']); self.assertIsNone(result['expectedRoleCount'])

    def test_unknown_null_and_incomplete_coverage_cannot_become_zero_or_success(self):
        for field in ('rate', 'objectiveSuccessRate'):
            self.board['metrics']['survival'] = deepcopy(self.projection)
            self.board['metrics']['survival']['closedLoop'][field] = 0
            self.assertFalse(self.check()['checks']['unknown_preserved'])
        self.board['metrics']['survival'] = deepcopy(self.projection)
        self.board['metrics']['survival']['decisionGaps'] = 0
        self.assertFalse(self.check()['checks']['unknown_preserved'])
        self.board['metrics']['survival'] = deepcopy(self.projection)
        self.board['metrics']['survival']['closedLoop'].update(sampled=5, rate=1.0)
        self.board['metrics']['survival']['evidence']['errors'] = ['missing.json']
        self.assertFalse(self.check()['checks']['unknown_preserved'])

    def test_native_ready_does_not_substitute_for_current_real_browser_proof(self):
        for change in ('missing-check', 'failed-check', 'source-drift', 'missing-report'):
            self.put(health.REPORT, self.report)
            if change == 'missing-check':
                value = deepcopy(self.report); value['checks'].pop(); self.put(health.REPORT, value)
            elif change == 'failed-check':
                value = deepcopy(self.report); value['checks'][0]['ok'] = False; self.put(health.REPORT, value)
            elif change == 'source-drift': (self.root/health.SOURCES[0]).write_text('changed', 'utf8')
            else: (self.root/health.REPORT).unlink()
            with self.subTest(change=change):
                result = self.check(); self.assertFalse(result['ok']); self.assertTrue(all(result['checks'].values()))

    def test_transport_failures_are_visible_without_leaking_raw_private_error(self):
        result = health.check(self.root, fetch=Mock(side_effect=TimeoutError('PRIVATE')), clock=lambda:self.now)
        self.assertFalse(result['ok']); self.assertIn('TimeoutError', result['errors'].values())
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_native_transport_is_fixed_bounded_get_and_never_follows_redirects(self):
        response = Mock(); response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{}'; opener = Mock(); opener.open.return_value = response
        with patch.object(health.urllib.request, 'build_opener', return_value=opener) as build:
            self.assertEqual(health.native_get('/api/pawapps'), b'{}')
            request = opener.open.call_args.args[0]
            self.assertEqual(request.get_method(), 'GET'); self.assertIsNone(request.data)
            self.assertEqual(request.full_url, 'http://127.0.0.1:18089/api/pawapps')
            self.assertEqual(opener.open.call_args.kwargs, {'timeout': 5})
            response.read.assert_called_once_with(health.MAX_BYTES+1)
            self.assertTrue(any(isinstance(x, health.NoRedirect) for x in build.call_args.args))
            with self.assertRaises(ValueError): health.native_get('/api/console/chat')
            self.assertEqual(opener.open.call_count, 1)
        response.read.return_value = b'x' * (health.MAX_BYTES+1)
        with patch.object(health.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(ValueError): health.native_get('/api/pawapps')


class MonitorWiringTests(unittest.TestCase):
    def test_pawapps_participates_in_panel_smoke_and_main_manifest(self):
        path = ROOT/'world/ops/health/health_mon.py'
        spec = importlib.util.spec_from_file_location('pawapps_monitor_test', path)
        monitor = importlib.util.module_from_spec(spec); spec.loader.exec_module(monitor)
        with ExitStack() as stack:
            for name in vars(monitor):
                if name.startswith('probe_') and name != 'probe_panel_smoke':
                    stack.enter_context(patch.object(monitor, name, return_value={'ok': name != 'probe_pawapps'}))
            result = monitor.probe_panel_smoke()
        self.assertFalse(result['ok']); self.assertFalse(result['pawapps']['ok'])
        tree = ast.parse(path.read_text('utf8'))
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main_locked')
        self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                            and n.func.id == 'probe_pawapps' for n in ast.walk(main)))


if __name__ == '__main__':
    unittest.main()
