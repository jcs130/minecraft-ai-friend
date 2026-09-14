"""Inbox health stays read only and never mistakes accepted input for model work."""
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


health = module('maid_perception_health_tests', ROOT / 'tools/maid_perception_health.py')
monitor = module('maid_perception_monitor_tests', ROOT / 'world/ops/health/health_mon.py')


class InboxHealthTests(unittest.TestCase):
    def setUp(self):
        self.value = {'ok': True, 'registry': {'private-fixture': 'must-not-return'},
            'perceptionInbox': {'schema': 1, 'persistent': True, 'wakeOnInput': False,
                'currentBindingValid': True, 'counts': {'pending': 2, 'claimed': 1, 'consumed': 4, 'failed': 1},
                'totalRetained': 8, 'capacity': 4096, 'maxBatch': 8, 'assistantReply': False}}

    def probe(self):
        return health.check(fetch=lambda: self.value)

    def test_pending_backlog_and_failed_history_are_not_false_unavailability(self):
        result = self.probe()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['counts'], self.value['perceptionInbox']['counts'])
        self.assertEqual(result['totalRetained'], 8)
        self.assertEqual((result['modelCalls'], result['worldActions']), (0, 0))
        self.assertNotIn('private-fixture', json.dumps(result))
        self.assertIn('not a completed model turn', result['scope'])

    def test_missing_new_loaded_projection_fails_even_if_old_adapter_is_healthy(self):
        self.value.pop('perceptionInbox')
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertTrue(result['checks']['adapter_ready'])
        self.assertIsNone(result['counts']['pending'])

    def test_schema_identity_persistence_and_wakeup_are_strict(self):
        for key, bad in (('schema', True), ('schema', 2), ('persistent', False),
                         ('wakeOnInput', True), ('currentBindingValid', False)):
            value = deepcopy(self.value)
            value['perceptionInbox'][key] = bad
            with self.subTest(key=key, bad=bad):
                self.assertFalse(health.check(fetch=lambda: value)['ok'])

    def test_invalid_counts_do_not_appear_as_empty_or_valid(self):
        for bad in (-1, True, 1.0, '1', 4097, None):
            value = deepcopy(self.value)
            value['perceptionInbox']['counts']['pending'] = bad
            with self.subTest(bad=bad):
                result = health.check(fetch=lambda: value)
                self.assertFalse(result['ok'])
                self.assertIsNone(result['counts']['pending'])
        self.value['perceptionInbox']['totalRetained'] = 9
        self.assertFalse(self.probe()['ok'])

    def test_extra_private_projection_is_rejected_and_never_returned(self):
        self.value['perceptionInbox']['messages'] = [{'text': 'private-must-not-return'}]
        result = self.probe()
        self.assertFalse(result['checks']['public_projection'])
        self.assertNotIn('private-must-not-return', json.dumps(result))

    def test_transport_failure_reports_type_only(self):
        result = health.check(fetch=Mock(side_effect=TimeoutError('private-credential')))
        self.assertFalse(result['ok'])
        self.assertEqual(result['errorType'], 'TimeoutError')
        self.assertNotIn('private-credential', json.dumps(result))

    def test_fetch_only_uses_fixed_existing_npc_get(self):
        result = SimpleNamespace(returncode=0, stdout=json.dumps(self.value))
        with patch.object(health.subprocess, 'run', return_value=result) as run:
            self.assertEqual(health.adapter_health(), self.value)
        args, kwargs = run.call_args
        self.assertEqual(args[0][:5], ['docker', 'exec', 'qiandengji-npc-1', 'python', '-c'])
        self.assertIn("'http://127.0.0.1:8091/healthz'", args[0][5])
        self.assertNotIn('data=', args[0][5])
        self.assertNotIn('Authorization', args[0][5])
        self.assertNotIn('read_text', args[0][5])
        self.assertEqual(kwargs['timeout'], 12)
        self.assertEqual(kwargs['encoding'], 'utf8')

    def test_nonzero_oversize_and_nonobject_fetch_fail(self):
        for code, raw in ((1, 'private-error'), (0, 'x' * 16385), (0, '[]')):
            with self.subTest(code=code, length=len(raw)), patch.object(health.subprocess, 'run',
                    return_value=SimpleNamespace(returncode=code, stdout=raw)):
                with self.assertRaises(ValueError):
                    health.adapter_health()


class InboxEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        hashes = {}
        for name in health.REQUIRED_SOURCES:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(('isolated fixture ' + name).encode())
            hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.report = {'schema': 1, 'kind': 'isolated_maid_perception_inbox', 'ok': True,
            'sourceUnchangedDuringRun': True,
            'modelCalls': 0, 'worldActions': 0, 'productionMutations': 0,
            'checks': dict.fromkeys(health.SMOKE_CHECKS, True), 'sourceHashes': hashes,
            'checkTests': {name: list(ids) for name, ids in health.BEHAVIOR_TESTS.items()}}
        cases = sorted({name for names in health.BEHAVIOR_TESTS.values() for name in names})
        self.report['execution'] = {'runner': 'unittest', 'caseSelection': 'declared_methods_only',
            'testsRun': len(cases), 'tests': [{'id': name, 'outcome': 'passed'} for name in cases]}

    def probe(self):
        path = self.root / health.REPORT
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.report), 'utf8')
        return health.behavior(self.root)

    def test_separate_evidence_accepts_current_fixture_without_rewriting_history(self):
        old = self.root / 'reports/maid-bridge-smoke.json'
        old.parent.mkdir(parents=True)
        old.write_bytes(b'untouched historical bytes')
        result = self.probe()
        self.assertTrue(result['ok'], result)
        self.assertEqual(old.read_bytes(), b'untouched historical bytes')
        self.assertIn('not proof of live', result['scope'])

    def test_source_drift_keeps_historical_proof_failed(self):
        self.assertTrue(self.probe()['ok'])
        (self.root / health.REQUIRED_SOURCES[0]).write_bytes(b'changed')
        self.assertFalse(self.probe()['checks']['current_sources'])

    def test_missing_behavior_nonzero_effects_and_wrong_kind_fail(self):
        self.report['checks'].pop(health.SMOKE_CHECKS[0])
        self.assertFalse(self.probe()['ok'])
        self.report['checks'][health.SMOKE_CHECKS[0]] = True
        self.report['productionMutations'] = 1
        self.assertFalse(self.probe()['ok'])
        self.report['productionMutations'] = 0
        self.report['kind'] = 'game_delivery_verified'
        self.assertFalse(self.probe()['ok'])

    def test_parent_path_and_missing_source_cannot_borrow_other_evidence(self):
        self.report['sourceHashes']['../outside.py'] = '0' * 64
        self.assertFalse(self.probe()['ok'])
        del self.report['sourceHashes']['../outside.py']
        self.report['sourceHashes'].pop(health.REQUIRED_SOURCES[0])
        self.assertFalse(self.probe()['ok'])

    def test_green_flags_without_exact_executed_cases_do_not_count(self):
        self.report['execution']['tests'][0]['outcome'] = 'skipped'
        self.assertFalse(self.probe()['checks']['recorded_test_execution'])
        self.report['execution']['tests'][0]['outcome'] = 'passed'
        self.report['checkTests'][health.SMOKE_CHECKS[0]] = [self.report['execution']['tests'][0]['id']]
        self.assertFalse(self.probe()['checks']['recorded_test_execution'])
        self.report['checkTests'] = {name: list(ids) for name, ids in health.BEHAVIOR_TESTS.items()}
        self.report['execution']['caseSelection'] = 'inherited_old_regressions'
        self.assertFalse(self.probe()['ok'])


class MonitorIntegrationTests(unittest.TestCase):
    def test_new_probe_keeps_runtime_and_behavior_separate(self):
        backend = SimpleNamespace(check=Mock(return_value={'ok': True}),
                                  behavior=Mock(return_value={'ok': False}),
                                  native_behavior=Mock(return_value={'ok': True}))
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda value: None))
        with patch.object(monitor.importlib.util, 'spec_from_file_location', return_value=spec), \
                patch.object(monitor.importlib.util, 'module_from_spec', return_value=backend):
            result = monitor.probe_maid_perception()
        self.assertFalse(result['ok'])
        self.assertTrue(result['live']['ok'])
        self.assertFalse(result['behavior']['ok'])
        backend.check.assert_called_once_with(monitor.PROJECT)
        backend.behavior.assert_called_once_with(monitor.PROJECT)
        backend.native_behavior.assert_called_once_with(monitor.PROJECT)

    def test_panel_smoke_fails_for_inbox_even_when_other_paths_pass(self):
        with ExitStack() as stack:
            for name in dir(monitor):
                if name.startswith('probe_') and name not in ('probe_panel_smoke', 'probe_maid_perception'):
                    stack.enter_context(patch.object(monitor, name, return_value={'ok': True}))
            probe = stack.enter_context(patch.object(monitor, 'probe_maid_perception',
                return_value={'ok': False, 'live': {'ok': False}}))
            result = monitor.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertFalse(result['maid_perception']['live']['ok'])
            probe.assert_called_once_with()
        self.assertIn('perception inbox', monitor.MANIFEST['npc']['purpose'])


class NativeInboxEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.jar = b'new native queued callback artifact'
        self.put(health.NATIVE_JAR, self.jar)
        self.put(health.NATIVE_BUILD_JAR, self.jar)
        hashes = {}
        for name in health.NATIVE_BUILD_SOURCES:
            data = ('native source fixture ' + name).encode()
            self.put(name, data)
            hashes[name] = hashlib.sha256(data).hexdigest()
        build = {'ok': True, 'sha256': hashlib.sha256(self.jar).hexdigest(), 'sources': hashes}
        self.put(health.NATIVE_BUILD, json.dumps(build).encode())
        self.put(health.NATIVE_FIXTURE, b'native fixture source')
        self.put(health.NATIVE_TOOL, b'isolated test driver source')
        self.put(health.NATIVE_HELPER, b"def fake_server_source():\n    return 'fixture fake HTTP source\\n'\n")
        self.report = {'ok': True, 'project': 'qiandengji-maid-qa-123456abcdef',
            'modelCalls': 0, 'ttsCalls': 0, 'productionMutations': 0,
            'liveAcceptanceScope': 'fresh isolated world, actual installed mods and native callbacks, deterministic fake NPC; no physical client or audio',
            'checks': dict.fromkeys(health.NATIVE_CHECKS, True), 'jarSha256': build['sha256'],
            'fixtureSha256': health._digest(self.root, health.NATIVE_FIXTURE),
            'fixtureHashes': {health.NATIVE_FIXTURE: health._digest(self.root, health.NATIVE_FIXTURE)},
            'toolSha256': health._digest(self.root, health.NATIVE_TOOL),
            'perceptionChecksSha256': health._digest(self.root, health.NATIVE_HELPER),
            'fakeNpcSha256': hashlib.sha256(b'fixture fake HTTP source\r\n').hexdigest(),
            'details': {'private-fixture-text': 'do not project'}}

    def put(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def probe(self):
        self.put(health.NATIVE_REPORT, json.dumps(self.report).encode())
        return health.native_behavior(self.root)

    def test_current_native_artifact_and_fixture_pass_without_returning_details(self):
        result = self.probe()
        self.assertTrue(result['ok'], result)
        self.assertNotIn('private-fixture-text', json.dumps(result))
        self.assertEqual(len(health.NATIVE_CHECKS), 19)

    def test_old_installed_jar_rejected_even_when_new_python_and_report_are_ready(self):
        self.put(health.NATIVE_JAR, b'old 200-only callback artifact')
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['checks']['installed_jar_matches_tested_build'])
        self.assertTrue(result['checks']['all_native_boundaries'])

    def test_source_fixture_helper_and_fake_changes_do_not_reuse_success(self):
        self.assertTrue(self.probe()['ok'])
        self.put(health.NATIVE_BUILD_SOURCES[0], b'changed native source')
        self.assertFalse(self.probe()['checks']['build_sources_current'])
        self.put(health.NATIVE_FIXTURE, b'changed fixture')
        self.assertFalse(self.probe()['checks']['fixture_and_tools_current'])
        self.report['fakeNpcSha256'] = '0' * 64
        self.assertFalse(self.probe()['checks']['fake_npc_source_current'])
        self.put(health.NATIVE_HELPER, b"def fake_server_source():\n    raise RuntimeError('must not execute')\n")
        self.assertFalse(self.probe()['checks']['fake_npc_source_current'])

    def test_missing_report_missing_native_check_and_nonzero_effect_fail(self):
        self.assertFalse(health.native_behavior(self.root)['ok'])
        key = health.NATIVE_CHECKS[0]
        self.report['checks'].pop(key)
        self.assertFalse(self.probe()['checks']['all_native_boundaries'])
        self.report['checks'][key] = True
        self.report['ttsCalls'] = 1
        self.assertFalse(self.probe()['checks']['zero_external_effects'])
        self.report['ttsCalls'] = 0
        self.report['checks'][key] = 1
        self.assertFalse(self.probe()['checks']['all_native_boundaries'])

    def test_monitor_requires_native_evidence_even_when_python_and_live_pass(self):
        backend = SimpleNamespace(check=Mock(return_value={'ok': True}),
                                  behavior=Mock(return_value={'ok': True}),
                                  native_behavior=Mock(return_value={'ok': False}))
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda value: None))
        with patch.object(monitor.importlib.util, 'spec_from_file_location', return_value=spec), \
                patch.object(monitor.importlib.util, 'module_from_spec', return_value=backend):
            result = monitor.probe_maid_perception()
        self.assertFalse(result['ok'])
        self.assertTrue(result['live']['ok'])
        self.assertTrue(result['behavior']['ok'])
        self.assertFalse(result['native_behavior']['ok'])


if __name__ == '__main__':
    unittest.main()
