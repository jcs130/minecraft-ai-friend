"""Controller integration for local wait/read programs; no live model or world IO."""
import copy
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

from test_survival_controller import FakeClock, FakeBackend, FakeGateway, FakeSkills, BODY_UUID, VERSION
from controller import Controller
from fast_execution import observation_view, program_observation
from numen_gateway import GatewayError, read_json, write_json


POINT = {'x': 101, 'y': 64, 'z': 100}
EPOCH = 'dfab5ecd-e1e2-4d92-9739-23686c40d53e'
OTHER_EPOCH = 'fa7bb32f-5998-4587-b567-21bdf28104ee'


class FastExecutionTests(unittest.TestCase):
    # Reuse only fixtures, not ControllerTests: discovery must not rerun its suite.
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name) / 'state'
        self.public = Path(temporary.name) / 'public/survivor.json'
        self.state.mkdir()
        self.clock, self.backend, self.skills = FakeClock(), FakeBackend(), FakeSkills()
        self.gateway = FakeGateway(self.state, self.clock)
        self.gateway.body['navigationEpoch'] = EPOCH
        self.settings = {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
                         'mission': 'Continue locally while the furnace works',
                         'decisionsPerDay': 2, 'decisionCooldownSeconds': 180,
                         'taskTimeoutSeconds': 60, 'maxSkillSteps': 32, 'maxSkillSeconds': 900,
                         'observationSeconds': 15, 'autonomyReviewSeconds': 1800,
                         'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160}}
        write_json(self.state / 'settings.json', self.settings)
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': True})
        self.controller = self.create()

    def create(self):
        return Controller(self.state, self.public, self.gateway, self.backend, self.clock, self.skills)

    def job(self, **updates):
        value = {'schema': 1, 'status': 'pending', 'name': 'gather_wood', 'version': VERSION,
                 'memory': {}, 'maxSteps': 32, **updates}
        write_json(self.state / 'skill-job.json', value)
        return value

    def saved_job(self):
        return read_json(self.state / 'skill-job.json')

    def wait(self, seconds=15, **updates):
        self.skills.reply = {'action': None, 'memory': {}, 'waitSeconds': seconds, **updates}

    def observe(self, tool='inspect_block'):
        self.skills.reply = {'action': None, 'memory': {'requested': True},
                             'observe': {'tool': tool, 'args': POINT}}

    def exhaust_model_budget(self):
        self.controller.data['decisions'] = [
            {'turnId': 'spent-' + str(i), 'startedAt': self.clock()}
            for i in range(self.settings['decisionsPerDay'])]

    def start_navigation(self):
        self.job()
        self.skills.reply = {'action': {'tool': 'goto', 'args': {'x': 105, 'y': 64, 'z': 100}},
                             'memory': {'stage': 'walking'}}
        self.gateway.result = {'ok': True, 'code': 'accepted', 'completionConfirmed': False,
                               'result': {'data': {'task_id': 't123'}}}
        self.controller.tick()
        self.assertEqual(len(self.gateway.actions), 1)
        self.wait(60, memory={'stage': 'reviewing'})
        return copy.deepcopy(self.saved_job()['lastResult'])

    def receipt(self, success=True, **updates):
        return {'task_id': 't123', 'navigation_epoch': EPOCH, 'success': success,
                'state': 'success' if success else 'failed', 'final_x': 105,
                'final_y': 64, 'final_z': 100, **updates}

    def test_more_than_32_wait_observations_use_no_steps_or_model_requests(self):
        self.job()
        self.wait()
        for _ in range(40):
            self.controller.tick()
            self.clock.now += 15
        job = self.saved_job()
        self.assertEqual(len(self.skills.calls), 40)
        self.assertEqual(job['steps'], 0)
        self.assertEqual(job['status'], 'running')
        self.assertFalse(self.gateway.actions or self.gateway.opened or self.gateway.closed)
        self.assertFalse(self.backend.submitted)
        self.assertEqual(self.controller.data['decisions'], [])

    def test_wait_defers_program_evaluation_and_publishes_due_time(self):
        self.job()
        self.wait(300)
        self.controller.tick()
        due = self.saved_job()['nextRunAt']
        for delta in (15, 30, 120, 134):
            self.clock.now += delta
            self.controller.tick()
        self.assertEqual(len(self.skills.calls), 1)
        self.assertEqual(self.saved_job()['nextRunAt'], due)
        public = read_json(self.public)
        self.assertEqual(public['executionSystems']['fast']['nextCheckAt'], due)
        self.assertTrue(public['executionSystems']['fast']['waiting'])
        self.clock.now += 1
        self.controller.tick()
        self.assertEqual(len(self.skills.calls), 2)
        self.assertFalse(self.backend.submitted)

    def test_restart_preserves_next_run_and_memory_without_a_model_request(self):
        self.job()
        self.wait(60, memory={'phase': 'smelting'})
        self.controller.tick()
        due = self.saved_job()['nextRunAt']
        self.clock.now += 30
        self.controller = self.create()
        self.controller.tick()
        self.assertEqual(len(self.skills.calls), 1)
        self.assertEqual(self.saved_job()['nextRunAt'], due)
        self.assertEqual(self.saved_job()['memory'], {'phase': 'smelting'})
        self.clock.now += 30
        self.controller.tick()
        self.assertEqual(self.skills.calls[-1]['memory'], {'phase': 'smelting'})
        self.assertEqual(len(self.skills.calls), 2)
        self.assertFalse(self.backend.submitted)

    def test_operator_pause_prevents_a_due_wait_from_resuming(self):
        self.job()
        self.wait(30)
        self.controller.tick()
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': False})
        self.controller.tick()
        self.clock.now += 300
        self.controller = self.create()
        self.controller.tick()
        self.assertEqual(self.saved_job()['status'], 'paused')
        self.assertEqual(len(self.skills.calls), 1)
        self.assertFalse(self.backend.submitted or self.gateway.actions)

    def test_new_goal_retires_waiting_program_before_old_due_time(self):
        self.job()
        self.wait(300)
        self.controller.tick()
        write_json(self.state / 'conversation-intent.json',
                   {'id': str(uuid.uuid4()), 'goal': 'Check the guild instead', 'at': self.clock() * 1000})
        self.controller.tick()
        self.assertEqual(self.saved_job()['status'], 'cancelled')
        self.assertEqual(self.saved_job()['reason'], 'goal_changed')
        self.assertEqual(len(self.skills.calls), 1)
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertIn('Check the guild instead', self.backend.submitted[0]['prompt'])
        self.assertFalse(self.gateway.actions)

    def test_total_wall_time_limit_still_ends_waiting_program(self):
        self.job(startedAt=self.clock() - 890)
        self.wait(300)
        self.controller.tick()
        self.exhaust_model_budget()
        self.clock.now += 15
        self.controller.tick()
        self.assertEqual(self.saved_job()['status'], 'replan')
        self.assertEqual(self.saved_job()['reason'], 'skill_execution_budget')
        self.assertEqual(len(self.skills.calls), 1)
        self.assertFalse(self.backend.submitted)
        self.assertEqual(self.controller.data['status'], 'budget_wait')

    def test_exhausted_model_budget_does_not_block_queued_program_wait_or_action(self):
        self.exhaust_model_budget()
        spent = copy.deepcopy(self.controller.data['decisions'])
        self.job()
        self.wait(15)
        self.controller.tick()
        self.clock.now += 15
        self.skills.reply = {'action': {'tool': 'eat', 'args': {'item_id': 'minecraft:bread'}},
                             'memory': {'phase': 'eating'}}
        self.controller.tick()
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertEqual(len(self.gateway.opened), 1)
        self.assertEqual(self.saved_job()['steps'], 1)
        self.assertEqual(self.controller.data['decisions'], spent)
        self.assertFalse(self.backend.submitted)

    def test_read_result_reaches_program_with_freshness_without_using_a_lease(self):
        previous_action = {'ok': True, 'code': 'accepted', 'completionConfirmed': False}
        self.job(lastResult=previous_action)
        self.observe()
        result = {'ok': True, **POINT, 'block': 'minecraft:wheat', 'properties': {'age': '7'}}
        with patch('world_actions.WorldActions.inspect', return_value=result) as inspect:
            self.controller.tick()
            saved = self.saved_job()
            self.assertEqual(saved['steps'], 0)
            self.assertEqual(saved['observations'], 1)
            self.assertEqual(saved['lastResult'], previous_action)
            self.wait(60)
            self.clock.now += 15
            self.controller.tick()
            inspect.assert_called_once_with(**POINT)
        observed = self.skills.calls[-1]['state']['execution']
        self.assertEqual(observed['lastResult'], previous_action)
        self.assertTrue(observed['observation']['fresh'])
        self.assertEqual(observed['observation']['ageMs'], 15000)
        self.assertEqual(observed['observation']['result'], result)
        self.assertFalse(self.gateway.actions or self.gateway.opened or self.gateway.closed)
        self.assertFalse(self.backend.submitted)

    def test_container_observation_uses_only_existing_physical_read(self):
        self.job()
        self.observe('inspect_container')
        result = {'ok': True, 'point': POINT, 'gui': {'containerId': 7, 'slots': {}}}
        with (patch('world_actions.WorldActions.container_view', return_value=result) as inspect,
              patch('world_actions.WorldActions.inspect') as block):
            self.controller.tick()
            inspect.assert_called_once_with(**POINT)
            block.assert_not_called()
        self.assertEqual(self.saved_job()['lastObservation']['result'], result)
        self.assertFalse(self.gateway.actions or self.gateway.opened)

    def test_failed_observation_is_data_for_program_and_not_an_automatic_retry(self):
        self.job(lastResult={'ok': True, 'code': 'previous_action'})
        self.observe('inspect_container')
        with patch('world_actions.WorldActions.container_view',
                   side_effect=GatewayError('physical_container_not_open')) as inspect:
            self.controller.tick()
            self.clock.now += 5
            self.controller.tick()
            self.assertEqual(inspect.call_count, 1)
            self.wait(60, memory={'phase': 'wait_for_access'})
            self.clock.now += 10
            self.controller.tick()
            self.assertEqual(inspect.call_count, 1)
        state = self.skills.calls[-1]['state']['execution']
        self.assertEqual(state['observation']['result'],
                         {'ok': False, 'code': 'physical_container_not_open'})
        self.assertTrue(state['observation']['fresh'])
        self.assertEqual(state['lastResult']['code'], 'previous_action')
        self.assertEqual(self.saved_job()['status'], 'running')
        self.assertEqual(self.saved_job()['steps'], 0)
        self.assertFalse(self.backend.submitted or self.gateway.actions or self.gateway.opened)

    def test_stale_and_cross_dimension_observations_remain_history_not_fresh(self):
        observation = {'tool': 'inspect_block', 'args': POINT, 'bodyUuid': BODY_UUID,
                       'dimension': 'minecraft:overworld', 'observedAt': int(self.clock() * 1000),
                       'result': {'ok': True, 'block': 'minecraft:wheat'}}
        for age, updates in ((60.001, {}), (0, {'dimension': 'minecraft:the_nether'}),
                             (0, {'bodyUuid': str(uuid.uuid4())}), (-1, {})):
            with self.subTest(age=age, updates=updates):
                view = observation_view(observation, dict(self.gateway.body, **updates), self.clock() + age)
                self.assertFalse(view['fresh'])
                self.assertEqual(view['result'], observation['result'])
        self.assertTrue(observation_view(observation, self.gateway.body, self.clock() + 60)['fresh'])

    def test_due_program_receives_expired_observation_and_prior_action_unchanged(self):
        last_result = {'ok': True, 'code': 'old_action'}
        self.job(lastResult=last_result, lastObservation={
            'tool': 'inspect_block', 'args': POINT, 'bodyUuid': BODY_UUID,
            'dimension': self.gateway.body['dimension'], 'observedAt': int((self.clock() - 61) * 1000),
            'result': {'ok': True, 'block': 'minecraft:wheat'}}, nextRunAt=self.clock())
        self.wait()
        self.controller.tick()
        state = self.skills.calls[-1]['state']['execution']
        self.assertFalse(state['observation']['fresh'])
        self.assertEqual(state['lastResult'], last_result)

    def test_observation_result_size_is_bounded_and_failure_does_not_leak_exception_text(self):
        request = {'tool': 'inspect_block', 'args': POINT}
        for returned in ({'ok': True, 'data': 'x' * 20000}, ['invalid']):
            with patch('world_actions.WorldActions.inspect', return_value=returned):
                observation = program_observation(self.gateway, request, self.gateway.body, self.clock())
            self.assertEqual(observation['result'], {'ok': False, 'code': 'ValueError'})
        with patch('world_actions.WorldActions.inspect', side_effect=OSError('private filesystem path')):
            observation = program_observation(self.gateway, request, self.gateway.body, self.clock())
        self.assertEqual(observation['result'], {'ok': False, 'code': 'OSError'})

    def test_accepted_navigation_is_not_completion_until_matching_terminal_receipt(self):
        prior_result = self.start_navigation()
        self.assertEqual(self.saved_job()['lastExecution']['status'], 'accepted')
        self.assertFalse(self.saved_job()['lastExecution']['completionConfirmed'])
        self.gateway.body['task']['busy'] = True
        self.gateway.body['navigationResult'] = self.receipt()
        self.controller.tick()
        self.assertEqual(self.saved_job()['lastExecution']['status'], 'accepted')
        self.gateway.body['task']['busy'] = False
        self.gateway.body['position']['x'] = 105
        self.controller.tick()
        execution = self.skills.calls[-1]['state']['execution']
        self.assertEqual(execution['lastExecution']['status'], 'succeeded')
        self.assertTrue(execution['lastExecution']['completionConfirmed'])
        self.assertEqual(execution['lastResult'], prior_result)
        self.assertEqual(execution['lastExecution']['positionAfter']['x'], 105)
        self.assertEqual(len(self.gateway.actions), 1)

    def test_idle_without_navigation_receipt_does_not_claim_success(self):
        self.start_navigation()
        self.controller.tick()
        execution = self.saved_job()['lastExecution']
        self.assertEqual(execution['status'], 'observed')
        self.assertFalse(execution['completionConfirmed'])
        self.assertIsNone(execution['navigationOutcome'])

    def test_mismatched_task_or_epoch_receipt_cannot_complete_program_action(self):
        for receipt_updates, body_epoch in (({'task_id': 't124'}, EPOCH),
                                            ({'navigation_epoch': OTHER_EPOCH}, EPOCH),
                                            ({}, OTHER_EPOCH)):
            with self.subTest(receipt_updates=receipt_updates, body_epoch=body_epoch):
                self.gateway.body['navigationEpoch'] = EPOCH
                self.gateway.body.pop('navigationResult', None)
                self.start_navigation()
                self.gateway.body['navigationResult'] = self.receipt(**receipt_updates)
                self.gateway.body['navigationEpoch'] = body_epoch
                self.controller.tick()
                execution = self.saved_job()['lastExecution']
                self.assertEqual(execution['status'], 'observed')
                self.assertFalse(execution['completionConfirmed'])
                self.gateway.actions.clear()

    def test_matching_failed_navigation_is_confirmed_failure_not_success(self):
        self.start_navigation()
        self.gateway.body['navigationResult'] = self.receipt(False, reason='unreachable')
        self.controller.tick()
        execution = self.saved_job()['lastExecution']
        self.assertEqual(execution['status'], 'failed')
        self.assertTrue(execution['completionConfirmed'])
        self.assertFalse(execution['navigationOutcome']['success'])

    def test_old_skill_turn_cannot_overwrite_new_job_execution(self):
        self.start_navigation()
        self.job(status='running', lastTurnId='another-turn', lastExecution={'status': 'new-job'})
        self.gateway.body['navigationResult'] = self.receipt()
        self.controller.tick()
        self.assertEqual(self.saved_job()['lastExecution'], {'status': 'new-job'})


if __name__ == '__main__':
    unittest.main()
