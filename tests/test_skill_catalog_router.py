import copy
import tempfile
import unittest
from pathlib import Path

import test_survival_fast_execution as fast_fixtures
from controller import Controller
from numen_gateway import read_json, write_json
from skill_library import SkillLibrary, SkillError, evaluate
from skill_router import candidates, tick
from starter_skills import bundle, body, install


class Worker:
    def __init__(self):
        self.calls = []
        self.reply = None

    def submit(self, *args):
        self.calls.append(copy.deepcopy(args))
        return len(self.calls)

    def poll(self, token):
        return self.reply


class StarterSkillsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.library = SkillLibrary(Path(temp.name) / 'skills')

    def test_all_initial_programs_execute_fixtures_and_install_preserves_edits(self):
        result = install(self.library)
        self.assertEqual(len(result), 27)
        self.assertEqual(sum(r['automatic'] for r in result), 15)
        self.assertTrue(all(r['installed'] for r in result))
        self.assertTrue(all(not r['installed'] for r in install(self.library)))

    def test_craft_needs_both_native_receipt_and_inventory_gain(self):
        row = next(r for r in bundle() if r['name'] == 'base_craft_stick')
        state = body({'minecraft:oak_planks': 2})
        m = evaluate(row['source'], state)['memory']
        self.assertTrue(evaluate(row['source'], body({'minecraft:stick': 4}), m)['replan'])
        good = body({'minecraft:stick': 4}, execution={'lastExecution': {'status': 'succeeded', 'completionConfirmed': True}})
        self.assertTrue(evaluate(row['source'], good, m)['done'])
        good['counts'] = {}
        self.assertTrue(evaluate(row['source'], good, m)['replan'])

    def test_missing_table_and_stale_table_do_not_craft(self):
        row = next(r for r in bundle() if r['name'] == 'base_craft_iron_pickaxe')
        case = copy.deepcopy(row['fixtures'][0])
        case['state']['execution']['observation']['fresh'] = False
        self.assertTrue(evaluate(row['source'], case['state'], case['memory'])['replan'])
        self.assertTrue(evaluate(row['source'], case['state'], {})['replan'])

    def test_equipment_does_not_downgrade_or_oscillate(self):
        row = next(r for r in bundle() if r['name'] == 'base_equip_pickaxe')
        state = body({'minecraft:iron_pickaxe': 1}, equipment={'mainhand': {'item': 'minecraft:diamond_pickaxe'}})
        self.assertTrue(evaluate(row['source'], state)['replan'])

    def test_routing_requires_positive_and_refusal_initial_fixtures(self):
        row = copy.deepcopy(bundle()[0])
        row['fixtures'] = [r for r in row['fixtures'] if r.get('replan') is not True or r.get('memory')]
        with self.assertRaisesRegex(SkillError, 'routing_positive_and_refusal'):
            self.library.draft(**row)

    def test_learned_program_discovered_only_after_promotion_and_matching_goal(self):
        row = copy.deepcopy(next(r for r in bundle() if r['name'] == 'base_craft_stick'))
        row['name'] = 'learned_sticks_v2'
        draft = self.library.draft(**row)
        state = body({'minecraft:oak_planks': 2})
        self.assertEqual(candidates(self.library, state, '制作木棍'), [])
        self.library.test(row['name'], draft['version'])
        self.library.promote(row['name'], draft['version'])
        self.assertEqual(candidates(self.library, state, '制作木棍')[0]['name'], row['name'])
        self.assertEqual(candidates(self.library, state, '去公会领取任务'), [])
        self.assertEqual(candidates(self.library, body(), '制作木棍'), [])
        forged = self.library.catalog()
        forged['skills'][0]['routing']['maintenance'] = True
        self.assertEqual(candidates(self.library, state, '去公会领取任务', forged), [])


