"""Operations health never reuses a green snapshot after collection failure."""
from contextlib import ExitStack, nullcontext, redirect_stdout
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('operations_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class OperationsHealth(unittest.TestCase):
    NOW = 1_788_782_400.0

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-operations-health-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root/'server/panel-state/operations.json'
        self.events = []
        self.source = {'schema': 1, 'project': 'qiandengji', 'generatedAt': self.iso(self.NOW-1.123456),
            'runtimes': [{'id': name, 'label': name, 'kind': 'host' if name == 'host' else 'container',
                          'version': None, 'endpoint': None, 'state': 'unverified', 'purpose': 'fixture',
                          'enabledAgentCount': None, 'agentCount': None} for name in ('qiandengji', 'shadow', 'host')],
            'agents': [{'id': name, 'label': name, 'runtimeId': 'qiandengji', 'enabled': True,
                        'role': 'fixture', 'modelProvider': None, 'model': None, 'toolCount': 0,
                        'mcpCount': None, 'jobCount': None} for name in ('mc-god', 'mc-herald')],
            'services': [{'id': name, 'label': name, 'group': 'shared' if name == 'shared-tts' else 'game',
                          'container': 'shadow-tts' if name == 'shared-tts' else 'qiandengji-'+name+'-1',
                          'state': 'running', 'health': 'healthy', 'purpose': 'fixture', 'managedBy': 'fixture',
                          'dependencies': ['shared-tts'] if name == 'voice' else []} for name in (*health.MANIFEST, 'shared-tts')],
            'issues': [], 'commands': [{'label': 'status', 'command': 'python tools/operations.py status'}],
            'checks': {'currentServices': True, 'sharedTts': {'ok': True, 'endpoint': 'http://127.0.0.1:8100/health'}}}
        self.adapter = SimpleNamespace(collect_snapshot=self.collect, write_snapshot=self.write)
        for patcher in (patch.object(health, 'PROJECT', self.root), patch.object(health.time, 'time', return_value=self.NOW),
                        patch.object(health, 'OPERATIONS_COLLECTION', None),
                        patch.object(health, 'load_operations_adapter', return_value=self.adapter),
                        patch.object(health, 'load_inventory_lock', return_value=lambda *a, **kw: nullcontext(True)),
                        patch.object(health.subprocess, 'run', side_effect=AssertionError('No Docker in health tests')),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP in health tests'))):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def iso(seconds):
        return datetime.fromtimestamp(seconds, timezone.utc).isoformat()

    def collect(self, *, root):
        self.assertEqual(root, self.root)
        self.events.append('collect')
        return deepcopy(self.source)

    def write(self, value, *, root):
        self.assertEqual(root, self.root)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(value), encoding='utf-8')
        self.events.append('write')

    def public(self):
        result = {key: deepcopy(self.source[key]) for key in ('schema', 'project', *health.OPERATIONS_FIELDS)}
        stamp = health.operations_time(self.source['generatedAt'])
        result.update({'generatedAt': stamp.replace(microsecond=stamp.microsecond//1000*1000).isoformat(),
                       'available': True, 'stale': False, 'staleReason': None, 'ageSeconds': 2, 'ttlSeconds': 300})
        return result

    def refresh(self):
        return health.refresh_operations_snapshot()

    def probe(self, value=None):
        return health.probe_operations(self.public() if value is None else value)

    def run_offline_main(self):
        with ExitStack() as stack, redirect_stdout(io.StringIO()):
            for name in ('probe_recorded_behavior', 'probe_extension_files', 'probe_architecture',
                         'probe_panel_smoke', 'probe_statusbook', 'probe_content_files', 'probe_guild'):
                stack.enter_context(patch.object(health, name, return_value={'ok': True}))
            def services():
                self.events.append('services')
                return {'ok': True, 'checks': {}}
            stack.enter_context(patch.object(health, 'probe_services', side_effect=services))
            (self.root/'reports').mkdir(exist_ok=True)
            return health.main()

    def test_current_collection_and_strict_public_projection_pass_with_microsecond_source(self):
        result = self.refresh()
        self.assertTrue(result['ok'])
        self.assertEqual(self.events, ['collect', 'write'])
        result = self.probe()
        for key in ('ok', 'same_collection', 'runtimes', 'agents', 'services', 'current_services', 'shared_tts'):
            self.assertTrue(result[key], key)

    def test_main_collects_before_other_probes_and_shared_tts_failure_turns_overall_red(self):
        self.source['checks']['sharedTts']['ok'] = False
        self.assertEqual(self.run_offline_main(), 1)
        self.assertEqual(self.events[:3], ['collect', 'write', 'services'])
        report = json.loads((self.root/'reports/runtime-health.json').read_text('utf-8'))
        self.assertFalse(report['ok']); self.assertTrue(report['services']['ok'])
        self.assertFalse(report['operations_inventory']['shared_tts'])
        public = json.loads((self.root/'server/panel-state/health.json').read_text('utf-8'))
        self.assertFalse(public['ok']); self.assertFalse(public['services']['shared-tts']['ok'])

    def test_busy_health_waits_ten_seconds_and_publishes_failure_without_collecting(self):
        self.run_offline_main()
        self.events.clear()
        def busy(root, wait_seconds):
            self.assertEqual(root, self.root)
            self.assertEqual(wait_seconds, 10)
            return nullcontext(False)
        with patch.object(health, 'load_inventory_lock', return_value=busy):
            self.assertEqual(self.run_offline_main(), 1)
        self.assertEqual(self.events, [])
        report = json.loads((self.root/'reports/runtime-health.json').read_text('utf-8'))
        public = json.loads((self.root/'server/panel-state/health.json').read_text('utf-8'))
        self.assertFalse(report['ok']); self.assertFalse(public['ok'])
        self.assertEqual(report['operations_inventory']['reason'], 'inventory_busy')
        self.assertTrue(public['retry'])
        self.assertFalse(health.OPERATIONS_COLLECTION['collected'])

    def test_missing_lock_helper_never_runs_unprotected_or_preserves_previous_green(self):
        self.run_offline_main()
        self.events.clear()
        with patch.object(health, 'load_inventory_lock', side_effect=ImportError('PRIVATE')):
            self.assertEqual(self.run_offline_main(), 1)
        self.assertEqual(self.events, [])
        result = (self.root/'reports/runtime-health.json').read_text('utf-8')
        self.assertNotIn('PRIVATE', result)
        self.assertFalse(json.loads(result)['ok'])
        self.assertEqual(json.loads(result)['operations_inventory']['reason'], 'inventory_lock_unavailable')

    def test_collector_failure_overwrites_old_success_and_never_returns_its_evidence(self):
        self.refresh()
        old = self.public()
        self.adapter.collect_snapshot = lambda **_: (_ for _ in ()).throw(RuntimeError('PRIVATE_ERROR_DETAIL'))
        result = self.refresh()
        self.assertFalse(result['ok']); self.assertFalse(result['collected'])
        self.assertNotIn('PRIVATE_ERROR_DETAIL', json.dumps(result))
        current = json.loads(self.path.read_text('utf-8'))
        self.assertEqual(current['runtimes'], [])
        self.assertFalse(current['checks']['currentServices'])
        self.assertEqual(current['issues'][0]['severity'], 'error')
        self.assertFalse(self.probe(old)['ok'])
        self.assertEqual(self.run_offline_main(), 1)

    def test_no_collection_in_this_run_cannot_accept_a_fresh_historical_snapshot(self):
        self.write(self.source, root=self.root)
        self.assertFalse(self.probe()['ok'])

    def test_bad_collector_identity_or_time_publishes_failure(self):
        original = deepcopy(self.source)
        for change in ({'schema': True}, {'schema': 2}, {'project': 'shadow'}, {'generatedAt': self.iso(self.NOW+1)},
                       {'generatedAt': self.iso(self.NOW-301)}, {'generatedAt': '2026-09-07T12:00:00'}, {'checks': None}):
            with self.subTest(change=change):
                self.source = {**original, **change}
                result = self.refresh()
                self.assertFalse(result['ok']); self.assertFalse(result['collected'])

    def test_writer_must_publish_exactly_the_collected_snapshot(self):
        self.adapter.write_snapshot = lambda value, **_: self.write({**value, 'scope': 'a different run'}, root=self.root)
        result = self.refresh()
        self.assertFalse(result['ok']); self.assertFalse(result['collected'])

    def test_failed_publication_is_explicit_and_cannot_fall_back_to_old_success(self):
        self.refresh()
        old = self.public()
        self.adapter.write_snapshot = lambda *a, **k: (_ for _ in ()).throw(OSError('write failed'))
        with patch.object(Path, 'write_text', side_effect=OSError('No writes')):
            result = self.refresh()
        self.assertFalse(result['ok']); self.assertTrue(result['publication_failed'])
        self.assertFalse(self.probe(old)['ok'])

    def test_public_contract_rejects_extra_config_and_sensitive_fields_everywhere(self):
        self.refresh()
        for key in ('token', 'checks', 'config', 'secret', 'sourceConfig'):
            public = self.public(); public[key] = 'PRIVATE'
            self.assertFalse(self.probe(public)['ok'])
        for collection in health.OPERATIONS_FIELDS:
            public = self.public()
            if not public[collection]:
                public[collection].append({'code': 'fixture', 'severity': 'info', 'title': 'fixture', 'detail': None})
            public[collection][0]['token'] = 'PRIVATE'
            self.assertFalse(self.probe(public)['ok'])

    def test_unknown_runtime_and_missing_or_duplicate_agent_service_ids_are_rejected(self):
        self.refresh()
        values = []
        for name in ('runtimes', 'agents', 'services'):
            value = self.public(); value[name] = value[name][1:]; values.append(value)
            value = self.public(); value[name].append(deepcopy(value[name][0])); values.append(value)
        value = self.public(); value['agents'][0]['runtimeId'] = 'unregistered'; values.append(value)
        value = self.public(); value['runtimes'][0]['id'] = 'foreign'; values.append(value)
        for value in values:
            self.assertFalse(self.probe(value)['ok'])

    def test_public_scalar_types_and_safe_endpoints_are_required(self):
        self.refresh()
        for collection, key, bad in [('agents', 'enabled', 1), ('agents', 'toolCount', True),
                                     ('agents', 'jobCount', -1), ('agents', 'mcpCount', 1.0),
                                     ('services', 'dependencies', [{}]), ('runtimes', 'label', {})]:
            value = self.public(); value[collection][0][key] = bad
            self.assertFalse(self.probe(value)['ok'])
        for endpoint in ('file:///private', 'javascript:alert(1)', 'http://user:secret@localhost',
                         'http://localhost?token=PRIVATE', 'https://localhost/#PRIVATE', 'http://localhost:65536', 'http://localhost:0'):
            value = self.public(); value['runtimes'][0]['endpoint'] = endpoint
            self.assertFalse(self.probe(value)['ok'])
        value = self.public(); value['runtimes'][0]['endpoint'] = 'http://127.0.0.1:18089/'
        self.assertTrue(self.probe(value)['ok'])

    def test_public_timestamp_must_be_current_and_match_the_actual_collection(self):
        self.refresh()
        for change in ({'generatedAt': self.iso(self.NOW-2)}, {'generatedAt': self.iso(self.NOW+1)},
                       {'generatedAt': '2026-09-07T12:00:00'}, {'available': 1}, {'stale': True},
                       {'staleReason': 'expired'}, {'schema': True}, {'project': 'shadow'}, {'ttlSeconds': 299},
                       {'ttlSeconds': 300.0}, {'ageSeconds': True}, {'ageSeconds': -1}, {'ageSeconds': 301},
                       {'ageSeconds': float('nan')}):
            self.assertFalse(self.probe({**self.public(), **change})['ok'])
        with patch.object(health.time, 'time', return_value=self.NOW+301):
            self.assertFalse(self.probe()['ok'])

    def test_current_services_and_actual_shared_health_require_exact_success_values(self):
        for bad in (False, 1, 'true', None):
            self.source['checks']['currentServices'] = bad
            self.refresh()
            self.assertFalse(self.probe()['ok'])
        self.source['checks']['currentServices'] = True
        for bad in (False, 1, 'true', None):
            self.source['checks']['sharedTts']['ok'] = bad
            self.refresh()
            self.assertFalse(self.probe()['ok'])
        self.source['checks']['sharedTts'] = {'ok': True, 'endpoint': 'http://127.0.0.1:9999/health'}
        self.refresh(); self.assertFalse(self.probe()['ok'])

    def test_changed_deleted_or_oversized_snapshot_cannot_reuse_collection_receipt(self):
        self.refresh()
        original = self.path.read_bytes()
        for raw in (b'{partial', original+b'\n', b'x'*(2*1024*1024+1)):
            self.path.write_bytes(raw)
            self.assertFalse(self.probe()['ok'])
        self.path.unlink(); self.assertFalse(self.probe()['ok'])

    def test_http_and_panel_smoke_require_valid_operations_even_when_other_statuses_pass(self):
        self.refresh()
        state = {'available': True, 'stale': False, 'world': {'stale': False},
                 'npc': {'stale': False, 'llmEnabled': False}, 'guild': {'pollingOk': True},
                 'skills': {'available': True}, 'agent': {'id': 'qwenpaw'}, 'operations': self.public()}
        def read(url, **kwargs):
            return io.StringIO(json.dumps({'ok': True, 'service': 'qiandengji-panel'} if url.endswith('/healthz') else state))
        with patch.object(health.urllib.request, 'urlopen', side_effect=read), ExitStack() as stack:
            for name in ('probe_management', 'probe_recorded_behavior', 'probe_source_record', 'probe_player_commands', 'probe_voice_commands',
                         'probe_chanting_staff', 'probe_voice_recording', 'probe_voice_boundary_deployment',
                         'probe_skillbar_editor', 'probe_chanting_client'):
                stack.enter_context(patch.object(health, name, return_value={'ok': True}))
            self.assertTrue(health.probe_panel_smoke()['ok'])
            state.pop('operations')
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok']); self.assertFalse(result['operations']['ok'])

    def test_project_tools_import_path_exists_only_during_collection(self):
        before = list(sys.path)
        def collect(**kwargs):
            self.assertEqual(sys.path[0], str(self.root/'tools'))
            return deepcopy(self.source)
        self.adapter.collect_snapshot = collect
        self.assertTrue(self.refresh()['ok'])
        self.assertEqual(sys.path, before)
        self.adapter.collect_snapshot = lambda **_: (_ for _ in ()).throw(ImportError('inventory failed'))
        self.assertFalse(self.refresh()['ok'])
        self.assertEqual(sys.path, before)


if __name__ == '__main__':
    unittest.main()
