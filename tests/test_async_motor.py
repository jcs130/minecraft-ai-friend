"""Independent motor, durable dispatch and native-task interruption contracts."""
import copy
import unittest
from unittest.mock import patch
import test_skill_catalog_router as fixtures
from numen_gateway import read_json, write_json, action_lock
from motor_mailbox import open_cognition, enqueue_locked, claim_locked, view
from motor_loop import tick as motor_tick, reconcile, preempt
from skill_router import tick as route


class AsyncMotorTests(unittest.TestCase):
    create = fixtures.CatalogExecutionTests.create

    def setUp(self):
        fixtures.CatalogExecutionTests.setUp(self)
        self.c = self.controller
        self.c.settings['asyncMotor'] = True
        write_json(self.state/'settings.json', self.c.settings)
        self.c.data['active'] = {'turnId':'survival-plan-0001', 'taskId':'native-running', 'bodyAccess':'queued'}
        open_cognition(self.state, 'survival-plan-0001', (self.clock()+60)*1000, self.clock)

    def test_classifier_and_program_dispatch_while_slow_model_still_running(self):
        fixtures.CatalogExecutionTests.select(self)
        self.assertTrue(route(self.c, self.gateway.body, self.control))
        motor_tick(self.c, self.gateway.body, self.control)
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertEqual(self.c.data['active']['taskId'], 'native-running')
        self.assertFalse(self.backend.submitted)

    def test_slow_completion_does_not_close_motor_lease(self):
        self.c.close_model_authority(self.c.data['active'])
        self.assertFalse(self.gateway.closed)
        self.assertEqual(read_json(self.state/'cognition-lease.json')['status'], 'closed')

    def test_skill_start_queues_exact_version_without_overwriting_running_job(self):
        from mcp_server import SkillTools
        old = {'status':'running','turnId':'existing-body-program'}
        write_json(self.state/'skill-job.json', old)
        record = self.library.read('base_craft_stick')
        result = SkillTools(self.state, self.library, self.clock).start(
            'survival-plan-0001', 'base_craft_stick', record['version'], max_steps=4)
        self.assertEqual(result['code'], 'motor_queued')
        self.assertEqual(read_json(self.state/'skill-job.json'), old)
        self.assertEqual(view(self.state)['requests'][0]['payload']['version'], record['version'])

    def test_controller_advances_program_and_polls_same_running_model_in_one_tick(self):
        # Start through the actual controller, not a fabricated running handle.
        self.c.close_model_authority(self.c.data['active'])
        self.c.data['active'] = None
        self.c.submit_model(self.gateway.body, self.control)
        active = copy.deepcopy(self.c.data['active'])
        self.assertEqual(active['bodyAccess'], 'queued')
        fixtures.CatalogExecutionTests.select(self)
        self.assertTrue(route(self.c, self.gateway.body, self.control))
        self.c.tick()
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertEqual(self.c.data['active']['taskId'], active['taskId'])

    def test_changed_facts_allow_new_selection_without_new_model_decision(self):
        fixtures.CatalogExecutionTests.select(self)
        self.worker.reply = {'ok':False, 'code':'policy_escalated'}
        self.assertFalse(route(self.c, self.gateway.body, self.control))
        self.assertFalse(route(self.c, self.gateway.body, self.control))
        self.gateway.body['hunger'] = 8
        self.assertTrue(route(self.c, self.gateway.body, self.control))
        self.assertEqual(len(self.worker.calls), 2)
        self.assertFalse(self.backend.submitted)

    def draft_routed_sticks(self, name, intent):
        row = copy.deepcopy(next(r for r in fixtures.bundle() if r['name'] == 'base_craft_stick'))
        row.update(name=name, routing={'intents': [intent], 'maintenance': False})
        draft = self.library.draft(**row)
        self.library.test(name, draft['version'])
        return draft['version']

    def refresh_catalog_time(self):
        self.clock.now += 31
        self.gateway.body['observedAt'] = self.clock() * 1000

    def test_promoted_catalog_revision_reconsiders_unchanged_goal(self):
        self.control['mission'] = 'learned-route'
        write_json(self.state/'control.json', self.control)
        version = self.draft_routed_sticks('learned_route', 'learned-route')
        self.assertFalse(route(self.c, self.gateway.body, self.control))
        self.assertFalse(self.worker.calls)
        first_attempt = self.c.data['skillRouteAttempt']

        self.library.promote('learned_route', version)
        self.refresh_catalog_time()

        self.assertTrue(route(self.c, self.gateway.body, self.control))
        self.assertNotEqual(self.c.data['skillRouteAttempt'], first_attempt)
        self.assertEqual([r['name'] for r in self.c.pending_route['rows']], ['learned_route'])
        self.assertEqual(len(self.worker.calls), 1)
        self.assertFalse(self.gateway.actions)

    def test_unchanged_catalog_draft_and_position_do_not_retry_classification(self):
        fixtures.CatalogExecutionTests.select(self)
        self.worker.reply = {'ok': False, 'code': 'policy_escalated'}
        self.assertFalse(route(self.c, self.gateway.body, self.control))
        first_attempt = self.c.data['skillRouteAttempt']
        self.draft_routed_sticks('unpromoted_sticks', 'stick')
        self.refresh_catalog_time()
        self.gateway.body['position']['x'] += 3

        with patch.object(self.library, 'catalog', wraps=self.library.catalog) as catalog, \
             patch('skill_router.candidates', side_effect=AssertionError('unchanged admission was retried')):
            for _ in range(4):
                self.assertFalse(route(self.c, self.gateway.body, self.control))
            self.assertLessEqual(catalog.call_count, 1)
        self.assertEqual(self.c.data['skillRouteAttempt'], first_attempt)
        self.assertEqual(len(self.worker.calls), 1)
        self.assertFalse(self.gateway.actions)

    def test_catalog_revision_preserves_used_program_goal_dedup(self):
        fixtures.CatalogExecutionTests.select(self)
        self.assertTrue(route(self.c, self.gateway.body, self.control))
        used = copy.deepcopy(self.c.data['motorRoutedPrograms'])
        job = read_json(self.state/'skill-job.json')
        write_json(self.state/'skill-job.json', job | {'status': 'done', 'practiceFinalized': True})
        version = self.draft_routed_sticks('learned_sticks', self.control['mission'])
        self.library.promote('learned_sticks', version)
        self.refresh_catalog_time()

        self.assertTrue(route(self.c, self.gateway.body, self.control))
        self.assertEqual([r['name'] for r in self.c.pending_route['rows']], ['learned_sticks'])
        self.assertEqual(self.c.data['motorRoutedPrograms'], used)
        self.assertEqual(len(self.worker.calls), 2)
        self.assertFalse(self.gateway.actions)

    def test_claim_without_receipt_pauses_and_is_never_redispatched(self):
        with action_lock(self.state):
            enqueue_locked(self.state, 'survival-plan-0001', 'action', {'tool':'eat','args':{}}, self.clock)
            claim_locked(self.state, self.clock)
        self.gateway.turn_receipts = lambda turn: []
        reconcile(self.c)
        self.assertEqual(view(self.state)['requests'][0]['status'], 'unknown')
        self.assertFalse(read_json(self.state/'control.json')['enabled'])
        self.assertFalse(self.gateway.actions)

    def test_busy_classifier_interrupt_is_bound_to_current_action(self):
        body = copy.deepcopy(self.gateway.body)
        body['task'] = {'busy':True,'task_id':'t123'}
        receipt = {'status':'in_flight','actionId':'a'*32,'tool':'goto'}
        self.c.data['actionExecution'] = {'inFlight':True,'receipt':receipt}
        self.c.data['goalSwitchPending'] = True
        preempt(self.c, body, self.control)
        self.worker.reply = {'code':'policy_escalated','choice':'interrupt','confidence':.99}
        calls = []
        self.gateway.enforce_navigation_deadline = lambda body, **kw: calls.append(kw)
        preempt(self.c, body, self.control)
        self.assertEqual(calls, [{'preempt_action_id':'a'*32}])
        self.assertFalse(self.gateway.actions)

    def test_changed_native_task_discards_interrupt(self):
        body = copy.deepcopy(self.gateway.body)
        body['task'] = {'busy':True,'task_id':'t123'}
        self.c.data['actionExecution'] = {'inFlight':True,'receipt':{'status':'in_flight','actionId':'a'*32,'tool':'goto'}}
        preempt(self.c, body, self.control)
        self.worker.reply = {'code':'policy_escalated','choice':'interrupt','confidence':.99}
        body['task']['task_id'] = 't124'
        self.gateway.enforce_navigation_deadline = lambda *a, **kw: self.fail('must not stop another task')
        preempt(self.c, body, self.control)
        self.assertIsNone(self.c.pending_motor)


if __name__ == '__main__':
    unittest.main()