class CatalogExecutionTests(unittest.TestCase):
    create = fast_fixtures.FastExecutionTests.create

    def setUp(self):
        fast_fixtures.FastExecutionTests.setUp(self)
        self.worker = Worker()
        self.controller.policy_worker.close()
        self.controller.policy_worker = self.worker
        self.library = SkillLibrary(self.state / 'skills')
        install(self.library)
        self.controller.skills = self.library
        self.controller.settings.update(brainProtocol=1, memoryEpoch='test')
        self.gateway.body.update(counts={'minecraft:oak_planks': 2}, hunger=20, observedAt=self.clock() * 1000)
        self.control = read_json(self.state / 'control.json') | {'mission': '制作木棍'}
        write_json(self.state / 'control.json', self.control)

    def select(self):
        self.assertTrue(tick(self.controller, self.gateway.body, self.control))
        proposal = self.worker.calls[-1][0]
        candidate = proposal['candidates'][0]
        self.worker.reply = {'ok': True, 'choice': candidate['id'], 'action': candidate['action'],
                             'model': 'test', 'confidence': .99, 'stateSha256': 'testhash',
                             'observedAt': self.clock() * 1000, 'state': {'body': self.gateway.body}}

    def test_selection_queues_exact_version_then_existing_executor_dispatches_once(self):
        self.select()
        self.assertFalse(self.gateway.actions)
        self.assertTrue(tick(self.controller, self.gateway.body, self.control))
        job = read_json(self.state / 'skill-job.json')
        self.assertEqual(job['name'], 'base_craft_stick')
        self.assertTrue(job['practiceRunId'])
        self.assertFalse(self.gateway.actions)
        self.controller.tick_skill(self.gateway.body)
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertEqual(read_json(self.state / 'skill-job.json')['steps'], 1)
        self.assertTrue(any(e['kind'] == 'system_one_dispatch' for e in self.controller.data['episodes']))
        self.controller.tick_skill(self.gateway.body)  # No terminal receipt: do not repeat.
        self.assertEqual(len(self.gateway.actions), 1)

    def test_changed_body_discards_without_dispatch_or_automatic_retry(self):
        self.select()
        self.gateway.body['counts'] = {}
        self.assertFalse(tick(self.controller, self.gateway.body, self.control))
        self.assertFalse(tick(self.controller, self.gateway.body, self.control))
        self.assertEqual(len(self.worker.calls), 1)
        self.assertFalse(self.gateway.actions)

    def test_low_confidence_and_timeout_yield_to_slow_system(self):
        for result in ({'ok': False, 'code': 'policy_escalated'}, None):
            self.controller.data.pop('skillRouteAttempt', None)
            self.select()
            self.worker.reply = result
            if result is None:
                self.clock.now += 6
                self.gateway.body['observedAt'] = self.clock() * 1000
            self.assertFalse(tick(self.controller, self.gateway.body, self.control))
            self.assertFalse((self.state / 'skill-job.json').exists())

    def test_pause_unknown_goal_change_and_open_lease_prevent_queue(self):
        self.select()
        write_json(self.state / 'lease.json', {'status': 'open'})
        self.assertFalse(tick(self.controller, self.gateway.body, self.control))
        self.assertFalse((self.state / 'skill-job.json').exists())
        self.controller.data.pop('skillRouteAttempt', None)
        self.select()
        self.assertFalse(tick(self.controller, self.gateway.body, self.control | {'enabled': False}))
        self.assertFalse(self.gateway.actions)

    def test_changed_goal_version_unknown_and_review_cannot_consume_selection(self):
        for change in ('goal', 'version', 'unknown', 'review'):
            with self.subTest(change=change):
                self.controller.data.pop('skillRouteAttempt', None)
                self.select()
                if change == 'goal':
                    value = self.control | {'mission': '去别处探索'}
                else:
                    value = self.control
                if change == 'version':
                    old = self.library.read('base_craft_stick')
                    draft = self.library.draft('base_craft_stick', old['source'], old['fixtures'], 'revised', old['routing'])
                    self.library.test('base_craft_stick', draft['version'])
                    self.library.promote('base_craft_stick', draft['version'])
                if change == 'unknown':
                    write_json(self.state / 'unknown.json', {'status': 'unknown'})
                if change == 'review':
                    self.controller.reviews.request('routing-review')
                self.assertFalse(tick(self.controller, self.gateway.body, value))
                self.assertFalse((self.state / 'skill-job.json').exists())
                (self.state / 'unknown.json').unlink(missing_ok=True)

    def test_crash_after_selection_does_not_reclassify_unchanged_goal(self):
        self.select()
        self.controller.pending_route = None
        self.controller.data.pop('skillRoutePending', None)
        self.assertFalse(tick(self.controller, self.gateway.body, self.control))
        self.assertEqual(len(self.worker.calls), 1)


if __name__ == '__main__':
    unittest.main()
