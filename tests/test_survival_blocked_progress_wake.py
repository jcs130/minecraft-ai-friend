"""Known physical progress may wake a blocked planner without weakening ownership."""
import copy
import unittest
from unittest.mock import patch

import test_survival_controller as fixture
from numen_gateway import read_json


class BlockedProgressWakeTests(unittest.TestCase):
    create = fixture.ControllerTests.create
    write = fixture.ControllerTests.write
    terminal = fixture.ControllerTests.terminal
    livestream = fixture.ControllerTests.livestream
    finish_livestream_motor_turn = fixture.ControllerTests.finish_livestream_motor_turn

    def setUp(self):
        fixture.ControllerTests.setUp(self)
        self.finish_livestream_motor_turn()
        self.write('memory.json', {'goalState': 'blocked', 'reviewAfterSeconds': 1800})
        self.control = read_json(self.state / 'control.json')

    def test_blocked_confirmed_displacement_wakes_on_next_tick_once(self):
        # Reproduces successful short return + remember(blocked), before the
        # ordinary 45-second review. The following turn must consume its cursor.
        self.assertEqual(self.controller.livestream_pacing()['reason'], 'goal_blocked')
        self.assertGreater(self.controller.next_review(self.control), self.clock())
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertEqual(self.controller.data['wakeReason'], 'motor_progress')
        cursor = self.controller.data['lastMotorProgressWake']
        self.assertEqual(cursor, 'progress-request:' + 'a' * 32)
        self.controller.tick()
        self.terminal()
        self.controller.tick()
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_blocked_confirmed_inventory_progress_can_wake(self):
        event = next(e for e in self.controller.data['episodes'] if e.get('kind') == 'action_observed')
        event.update(positionAfter=copy.deepcopy(event['positionBefore']),
                     inventoryDelta={'minecraft:bread': -1}, action='eat')
        self.assertEqual(self.controller.motor_progress_wake(self.control),
                         'progress-request:' + 'a' * 32)

    def test_no_displacement_or_inventory_evidence_does_not_wake(self):
        event = next(e for e in self.controller.data['episodes'] if e.get('kind') == 'action_observed')
        before = copy.deepcopy(event)
        for delta in (0, 1.5):
            with self.subTest(delta=delta):
                event.update(copy.deepcopy(before))
                event['positionAfter'] = {**event['positionBefore'], 'x': event['positionBefore']['x'] + delta}
                self.assertIsNone(self.controller.motor_progress_wake(self.control))
        event.update(copy.deepcopy(before))
        event['positionAfter']['x'] = float('nan')
        self.assertIsNone(self.controller.motor_progress_wake(self.control))

    def test_only_matching_confirmed_terminal_evidence_can_wake(self):
        row = self.controller.data['motorQueue']['recent'][-1]
        event = next(e for e in self.controller.data['episodes'] if e.get('kind') == 'action_observed')
        original_row, original_event = copy.deepcopy(row), copy.deepcopy(event)
        for change in ('failed', 'unknown', 'unconfirmed', 'wrong_action', 'no_observation'):
            with self.subTest(change=change):
                row.clear(); row.update(copy.deepcopy(original_row))
                event.clear(); event.update(copy.deepcopy(original_event))
                if change in ('failed', 'unknown'):
                    row['status'] = row['receipt']['status'] = change
                elif change == 'unconfirmed':
                    row['receipt']['completionConfirmed'] = False
                elif change == 'wrong_action':
                    event['actionId'] = 'different-action'
                else:
                    event['kind'] = 'action_response'
                self.assertIsNone(self.controller.motor_progress_wake(self.control))

    def test_busy_queue_unknown_and_skill_owner_still_block_progress_wake(self):
        before = copy.deepcopy(self.controller.data)
        for blocker in ('busy', 'in_flight', 'pending', 'active', 'unknown', 'unknown_file',
                        'skill_pending', 'skill_running', 'skill_dispatching', 'practice'):
            with self.subTest(blocker=blocker):
                self.controller.data = copy.deepcopy(before)
                self.controller.last_body['task']['busy'] = blocker == 'busy'
                for name in ('unknown.json', 'skill-job.json'):
                    (self.state / name).unlink(missing_ok=True)
                if blocker == 'in_flight':
                    self.controller.data['actionExecution'] = {'inFlight': True}
                elif blocker == 'pending':
                    self.controller.data['motorQueue']['pending'] = 1
                elif blocker == 'active':
                    self.controller.data['motorQueue']['active'] = [{'status': 'in_flight'}]
                elif blocker == 'unknown':
                    self.controller.data['actionExecution'] = {'code': 'outcome_unknown'}
                elif blocker == 'unknown_file':
                    self.write('unknown.json', {'actionId': 'unresolved'})
                elif blocker.startswith('skill_'):
                    self.write('skill-job.json', {'status': blocker.removeprefix('skill_')})
                elif blocker == 'practice':
                    self.write('skill-job.json', {'status': 'completed', 'practiceStarted': True})
                self.assertIsNone(self.controller.motor_progress_wake(self.control))

    def test_sleep_and_intentional_rest_are_not_motor_progress(self):
        self.write('memory.json', {'goalState': 'resting'})
        self.assertIsNone(self.controller.motor_progress_wake(self.control))
        self.write('memory.json', {'goalState': 'blocked'})
        self.controller.data['actionExecution'] = {'receipt': {
            'tool': 'sleep', 'status': 'completed', 'completionConfirmed': True}}
        self.assertIsNone(self.controller.motor_progress_wake(self.control))
        self.controller.data['actionExecution'] = {}
        event = next(e for e in self.controller.data['episodes'] if e.get('kind') == 'action_observed')
        event['action'] = 'sleep'
        self.assertIsNone(self.controller.motor_progress_wake(self.control))


