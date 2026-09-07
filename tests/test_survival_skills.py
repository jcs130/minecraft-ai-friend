"""Real JavaScript execution and publication barriers for learned skills."""
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from skill_library import SkillLibrary, SkillError, evaluate


SOURCE = '''function next(state, memory) {
  if ((state.inventory["minecraft:oak_log"] || 0) >= 8)
    return {action:null,memory:memory,done:true,reason:"Wood goal observed"};
  return {action:{tool:"mine",args:{block_ids:["minecraft:oak_log"],count:4}},
          memory:{attempts:(memory.attempts || 0)+1},reason:"Collect real wood"};
}'''
FIXTURES = [
    {'state': {'inventory': {}}, 'memory': {}, 'expectedActionTool': 'mine', 'done': False,
     'expectedMemory': {'attempts': 1}},
    {'state': {'inventory': {'minecraft:oak_log': 8}}, 'memory': {'attempts': 1},
     'expectedActionTool': None, 'done': True, 'expectedMemory': {'attempts': 1}},
]


class SkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.library = SkillLibrary(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def draft(self, source=SOURCE):
        return self.library.draft('gather_wood', source, FIXTURES, 'Collect eight logs')['version']

    def test_real_program_can_learn_and_reuse_without_game_callbacks(self):
        version = self.draft()
        report = self.library.test('gather_wood', version)
        self.assertTrue(report['passed'])
        self.library.promote('gather_wood', version)
        result = self.library.run('gather_wood', {'inventory': {}}, {'attempts': 3})
        self.assertEqual(result['action']['tool'], 'mine')
        self.assertEqual(result['memory']['attempts'], 4)
        self.assertEqual(result['skill']['version'], version)
        self.assertTrue(self.library.run('gather_wood', FIXTURES[1]['state'])['done'])
        self.assertTrue(self.library.read('gather_wood')['promoted'])
        self.assertEqual(self.library.catalog()['skills'][0]['activeVersion'], version)

    def test_draft_cannot_execute_or_promote_without_tests(self):
        version = self.draft()
        with self.assertRaises(SkillError): self.library.promote('gather_wood', version)
        with self.assertRaisesRegex(SkillError, 'promoted_skill_required'):
            self.library.run('gather_wood', {}, version=version)

    def test_failed_tests_cannot_promote(self):
        version = self.draft('function next(s,m){return {action:null,memory:m,done:true};}')
        self.assertFalse(self.library.test('gather_wood', version)['passed'])
        with self.assertRaisesRegex(SkillError, 'matching_passed_tests_required'):
            self.library.promote('gather_wood', version)

    def test_new_version_requires_new_tests_and_retains_old_version(self):
        old = self.draft(); self.library.test('gather_wood', old); self.library.promote('gather_wood', old)
        new = self.draft(SOURCE.replace('count:4', 'count:6'))
        self.assertNotEqual(old, new)
        with self.assertRaises(SkillError): self.library.promote('gather_wood', new)
        self.assertEqual(self.library.run('gather_wood', {'inventory': {}})['action']['args']['count'], 4)
        self.library.test('gather_wood', new); self.library.promote('gather_wood', new)
        self.assertEqual(self.library.run('gather_wood', {'inventory': {}})['action']['args']['count'], 6)
        self.assertEqual(self.library.run('gather_wood', {'inventory': {}}, version=old)['action']['args']['count'], 4)

    def test_changed_source_cannot_reuse_passed_report(self):
        version = self.draft(); self.library.test('gather_wood', version)
        target = Path(self.temp.name) / 'gather_wood/versions' / (version + '.json')
        record = json.loads(target.read_text()); record['source'] = SOURCE + '\n// changed'
        target.write_text(json.dumps(record))
        with self.assertRaisesRegex(SkillError, 'skill_version_changed'):
            self.library.promote('gather_wood', version)

    def test_old_kernel_report_cannot_promote(self):
        version = self.draft(); self.library.test('gather_wood', version)
        target = Path(self.temp.name) / 'gather_wood/reports' / (version + '.json')
        report = json.loads(target.read_text()); report['kernelVersion'] = 'old'
        target.write_text(json.dumps(report))
        with self.assertRaisesRegex(SkillError, 'matching_passed_tests_required'):
            self.library.promote('gather_wood', version)

    def test_infinite_loop_has_cpu_budget(self):
        started = time.monotonic()
        with self.assertRaisesRegex(SkillError, 'skill_cpu_limit'):
            evaluate('function next(){while(true){}}', {})
        self.assertLess(time.monotonic() - started, 3)

    def test_memory_and_stack_have_budgets(self):
        with self.assertRaisesRegex(SkillError, 'skill_memory_limit'):
            evaluate('function next(){return new ArrayBuffer(128*1024*1024);}', {})
        with self.assertRaisesRegex(SkillError, 'skill_stack_limit'):
            evaluate('function next(){return next();}', {})

    def test_host_io_is_absent(self):
        source = '''function next(s,m){return {action:null,memory:{
          require:typeof require, process:typeof process, fetch:typeof fetch,
          read:typeof read, std:typeof std, os:typeof os, python:typeof python,
          setTimeout:typeof setTimeout, Date:typeof Date},done:true};}'''
        self.assertTrue(all(value == 'undefined' for value in evaluate(source, {})['memory'].values()))
        for source in ('function next(){return require("fs").readFileSync("/etc/passwd");}',
                       'function next(){return fetch("http://mc:25575");}',
                       'function next(){return Math.random();}'):
            with self.assertRaises(SkillError): evaluate(source, {})

    def test_context_state_does_not_leak_between_steps(self):
        source = 'globalThis.count=(globalThis.count||0)+1;function next(){return {action:null,memory:{n:globalThis.count},done:true};}'
        self.assertEqual(evaluate(source, {})['memory'], {'n': 1})
        self.assertEqual(evaluate(source, {})['memory'], {'n': 1})

    def test_invalid_program_results_are_rejected(self):
        bad = ['return null', 'return []', 'return {}', 'return Promise.resolve({})',
               'return {action:null,memory:{},done:1}',
               'return {action:null,memory:{},extra:"evil"}',
               'return {action:{tool:"shell",args:{}},memory:{}}',
               'return {action:{tool:"mine",args:{}},memory:{},done:true}',
               'return {action:null,memory:[],done:true}']
        for body in bad:
            with self.subTest(body=body), self.assertRaises(SkillError):
                evaluate('function next(){' + body + ';}', {})

    def test_fixture_and_identifier_validation(self):
        for fixtures in ([], [FIXTURES[0]], [FIXTURES[0], FIXTURES[0]],
                         [{'state': {}, 'memory': {}}, FIXTURES[1]]):
            with self.assertRaises(SkillError): self.library.draft('test', SOURCE, fixtures)
        for name in ('../kernel', '/etc/passwd', 'x/y', 'X', '.', ''):
            with self.assertRaises(SkillError): self.library.draft(name, SOURCE, FIXTURES)

    def test_serialization_getter_cannot_escape_cpu_budget(self):
        source = 'function next(){return {toJSON(){while(true){}}};}'
        with self.assertRaisesRegex(SkillError, 'skill_cpu_limit'): evaluate(source, {})

    def test_repair_feedback_is_a_fixed_code_without_arbitrary_exception_text(self):
        with self.assertRaisesRegex(SkillError, 'skill_syntax_error'):
            evaluate('function next( { !! }', {})
        with self.assertRaisesRegex(SkillError, 'skill_reference_error'):
            evaluate('function next(){return missingFunction();}', {})
        with self.assertRaises(SkillError) as failure:
            evaluate('function next(){throw new Error("sensitive user text");}', {})
        self.assertNotIn('sensitive', str(failure.exception))


if __name__ == '__main__':
    unittest.main()
