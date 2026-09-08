"""Sandboxed persistent-work proposals: bounded waits and physical observations."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from skill_library import SkillError, SkillLibrary, evaluate


POINT = {'x': -530, 'y': 69, 'z': 890}
OBSERVE = {'tool': 'inspect_container', 'args': POINT}
SOURCE = '''function next(state,memory) {
  if (!state.ready) return {memory:memory,waitSeconds:60,reason:"Wait for the next local check"};
  return {memory:{checks:(memory.checks || 0)+1},observe:{
    tool:"inspect_container",args:{x:-530,y:69,z:890}}};
}'''
FIXTURES = [
    {'state': {'ready': False}, 'expectedWaitSeconds': 60, 'expectedObserve': None,
     'expectedMemory': {}},
    {'state': {'ready': True}, 'expectedWaitSeconds': None, 'expectedObserve': OBSERVE,
     'expectedMemory': {'checks': 1}},
]


def result(value):
    return evaluate('function next(){return ' + json.dumps(value) + ';}', {})


class FastSkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.library = SkillLibrary(self.temp.name)

    def test_old_result_contract_is_unchanged(self):
        self.assertEqual(result({'action': None, 'memory': {}, 'done': True}),
                         {'action': None, 'memory': {}, 'done': True, 'replan': False, 'reason': ''})
        with self.assertRaisesRegex(SkillError, 'invalid_skill_result'):
            result({'memory': {}, 'done': True})

    def test_explicit_wait_has_bounds_and_normalizes_without_action(self):
        for seconds in (15, 60, 300):
            with self.subTest(seconds=seconds):
                plan = result({'memory': {'stage': 'smelting'}, 'waitSeconds': seconds})
                self.assertIsNone(plan['action'])
                self.assertEqual(plan['waitSeconds'], seconds)
                self.assertEqual(plan['memory'], {'stage': 'smelting'})
                self.assertFalse(plan['done'] or plan['replan'])
        plan = result({'action': None, 'memory': {}, 'waitSeconds': 15, 'done': False})
        self.assertEqual(plan['waitSeconds'], 15)

    def test_wait_rejects_unbounded_or_noninteger_values(self):
        for seconds in (None, True, False, 0, -1, 14, 301, 2 ** 60, 15.5, '60', {}, []):
            with self.subTest(seconds=seconds), self.assertRaisesRegex(SkillError, 'invalid_skill_wait'):
                result({'action': None, 'memory': {}, 'waitSeconds': seconds})

    def test_observations_only_propose_two_exact_point_reads(self):
        for tool in ('inspect_block', 'inspect_container'):
            observation = {'tool': tool, 'args': POINT}
            plan = result({'memory': {'stage': 'check'}, 'observe': observation})
            self.assertEqual(plan['observe'], observation)
            self.assertIsNone(plan['action'])
            self.assertNotIn('waitSeconds', plan)
        for point in ({'x': -29999984, 'y': -64, 'z': 29999984},
                      {'x': 29999984, 'y': 319, 'z': -29999984}):
            plan = result({'memory': {}, 'observe': {'tool': 'inspect_block', 'args': point}})
            self.assertEqual(plan['observe']['args'], point)

    def test_observations_reject_writes_aliases_and_extra_arguments(self):
        bad = [None, [], {}, {'tool': 'inspect_block'},
               {'tool': 'inspect_block', 'args': POINT, 'url': 'http://example.invalid'},
               {'tool': 'open_container', 'args': POINT}, {'tool': 'scan_blocks', 'args': POINT},
               {'tool': 'shell', 'args': {'cmd': 'example'}},
               {'tool': 'inspect', 'args': POINT},
               {'tool': ['inspect_block'], 'args': POINT},
               {'tool': 'inspect_block', 'args': dict(POINT, dimension='minecraft:the_nether')},
               {'tool': 'inspect_block', 'args': {'x': 0, 'z': 0}}]
        for observation in bad:
            with self.subTest(observation=observation), self.assertRaisesRegex(SkillError, 'invalid_skill_observation'):
                result({'memory': {}, 'observe': observation})

    def test_observations_require_integer_coordinates_in_world_bounds(self):
        for key, value in (('x', -29999985), ('x', 29999985), ('z', 29999985),
                           ('y', -65), ('y', 320), ('x', True), ('y', 69.5),
                           ('z', '890'), ('y', None), ('x', 10 ** 1000)):
            with self.subTest(key=key, value=value), self.assertRaisesRegex(SkillError, 'invalid_skill_observation'):
                result({'memory': {}, 'observe': {'tool': 'inspect_block', 'args': dict(POINT, **{key: value})}})

    def test_one_request_per_step_and_no_request_with_terminal_result(self):
        action = {'tool': 'eat', 'args': {'item_id': 'minecraft:bread'}}
        bad = [dict(waitSeconds=60, observe=OBSERVE), dict(waitSeconds=60, action=action),
               dict(observe=OBSERVE, action=action), dict(waitSeconds=60, done=True),
               dict(waitSeconds=60, replan=True), dict(observe=OBSERVE, done=True),
               dict(observe=OBSERVE, replan=True)]
        for request in bad:
            with self.subTest(request=request), self.assertRaisesRegex(SkillError, 'conflicting_skill_requests'):
                result(dict(memory={}, **request))

    def test_wait_and_observation_do_not_add_any_host_io(self):
        source = '''function next(s,m){return {waitSeconds:15,memory:{
          Date:typeof Date,fetch:typeof fetch,require:typeof require,
          setTimeout:typeof setTimeout,python:typeof python}};}'''
        self.assertTrue(all(value == 'undefined' for value in evaluate(source, {})['memory'].values()))
        with self.assertRaisesRegex(SkillError, 'skill_cpu_limit'):
            evaluate('function next(){return {memory:{},observe:{get tool(){while(true){}},args:{}}};}', {})

    def test_fixtures_certify_exact_wait_observation_and_memory_before_promotion(self):
        version = self.library.draft('check_furnace', SOURCE, FIXTURES)['version']
        with self.assertRaises(SkillError):
            self.library.promote('check_furnace', version)
        report = self.library.test('check_furnace', version)
        self.assertTrue(report['passed'])
        self.library.promote('check_furnace', version)
        self.assertEqual(self.library.run('check_furnace', {'ready': False})['waitSeconds'], 60)
        self.assertEqual(self.library.run('check_furnace', {'ready': True})['observe'], OBSERVE)
        self.assertEqual(self.library.catalog()['observationTools'], ['inspect_block', 'inspect_container'])

    def test_wrong_expected_wait_or_point_fails_publication(self):
        for field, wrong in (('expectedWaitSeconds', 30),
                             ('expectedObserve', {'tool': 'inspect_container', 'args': dict(POINT, x=-529)})):
            fixtures = json.loads(json.dumps(FIXTURES))
            fixtures[0 if field == 'expectedWaitSeconds' else 1][field] = wrong
            version = self.library.draft('check_furnace', SOURCE, fixtures)['version']
            self.assertFalse(self.library.test('check_furnace', version)['passed'])
            with self.assertRaisesRegex(SkillError, 'matching_passed_tests_required'):
                self.library.promote('check_furnace', version)

    def test_invalid_new_fixture_expectations_cannot_be_saved(self):
        for field, wrong in (('expectedWaitSeconds', True), ('expectedWaitSeconds', 301),
                             ('expectedObserve', {'tool': 'open_container', 'args': POINT}),
                             ('expectedObserve', {'tool': 'inspect_block', 'args': dict(POINT, y=320)})):
            fixtures = json.loads(json.dumps(FIXTURES))
            fixtures[0][field] = wrong
            with self.subTest(field=field, wrong=wrong), self.assertRaises(SkillError):
                self.library.draft('check_furnace', SOURCE, fixtures)

    def test_old_promoted_version_requires_real_retest_when_kernel_changes(self):
        version = self.library.draft('check_furnace', SOURCE, FIXTURES)['version']
        with patch('skill_library._kernel_version', return_value='previous-kernel'):
            self.library.test('check_furnace', version)
            self.library.promote('check_furnace', version)
        with self.assertRaisesRegex(SkillError, 'matching_passed_tests_required'):
            self.library.run('check_furnace', {'ready': False})
        self.assertTrue(self.library.test('check_furnace', version)['passed'])
        self.assertEqual(self.library.run('check_furnace', {'ready': False})['waitSeconds'], 60)


if __name__ == '__main__':
    unittest.main()
