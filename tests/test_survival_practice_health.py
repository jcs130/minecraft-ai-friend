"""Practice readiness never claims mastery or executes model/game/test work."""
from copy import deepcopy
from contextlib import ExitStack
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('practice_health_under_test', ROOT / 'tools/survival_practice_health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class PracticeHealthTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        sources = {}
        for name in health.LIVE_SOURCES:
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(('source fixture ' + name).encode())
            sources[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.value = {'ok': True, 'sources': sources,
            'practice': {'available': True, 'schema': 1, 'runCount': 0, 'stepCount': 0,
                         'receiptCount': 0, 'refinementCount': 0}}

    def probe(self, value=None):
        return health.check(self.root, fetch=lambda: self.value if value is None else value)

    def test_zero_counts_are_ready_and_not_claimed_practice_success(self):
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        fetch = Mock(return_value=self.value)
        result = health.check(self.root, fetch)
        fetch.assert_called_once_with()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['state'], 'ready')
        self.assertEqual(result['counts'], dict.fromkeys(health.COUNTS, 0))
        self.assertEqual((result['modelCalls'], result['worldActions']), (0, 0))
        self.assertIn('neither a completed practice run', result['scope'])
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_nonzero_counts_still_only_prove_ready_storage(self):
        self.value['practice'].update(runCount=5, stepCount=12, receiptCount=18, refinementCount=3)
        result = self.probe()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['counts']['refinementCount'], 3)
        self.assertIn('nor an improved skill is established', result['scope'])

    def test_missing_projection_is_unavailable_not_zero(self):
        del self.value['practice']
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertTrue(result['checks']['adapter_ready'])
        self.assertEqual(result['counts'], dict.fromkeys(health.COUNTS))

    def test_schema_availability_and_adapter_boolean_are_strict(self):
        for field, bad in (('schema', True), ('schema', '1'), ('schema', 1.0), ('schema', 2),
                           ('available', False), ('available', 1), ('available', 'true')):
            value = deepcopy(self.value); value['practice'][field] = bad
            with self.subTest(field=field, bad=bad): self.assertFalse(self.probe(value)['ok'])
        for bad in (False, 1, 'true', None):
            value = deepcopy(self.value); value['ok'] = bad
            with self.subTest(ok=bad): self.assertFalse(self.probe(value)['ok'])

    def test_invalid_or_missing_counts_are_never_coerced(self):
        for field in health.COUNTS:
            for bad in (-1, True, 1.0, '1', None, health.MAX_COUNT + 1):
                value = deepcopy(self.value); value['practice'][field] = bad
                with self.subTest(field=field, bad=bad):
                    result = self.probe(value)
                    self.assertFalse(result['ok'])
                    self.assertEqual(result['counts'], dict.fromkeys(health.COUNTS))
            value = deepcopy(self.value); del value['practice'][field]
            self.assertFalse(self.probe(value)['ok'])

    def test_private_fields_fail_and_are_never_returned(self):
        for field, private in (('objective', 'private-objective'),
                               ('steps', [{'text': 'private-receipt'}]), ('modelOutput', 'private-output')):
            value = deepcopy(self.value); value['practice'][field] = private
            result = self.probe(value)
            self.assertFalse(result['checks']['public_projection'])
            self.assertNotIn('private-', json.dumps(result))
        # Unrelated top-level server data is not copied into our public result.
        self.value['unrelated'] = {'text': 'private-extra-body'}
        self.assertNotIn('private-extra-body', json.dumps(self.probe()))

    def test_live_source_drift_missing_and_foreign_proof_fail(self):
        self.assertTrue(self.probe()['ok'])
        source = health.LIVE_SOURCES[0]
        (self.root / source).write_bytes(b'new unverified source')
        self.assertFalse(self.probe()['checks']['current_runtime_sources'])
        self.value['sources'][source] = hashlib.sha256((self.root / source).read_bytes()).hexdigest()
        self.assertTrue(self.probe()['ok'])
        self.value['sources']['foreign.py'] = '0' * 64
        self.assertFalse(self.probe()['ok'])
        del self.value['sources']['foreign.py']; del self.value['sources'][source]
        self.assertFalse(self.probe()['ok'])

    def test_transport_failure_only_reports_type(self):
        result = health.check(self.root, fetch=Mock(side_effect=TimeoutError('secret-value')))
        self.assertFalse(result['ok'])
        self.assertEqual(result['errorType'], 'TimeoutError')
        self.assertNotIn('secret-value', json.dumps(result))

    def test_transport_is_one_fixed_internal_get_without_state_or_secrets(self):
        with patch.object(health.subprocess, 'run', return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(self.value))) as run:
            self.assertEqual(health.adapter_health(), self.value)
        args, kwargs = run.call_args
        self.assertEqual(args[0][:5], ['docker', 'exec', 'qiandengji-survivor-1', 'python', '-c'])
        self.assertIn("'http://127.0.0.1:8089/healthz'", args[0][5])
        for forbidden in ('Authorization', 'read_text', 'sqlite', 'data=', '18088', 'restart'):
            self.assertNotIn(forbidden, args[0][5])
        self.assertEqual(kwargs['timeout'], 12)
        self.assertEqual(kwargs['encoding'], 'utf8')
        self.assertNotIn('shell', kwargs)

    def test_nonzero_oversize_nonobject_and_invalid_json_fetches_fail(self):
        for code, raw in ((1, 'private-stderr'), (0, 'x' * 16385), (0, '[]'), (0, '{')):
            with self.subTest(code=code, size=len(raw)), patch.object(health.subprocess, 'run',
                    return_value=SimpleNamespace(returncode=code, stdout=raw)):
                with self.assertRaises(ValueError): health.adapter_health()


class PracticeEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.ids = []
        for name in health.SOURCES:
            self.put(name, '# Fixture source: ' + name + '\n')
        for index, name in enumerate(health.TEST_SOURCES):
            module = Path(name).stem
            methods = [f'test_case_{index}_{number}' for number in range(4)]
            self.ids.extend(module + '.PracticeTests.' + method for method in methods)
            self.put(name, 'import unittest\nclass PracticeTests(unittest.TestCase):\n' +
                ''.join('    def ' + method + '(self):\n        pass\n' for method in methods))
        hashes = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in health.SOURCES}
        self.report = {'schema': 1, 'kind': 'isolated_survival_practice', 'ok': True,
            'sourceUnchangedDuringRun': True, 'modelCalls': 0, 'worldActions': 0, 'productionMutations': 0,
            'checks': dict.fromkeys(health.REQUIRED_CHECKS, True), 'sourceHashes': hashes,
            'toolSha256': hashes[health.TOOL],
            'execution': {'runner': 'unittest', 'caseSelection': 'declared_methods_only',
                'testsRun': len(self.ids), 'tests': [{'id': name, 'outcome': 'passed'} for name in self.ids]},
            'checkTests': {name: [case] for name, case in zip(health.REQUIRED_CHECKS, self.ids)}}

    def put(self, name, text):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf8')

    def probe(self):
        self.put(health.REPORT, json.dumps(self.report))
        return health.behavior(self.root)

    def test_current_report_is_readonly_and_not_live_practice_proof(self):
        self.put('reports/old-survival-report.json', 'old bytes must remain')
        self.assertTrue(self.probe()['ok'])
        before = {str(path): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        result = health.behavior(self.root)
        self.assertTrue(result['ok'], result)
        self.assertEqual(before, {str(path): path.read_bytes() for path in self.root.rglob('*') if path.is_file()})
        self.assertIn('not evidence of a production game goal', result['scope'])

    def test_source_drift_is_not_fixed_by_historical_green(self):
        self.assertTrue(self.probe()['ok'])
        self.put(health.LIVE_SOURCES[0], '# changed source')
        self.assertFalse(self.probe()['checks']['current_sources'])

    def test_smoke_tool_hash_is_independent_and_required(self):
        self.report['toolSha256'] = '0' * 64
        self.assertFalse(self.probe()['checks']['current_smoke_tool'])
        self.report['toolSha256'] = self.report['sourceHashes'][health.TOOL]
        self.assertTrue(self.probe()['ok'])
        self.put(health.TOOL, '# changed producer')
        self.report['sourceHashes'][health.TOOL] = hashlib.sha256((self.root / health.TOOL).read_bytes()).hexdigest()
        self.assertFalse(self.probe()['checks']['current_smoke_tool'])

    def test_wrong_kind_schema_mutation_or_omitted_behavior_fails(self):
        original = deepcopy(self.report)
        for key, bad in (('kind', 'production_skill_mastered'), ('schema', True), ('ok', 1),
                          ('sourceUnchangedDuringRun', False), ('modelCalls', 1),
                          ('worldActions', True), ('productionMutations', 1)):
            self.report = deepcopy(original); self.report[key] = bad
            with self.subTest(key=key): self.assertFalse(self.probe()['ok'])
        self.report = deepcopy(original)
        del self.report['checks'][health.REQUIRED_CHECKS[0]]
        self.assertFalse(self.probe()['checks']['required_behavior'])

    def test_missing_or_traversing_sources_cannot_borrow_other_evidence(self):
        self.report['sourceHashes']['../outside.py'] = '0' * 64
        self.assertFalse(self.probe()['checks']['current_sources'])
        del self.report['sourceHashes']['../outside.py']
        del self.report['sourceHashes'][health.SOURCES[0]]
        self.assertFalse(self.probe()['checks']['current_sources'])

    def test_skipped_duplicate_or_inherited_cases_cannot_inflate_execution(self):
        original = deepcopy(self.report)
        self.report['execution']['tests'][0]['outcome'] = 'skipped'
        self.assertFalse(self.probe()['checks']['recorded_test_execution'])
        self.report = deepcopy(original)
        self.report['execution']['tests'][1] = self.report['execution']['tests'][0]
        self.assertFalse(self.probe()['checks']['recorded_test_execution'])
        self.report = deepcopy(original)
        inherited = self.ids[0].replace('PracticeTests.', 'InheritedTests.')
        self.report['execution']['tests'][0]['id'] = inherited
        self.report['checkTests'][health.REQUIRED_CHECKS[0]] = [inherited]
        # A subclass without the method's own declaration cannot supply this ID.
        first = health.TEST_SOURCES[0]
        self.put(first, (self.root / first).read_text('utf8') + '\nclass InheritedTests(PracticeTests):\n    pass\n')
        self.report['sourceHashes'][first] = hashlib.sha256((self.root / first).read_bytes()).hexdigest()
        self.assertFalse(self.probe()['checks']['recorded_test_execution'])

    def test_mapping_must_cover_actual_executed_cases_for_every_behavior(self):
        original = deepcopy(self.report)
        for bad in ([], [self.ids[0], self.ids[0]], ['unexecuted.Test.test_missing'], 'not-a-list'):
            self.report = deepcopy(original)
            self.report['checkTests'][health.REQUIRED_CHECKS[0]] = bad
            with self.subTest(bad=bad): self.assertFalse(self.probe()['checks']['recorded_test_execution'])
        self.report = deepcopy(original)
        del self.report['checkTests'][health.REQUIRED_CHECKS[0]]
        self.assertFalse(self.probe()['checks']['recorded_test_execution'])

    def test_execution_count_selection_and_runner_are_required(self):
        original = deepcopy(self.report)
        for key, bad in (('testsRun', 0), ('testsRun', True), ('testsRun', 9),
                          ('caseSelection', 'inherited_all'), ('runner', 'invented')):
            self.report = deepcopy(original); self.report['execution'][key] = bad
            with self.subTest(key=key): self.assertFalse(self.probe()['checks']['recorded_test_execution'])


class PracticeMonitorTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('practice_monitor_under_test', ROOT / 'world/ops/health/health_mon.py')
        self.monitor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.monitor)

    def test_runtime_and_isolated_behavior_both_required_without_running_production_probe(self):
        backend = SimpleNamespace(check=Mock(return_value={'ok': True}),
                                  behavior=Mock(return_value={'ok': False}))
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda value: None))
        with patch.object(self.monitor.importlib.util, 'spec_from_file_location', return_value=spec), \
                patch.object(self.monitor.importlib.util, 'module_from_spec', return_value=backend):
            result = self.monitor.probe_survival_practice()
        self.assertFalse(result['ok'])
        self.assertTrue(result['live']['ok'])
        self.assertFalse(result['behavior']['ok'])
        backend.check.assert_called_once_with(self.monitor.PROJECT)
        backend.behavior.assert_called_once_with(self.monitor.PROJECT)

    def test_panel_failure_and_existing_service_manifest_include_practice(self):
        with ExitStack() as stack:
            for name in dir(self.monitor):
                if name.startswith('probe_') and name not in ('probe_panel_smoke', 'probe_survival_practice'):
                    stack.enter_context(patch.object(self.monitor, name, return_value={'ok': True}))
            probe = stack.enter_context(patch.object(self.monitor, 'probe_survival_practice',
                return_value={'ok': False, 'live': {'ok': False}, 'behavior': {'ok': True}}))
            result = self.monitor.probe_panel_smoke()
        self.assertFalse(result['ok'])
        self.assertFalse(result['survival_practice']['live']['ok'])
        probe.assert_called_once_with()
        self.assertTrue(self.monitor.MANIFEST['survivor']['health_required'])
        self.assertIn('durable practice receipts', self.monitor.MANIFEST['survivor']['purpose'])


if __name__ == '__main__':
    unittest.main()