class SkillProgressWakeTests(unittest.TestCase):
    create = fixture.ControllerTests.create
    write = fixture.ControllerTests.write
    terminal = fixture.ControllerTests.terminal
    livestream = fixture.ControllerTests.livestream
    finish_livestream_motor_turn = fixture.ControllerTests.finish_livestream_motor_turn

    def setUp(self):
        BlockedProgressWakeTests.setUp(self)
        row = self.controller.data['motorQueue']['recent'][-1]
        event = next(e for e in self.controller.data['episodes'] if e.get('kind') == 'action_observed')
        event['turnId'] = 'skill-original-action'
        self.execution = {'turnId': event['turnId'], 'actionId': event['actionId'], 'tool': 'goto',
                          'status': 'succeeded', 'completionConfirmed': True}
        row.update(kind='skill', receipt={'status': 'done', 'practiceRunId': 'practice-original',
                                         'lastExecution': copy.deepcopy(self.execution)})
        self.job = {'status': 'done', 'practiceStarted': True, 'practiceFinalized': True,
                    'practiceRunId': 'practice-original', 'motorRequestId': row['requestId'],
                    'lastTurnId': event['turnId'], 'lastExecution': copy.deepcopy(self.execution)}
        self.write('skill-job.json', self.job)

    def test_finalized_skill_progress_is_consumed_once(self):
        cursor = 'progress-request:' + 'a' * 32
        self.assertEqual(self.controller.motor_progress_wake(self.control), cursor)
        self.controller.data['lastMotorProgressWake'] = cursor
        self.assertIsNone(self.controller.motor_progress_wake(self.control))

    def test_skill_needs_exact_finalized_job_and_action_evidence(self):
        row = self.controller.data['motorQueue']['recent'][-1]
        event = next(e for e in self.controller.data['episodes'] if e.get('kind') == 'action_observed')
        original_row, original_event = copy.deepcopy(row), copy.deepcopy(event)
        for change in ('unfinalized', 'other_request', 'other_practice', 'other_job_action',
                       'other_event_turn', 'unconfirmed', 'failed', 'no_progress', 'sleep'):
            with self.subTest(change=change):
                row.clear(); row.update(copy.deepcopy(original_row))
                event.clear(); event.update(copy.deepcopy(original_event))
                job = copy.deepcopy(self.job)
                if change == 'unfinalized': job['practiceFinalized'] = False
                elif change == 'other_request': job['motorRequestId'] = 'another-request'
                elif change == 'other_practice': job['practiceRunId'] = 'another-practice'
                elif change == 'other_job_action': job['lastExecution']['actionId'] = 'another-action'
                elif change == 'other_event_turn': event['turnId'] = 'another-turn'
                elif change == 'unconfirmed': row['receipt']['lastExecution']['completionConfirmed'] = False
                elif change == 'failed': row['receipt']['lastExecution']['status'] = 'failed'
                elif change == 'no_progress': event['positionAfter'] = copy.deepcopy(event['positionBefore'])
                else: event['action'] = 'sleep'
                self.write('skill-job.json', job)
                self.assertIsNone(self.controller.motor_progress_wake(self.control))

    def test_skill_progress_keeps_unknown_busy_and_rest_guards(self):
        for change in ('unknown', 'busy', 'resting'):
            with self.subTest(change=change):
                self.controller.data['actionExecution'] = {'code': 'outcome_unknown'} if change == 'unknown' else {}
                self.controller.last_body['task']['busy'] = change == 'busy'
                self.write('memory.json', {'goalState': 'resting' if change == 'resting' else 'blocked'})
                self.assertIsNone(self.controller.motor_progress_wake(self.control))


class NavigationCompletionWakeTests(unittest.TestCase):
    def test_program_finishing_before_slow_task_wakes_next_idle_tick(self):
        import test_survival_continuous_navigation as navigation_fixture
        from numen_gateway import write_json
        f = navigation_fixture.ContinuousNavigationExecutionTests(
            'test_actual_controller_two_segments_poll_same_slow_task_without_new_model_or_classifier')
        f.setUp()
        self.addCleanup(f.doCleanups)
        f.c.settings.update(livestreamMode=True, livestreamReviewSeconds=45,
                            livestreamBlockedMaxSeconds=180, decisionCooldownSeconds=0, decisionsPerDay=10)
        write_json(f.state/'control.json', {'schema': 1, 'enabled': True, 'autonomous': True})
        write_json(f.state/'memory.json', {'goalState': 'blocked', 'reviewAfterSeconds': 1800})
        with patch('skill_router.tick', return_value=False):
            f.start()
            for _ in range(12):
                if f.current_receipt and f.current_receipt['status'] == 'in_flight':
                    f.complete()
                f.advance()
                job = read_json(f.state/'skill-job.json')
                if job['status'] == 'done':
                    break
            self.assertEqual(job['status'], 'done')
            self.assertTrue(job['practiceFinalized'])
            self.assertTrue(f.c.data['active'])
            self.assertEqual(len(f.gateway.actions), 4)
            self.assertEqual(len(f.backend.submitted), 1)
            fixture.ControllerTests.terminal(f)
            f.advance()
            f.advance()
            self.assertEqual(len(f.backend.submitted), 2)
            self.assertEqual(f.c.data['wakeReason'], 'motor_progress')
            self.assertEqual(len(f.gateway.actions), 4)


if __name__ == '__main__':
    unittest.main()
