"""Test-proof changes invalidate candidate caches without buying action retries."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_survival_fast_execution as fast_fixtures
from test_skill_catalog_router import Worker
from numen_gateway import read_json, write_json
from skill_library import SkillLibrary, SkillError
from skill_router import _catalog_signature, candidates, tick
from starter_skills import bundle, body


def install_one(library):
    row = copy.deepcopy(next(r for r in bundle() if r['name'] == 'base_craft_stick'))
    version = library.draft(**row)['version']
    library.test(row['name'], version)
    library.promote(row['name'], version)
    return row['name'], version


class CatalogProofTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.library = SkillLibrary(Path(temp.name) / 'skills')
        self.kernel = 'a' * 64
        patched = patch('skill_library._kernel_version', side_effect=lambda: self.kernel)
        patched.start()
        self.addCleanup(patched.stop)
        self.name, self.version = install_one(self.library)

    def test_stale_kernel_has_reason_and_real_retest_refreshes_index_without_source_or_head_change(self):
        paths = [self.library.root / self.name / 'head.json',
                 self.library.root / self.name / 'versions' / (self.version + '.json')]
        before = [p.read_bytes() for p in paths]
        self.kernel = 'b' * 64
        catalog = self.library.catalog()
        status = catalog['skills'][0].get('testEligibility', {})
        self.assertEqual(status.get('status'), 'stale')
        self.assertIn('kernel_changed', status['reasons'])
        with self.assertRaisesRegex(SkillError, 'matching_passed_tests_required'):
            self.library.run(self.name, body({'minecraft:oak_planks': 2}), {}, self.version)
        old_signature = _catalog_signature(catalog)
        self.assertTrue(self.library.test(self.name, self.version)['passed'])
        renewed = self.library.catalog()
        self.assertEqual(renewed['skills'][0]['testEligibility']['status'], 'current')
        self.assertNotEqual(_catalog_signature(renewed), old_signature)
        self.assertEqual([p.read_bytes() for p in paths], before)
        self.assertEqual(candidates(self.library, body({'minecraft:oak_planks': 2}), '制作木棍')[0]['name'], self.name)

    def test_same_proof_retest_does_not_change_eligibility_fingerprint(self):
        before = self.library.catalog()
        self.assertIn('testProof', before['skills'][0])
        with patch('skill_library.time.time', return_value=9999999999):
            self.library.test(self.name, self.version)
        self.assertEqual(_catalog_signature(before), _catalog_signature(self.library.catalog()))

    def test_legacy_index_is_unknown_and_exact_execution_still_checks_proof(self):
        path = self.library.root / 'catalog.json'
        index = read_json(path)
        index['skills'][0].pop('testProof', None)
        write_json(path, index)
        catalog = self.library.catalog()
        self.assertEqual(catalog['skills'][0].get('testEligibility', {}).get('status'), 'unknown')
        self.assertTrue(candidates(self.library, body({'minecraft:oak_planks': 2}), '制作木棍'))
        self.kernel = 'b' * 64
        diagnostics = {}
        self.assertFalse(candidates(self.library, body({'minecraft:oak_planks': 2}), '制作木棍', diagnostics=diagnostics))
        self.assertEqual(diagnostics['counts']['matching_passed_tests_required'], 1)

    def test_catalog_only_reads_bounded_indexes_and_rebuild_recovers_proof(self):
        self.kernel = 'b' * 64
        rebuilt = self.library.rebuild_index()
        self.assertEqual(rebuilt['skills'][0].get('testEligibility', {}).get('status'), 'stale')
        with patch.object(self.library, '_load', wraps=self.library._load) as reads, \
                patch.object(Path, 'iterdir', side_effect=AssertionError('catalog scanned folders')):
            self.library.catalog()
        self.assertEqual([call.args[0].name for call in reads.call_args_list], ['catalog.json'])

    def test_cached_current_proof_never_grants_execution_after_report_changes(self):
        catalog = self.library.catalog()
        self.assertEqual(catalog['skills'][0]['testEligibility']['status'], 'current')
        path = self.library.root / self.name / 'reports' / (self.version + '.json')
        report = read_json(path)
        report['passed'] = False
        write_json(path, report)
        diagnostics = {}
        self.assertFalse(candidates(self.library, body({'minecraft:oak_planks': 2}),
                                    '制作木棍', catalog, diagnostics))
        self.assertEqual(diagnostics['counts']['matching_passed_tests_required'], 1)

    def test_shared_publication_carries_proof_and_reader_detects_new_kernel(self):
        shared = self.library.root.parent / 'shared'
        publisher = SkillLibrary(self.library.root, shared)
        publisher.publish(self.name, self.version)
        reader = SkillLibrary(self.library.root.parent / 'reader', shared)
        self.assertEqual(reader.catalog()['skills'][0]['testEligibility']['status'], 'current')
        self.kernel = 'b' * 64
        self.assertEqual(reader.catalog()['skills'][0]['testEligibility']['status'], 'stale')
        with patch.object(reader, '_load', wraps=reader._load) as reads:
            reader.catalog()
        self.assertEqual([call.args[0].name for call in reads.call_args_list], ['catalog.json', 'catalog.json'])


class PreviewDiagnosticsTests(unittest.TestCase):
    def test_many_rejections_are_bounded_and_exception_text_is_not_exposed(self):
        class Unavailable:
            def read(self, *args):
                raise SkillError('matching_passed_tests_required')
        catalog = {'skills': [{'name': 'skill_' + str(i), 'activeVersion': str(i),
            'routing': {'intents': ['food'], 'maintenance': True}} for i in range(64)]}
        diagnostics = {}
        self.assertFalse(candidates(Unavailable(), {}, 'food', catalog, diagnostics))
        self.assertEqual(diagnostics['counts']['matching_passed_tests_required'], 64)
        self.assertEqual(len(diagnostics['rejected']), 8)


class RoutingProofTests(unittest.TestCase):
    create = fast_fixtures.FastExecutionTests.create

    def setUp(self):
        fast_fixtures.FastExecutionTests.setUp(self)
        self.controller.policy_worker.close()
        self.worker = Worker()
        self.controller.policy_worker = self.worker
        self.kernel = 'a' * 64
        patched = patch('skill_library._kernel_version', side_effect=lambda: self.kernel)
        patched.start()
        self.addCleanup(patched.stop)
        self.library = SkillLibrary(self.state / 'skills')
        self.name, self.version = install_one(self.library)
        self.controller.skills = self.library
        self.controller.settings.update(brainProtocol=1, memoryEpoch='test', asyncMotor=True)
        self.gateway.body.update(counts={'minecraft:oak_planks': 2}, hunger=20, observedAt=self.clock() * 1000)
        self.control = read_json(self.state / 'control.json') | {'mission': '制作木棍'}
        write_json(self.state / 'control.json', self.control)

    def advance_cache(self):
        self.clock.now += 31
        self.gateway.body['observedAt'] = self.clock() * 1000

    def test_stale_no_candidate_is_visible_and_retest_reopens_same_goal_after_bounded_cache(self):
        self.kernel = 'b' * 64
        self.assertFalse(tick(self.controller, self.gateway.body, self.control))
        last = self.controller.data.get('skillRouteLast', {})
        self.assertEqual(last.get('code'), 'skill_route_no_candidates')
        self.assertEqual(last['diagnostics']['counts']['matching_passed_tests_required'], 1)
        attempt = self.controller.data['skillRouteAttempt']
        self.assertFalse(self.worker.calls)
        self.library.test(self.name, self.version)
        with patch.object(self.library, 'catalog', wraps=self.library.catalog) as catalogs:
            for _ in range(3):
                self.assertFalse(tick(self.controller, self.gateway.body, self.control))
            self.assertEqual(catalogs.call_count, 0)
            self.advance_cache()
            self.assertTrue(tick(self.controller, self.gateway.body, self.control))
            self.assertEqual(catalogs.call_count, 1)
        self.assertNotEqual(self.controller.data['skillRouteAttempt'], attempt)
        self.assertEqual(len(self.worker.calls), 1)
        self.assertFalse(self.gateway.actions)

    def test_revalidated_used_craft_cannot_buy_another_goal_version_attempt(self):
        self.assertTrue(tick(self.controller, self.gateway.body, self.control))
        candidate = self.worker.calls[-1][0]['candidates'][0]
        self.worker.reply = {'ok': True, 'choice': candidate['id'], 'action': candidate['action']}
        self.assertTrue(tick(self.controller, self.gateway.body, self.control))
        used = copy.deepcopy(self.controller.data['motorRoutedPrograms'])
        write_json(self.state / 'skill-job.json', {'status': 'done'})
        self.kernel = 'b' * 64
        self.library.test(self.name, self.version)
        self.advance_cache()
        self.assertFalse(tick(self.controller, self.gateway.body, self.control))
        self.assertEqual(len(self.worker.calls), 1)
        self.assertEqual(self.controller.data['motorRoutedPrograms'], used)
        last = self.controller.data.get('skillRouteLast', {})
        self.assertEqual(last.get('code'), 'skill_route_no_candidates')
        self.assertEqual(last['diagnostics']['counts']['goal_version_already_used'], 1)
        self.assertFalse(self.gateway.actions)


if __name__ == '__main__':
    unittest.main()
