"""Removing model quotas preserves observations, serial actions and durable intent."""
import copy
import json
import unittest

import test_survival_controller as fixtures
from numen_gateway import GatewayError, read_json, read_controller_json
from body_reconnect import BodyReconnect


class UnrestrictedInferenceTests(unittest.TestCase):
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def setUp(self):
        fixtures.ControllerTests.setUp(self)
        self.settings.update(dailyPlanningLimit=None, decisionCooldownSeconds=0,
                             autonomous=True, autonomyReviewSeconds=1800)
        self.write('settings.json', self.settings)
        self.controller.settings = copy.deepcopy(self.settings)

    def test_null_overrides_legacy_cap_and_stale_cooldown_without_discarding_records(self):
        recent = [{'turnId': 'survival-' + f'{i:032x}', 'startedAt': self.clock() - i}
                  for i in range(105)]
        self.controller.data['decisions'] = recent + [{'turnId': 'old', 'startedAt': self.clock() - 86401}]
        self.controller.data['nextDecisionAt'] = self.clock() + 9999
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.controller.data['decisions'][:-1], recent)
        self.assertEqual(len(read_controller_json(self.state / 'controller.json')['decisions']), 106)
        budgets = read_json(self.public)['budgets']
        self.assertEqual(budgets['decisionsUsed'], 106)
        self.assertIsNone(budgets['decisionLimit'])
        self.assertIsNone(budgets['dailyPlanningLimit'])
        self.assertEqual(budgets['inferenceLimitPolicy'], 'unrestricted')
        self.assertEqual(budgets['decisionCountScope'], 'rolling_24h')
        self.assertEqual(budgets['cooldownSeconds'], 0)
        self.assertIsNone(read_json(self.public)['nextDecisionAt'])
        self.assertEqual(read_json(self.state / 'lease.json')['actionLimit'], 6)
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1, 'Known active task retains the sole model lane')

    def test_no_limit_does_not_make_an_unchanged_world_a_per_tick_model_loop(self):
        control = read_json(self.state / 'control.json')
        self.controller.data.update(lastDecisionSignature=self.controller.decision_signature(self.gateway.body, control),
                                    lastReviewAt=self.clock(), nextDecisionAt=self.clock() + 10000)
        due = self.controller.next_review(control)
        self.assertEqual(due, self.clock() + 1800)
        for elapsed in (15, 180, 300, 1799):
            self.clock.now = 1800000000 + elapsed
            self.controller.tick()
            self.assertEqual(self.controller.data['status'], 'observing')
            self.assertFalse(self.backend.submitted)
        self.clock.now = due
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.controller.data['wakeReason'], 'autonomous_review')

    def test_zero_cooldown_keeps_completed_and_empty_review_pacing(self):
        control = read_json(self.state / 'control.json')
        self.controller.data['lastReviewAt'] = self.clock()
        self.write('memory.json', {'goalState': 'completed', 'goal': 'fixture', 'reviewAfterSeconds': 0})
        self.assertEqual(self.controller.next_review(control), self.clock() + 180)
        self.controller.data['completedReviewConsumed'] = self.controller.completed_review_id()
        self.controller.data['noActionReviews'] = 3
        self.assertEqual(self.controller.next_review(control), self.clock() + 720)

    def test_unknown_submit_stays_reserved_and_does_not_retry_even_without_limits(self):
        self.backend.on_submit = lambda *args: (_ for _ in ()).throw(TimeoutError())
        self.backend.cancel_reply = {'stopped': False, 'waitingForTerminal': True}
        self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'model_submission_uncertain')
        self.controller = self.create()
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.controller.data['decisions']), 1)
        self.assertEqual(self.controller.data['active']['phase'], 'reserved')

    def test_busy_body_and_unknown_action_still_block_new_model_and_game_actions(self):
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'acting')
        self.assertFalse(self.backend.submitted)
        self.gateway.body['task']['busy'] = False
        self.write('unknown.json', {'turnId': 'original-unknown-action'})
        self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'action_outcome_unknown')
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.gateway.actions)

    def test_complete_day_journal_survives_restart_and_restore_checks_above_256k(self):
        recent = [{'turnId': 'survival-' + f'{i:032x}', 'startedAt': self.clock() - i * 15}
                  for i in range(5760)]
        self.controller.data['decisions'] = recent
        self.controller.save()
        path = self.state / 'controller.json'
        self.assertGreater(path.stat().st_size, 262144)
        self.controller = self.create()
        self.assertEqual(self.controller.data['decisions'], recent)
        self.controller.tick()
        self.assertEqual(len(self.controller.data['decisions']), 5761)
        self.assertEqual(read_json(self.public)['budgets']['decisionsUsed'], 5761)
        self.assertEqual(BodyReconnect(self.gateway, self.clock).tick(self.settings)['reason'], 'restore_not_authorized')
        with self.assertRaisesRegex(GatewayError, 'invalid_state_file'):
            read_json(path)
        with self.assertRaisesRegex(GatewayError, 'invalid_controller_state_path'):
            read_controller_json(self.state / 'settings.json')
        path.write_text(json.dumps({'padding': 'x' * (2 * 1024 * 1024)}), encoding='utf8')
        with self.assertRaisesRegex(GatewayError, 'invalid_state_file'):
            read_controller_json(path)

    def test_legacy_explicit_limit_is_exact_above_one_hundred(self):
        self.controller.settings.pop('dailyPlanningLimit')
        self.controller.settings['decisionsPerDay'] = 106
        self.controller.data['decisions'] = [{'startedAt': self.clock()}] * 106
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'budget_wait')
        self.assertFalse(self.backend.submitted)
        self.controller.data['decisions'].pop()
        self.controller.tick()
        self.assertEqual(len(self.controller.data['decisions']), 106)
        self.assertEqual(len(self.backend.submitted), 1)

    def test_invalid_values_are_not_silent_unlimited_aliases(self):
        for value in (0, -1, True, 'unlimited', 2.5):
            with self.subTest(value=value):
                self.controller.settings['dailyPlanningLimit'] = value
                with self.assertRaisesRegex(ValueError, 'invalid_daily_planning_limit'):
                    self.controller.daily_planning_limit()
        for value in (-1, True, float('inf'), float('nan')):
            with self.subTest(value=value):
                self.controller.settings['decisionCooldownSeconds'] = value
                with self.assertRaisesRegex(ValueError, 'invalid_model_cooldown'):
                    self.controller.model_cooldown()


if __name__ == '__main__':
    unittest.main()
