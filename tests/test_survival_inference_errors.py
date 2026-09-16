"""Exact provider errors and durable backoff with fake native tasks, no model calls."""
import copy
import json
import unittest

import test_survival_controller as fixtures
from inference_errors import classify_inference_error, next_backoff, validate_backoff, public_inference_state
from mcp_server import submit_goal
from numen_gateway import read_json


def error(message='usage allocated quota exceeded. please try again later.'):
    return {'code': 'MODEL_QUOTA_EXCEEDED',
            'message': "Quota exceeded for model 'qwen3.5-plus'. Reason: " + message}


class ClassificationTests(unittest.TestCase):
    def test_exact_vendor_reasons_remain_distinct_from_generic_quota(self):
        cases = [('usage', 'provider_throttled'), ('concurrency', 'provider_concurrency'),
                 ('hour', 'provider_window_exhausted'), ('week', 'provider_window_exhausted'),
                 ('month', 'provider_window_exhausted')]
        for prefix, kind in cases:
            with self.subTest(prefix=prefix):
                original = error(prefix + ' allocated quota exceeded. please try again later.')
                before = copy.deepcopy(original)
                actual = classify_inference_error(original)
                self.assertEqual(actual['kind'], kind)
                self.assertEqual(actual['code'], 'MODEL_QUOTA_EXCEEDED')
                self.assertEqual(original, before)
                self.assertNotIn('message', actual)
                if kind == 'provider_window_exhausted':
                    self.assertEqual(actual['window'], prefix)

    def test_local_acquire_and_unknown_do_not_guess_exhausted_windows(self):
        # The native acquire timeout reaches the classifier both with its explicit
        # type text and re-coded as MODEL_QUOTA_EXCEEDED + a generic rate-limit
        # message; both are the transient local queue wait, never a window guess.
        for detail in ('_AcquireTimeoutError: Rate limit exceeded', 'Rate limit exceeded'):
            with self.subTest(detail=detail):
                self.assertEqual(classify_inference_error(error(detail))['kind'], 'local_queue_timeout')
        self.assertEqual(classify_inference_error({'code': 'RATE_LIMIT_EXCEEDED', 'message': 'Rate limit exceeded'})['kind'],
                         'unknown')
        for value in (None, {}, {'code': 'MODEL_QUOTA_EXCEEDED'},
                      error('Quota exceeded'), error('hourly allocated quota exceeded'),
                      error('usage allocated quota exceeded; month allocated quota exceeded'),
                      error('x' * 8193), {'message': ['usage allocated quota exceeded']}):
            self.assertEqual(classify_inference_error(value)['kind'], 'unknown')

    def test_bounded_exponential_deadline_rejects_invalid_timestamps(self):
        previous = None
        for expected in (60, 120, 240, 480, 960, 1920, 3600, 3600):
            previous = next_backoff('provider_throttled', previous, 10000, 'native-task', 'original-turn')
            self.assertEqual(previous['nextAttemptAt'] - previous['failedAt'], expected)
        for key, value in (('schema', True), ('kind', []), ('attempt', True), ('attempt', 8), ('nextAttemptAt', float('nan')),
                           ('nextAttemptAt', float('inf')), ('nextAttemptAt', 10**20),
                           ('failedAt', 10001), ('failedAt', '10000'), ('taskId', '../foreign')):
            with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, 'inference_backoff_invalid'):
                validate_backoff(dict(previous, **{key: value}), 10000)

    def test_provider_phrase_without_native_rate_limit_code_cannot_authorize_recovery(self):
        for code in (None, 'TOOL_EXECUTION_ERROR', 'MODEL_EXECUTION_ERROR', 'RATE_LIMIT_EXCEEDED'):
            for prefix in ('usage', 'concurrency', 'hour', 'week', 'month'):
                result = classify_inference_error({'code': code, 'message': prefix + ' allocated quota exceeded'})
                self.assertEqual(result['kind'], 'unknown')

    def test_public_projection_never_copies_original_error_or_extra_state(self):
        failure = classify_inference_error(error()) | {'message': 'private-body', 'summary': 'private-body',
                                                       'taskId': 'task-one', 'turnId': 'turn-one'}
        backoff = next_backoff('provider_throttled', None, 10000, 'task-one', 'turn-one') | {'prompt': 'private-body'}
        result = public_inference_state(failure, backoff, 10000)
        self.assertNotIn('private-body', json.dumps(result))
        self.assertEqual(result[1]['nextAttemptAt'], 10060)


class InferenceBackoffTests(unittest.TestCase):
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def setUp(self):
        fixtures.ControllerTests.setUp(self)
        self.settings.update(dailyPlanningLimit=None, decisionCooldownSeconds=0, autonomous=True,
                             autonomyReviewSeconds=180)
        self.write('settings.json', self.settings)
        self.controller = self.create()

    def fail(self, detail=None, native_status='failed'):
        original = {'status': 'finished', 'result': {'status': native_status, 'error': detail or error()}}
        self.backend.reply = copy.deepcopy(original)
        self.controller.tick()
        self.assertEqual(self.backend.reply, original)

    def due(self):
        self.clock.now = self.controller.data['inferenceBackoff']['nextAttemptAt']
        self.backend.reply = {'status': 'running'}
        self.controller.tick()

    def test_two_throttled_tasks_wait_then_use_new_turns_without_permanent_pause(self):
        self.controller.tick()
        original = copy.deepcopy(self.controller.data['active'])
        self.fail()
        self.assertIsNone(self.controller.data['active'])
        first = copy.deepcopy(self.controller.data['inferenceBackoff'])
        self.assertEqual(first['nextAttemptAt'], self.clock.now + 60)
        self.assertEqual(self.controller.data['failures'], 0)
        self.clock.now += 59
        submit_goal(self.state, 'Choose useful current progress', clock=self.clock)
        self.gateway.body['hunger'] = 12
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)  # Neither event nor new mission skips the deadline.
        self.due()
        self.assertEqual(len(self.backend.submitted), 2)
        second = copy.deepcopy(self.controller.data['active'])
        self.assertNotEqual(second['turnId'], original['turnId'])
        self.assertNotEqual(second['taskId'], original['taskId'])
        self.assertEqual(second['sessionId'], original['sessionId'])
        self.assertEqual(self.controller.data['wakeReason'], 'inference_recovery')
        self.fail()
        self.assertEqual(self.controller.data['inferenceBackoff']['nextAttemptAt'], self.clock.now + 120)
        self.assertTrue(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(self.controller.data['failures'], 0)
        self.assertEqual(self.controller.data['lastDecision']['taskId'], second['taskId'])
        self.assertEqual(self.gateway.actions, [])
        public = read_json(self.public)
        self.assertEqual(public['lastInferenceFailure']['kind'], 'provider_throttled')
        self.assertEqual(public['inferenceBackoff']['attempt'], 2)
        self.assertNotIn('please try again', json.dumps(public))
        self.assertEqual(read_json(self.state / 'heartbeat.json')['inferenceFailureVersion'], 1)
        self.assertEqual(read_json(self.state / 'heartbeat.json')['visionProtocol'], 1)
        context = json.loads(self.backend.submitted[-1]['prompt'].split('\n', 1)[1])
        self.assertEqual(context['visualPerception']['tool'], 'view_scene')
        self.assertEqual(context['visualPerception']['view'], 'native_semantic_map')

    def test_restart_preserves_exact_deadline_and_does_not_poll_or_replay_failed_task(self):
        self.controller.tick()
        self.fail()
        snapshot = copy.deepcopy(self.controller.data['inferenceBackoff'])
        polled = list(self.backend.polled)
        self.controller = self.create()
        self.clock.now = snapshot['nextAttemptAt'] - 0.01
        self.controller.tick()
        self.assertEqual(self.controller.data['inferenceBackoff'], snapshot)
        self.assertEqual(self.backend.polled, polled)
        self.assertEqual(len(self.backend.submitted), 1)
        self.due()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertEqual(self.backend.polled, polled)

    def test_success_resets_backoff_and_next_transient_starts_at_one_minute(self):
        self.controller.tick()
        self.fail()
        self.due()
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': [
            {'role': 'assistant', 'type': 'message', 'status': 'completed',
             'content': [{'type': 'text', 'text': 'Observed current facts and chose the next step.'}]}]}}
        self.controller.tick()
        self.assertNotIn('inferenceBackoff', self.controller.data)
        self.assertNotIn('lastInferenceFailure', self.controller.data)
        self.assertIsNone(read_json(self.public)['inferenceBackoff'])
        self.assertEqual(self.controller.data['failures'], 0)
        self.clock.now += 180
        self.backend.reply = {'status': 'running'}
        self.controller.tick()
        self.fail(error('concurrency allocated quota exceeded'))
        self.assertEqual(self.controller.data['inferenceBackoff']['attempt'], 1)
        self.assertEqual(self.controller.data['lastInferenceFailure']['kind'], 'provider_concurrency')

    def test_local_queue_timeout_backs_off_and_retries_without_repeated_failure_pause(self):
        for detail in (error('Rate limit exceeded'), error('_AcquireTimeoutError: Rate limit exceeded')):
            with self.subTest(detail=detail['message']):
                self.setUp()
                self.controller.tick()
                self.fail(detail)
                self.assertEqual(self.controller.data['lastInferenceFailure']['kind'], 'local_queue_timeout')
                self.assertEqual(self.controller.data['inferenceBackoff']['attempt'], 1)
                self.assertEqual(self.controller.data['status'], 'inference_backoff')
                self.assertEqual(self.controller.data['failures'], 0)
                self.assertTrue(read_json(self.state / 'control.json')['enabled'])
                self.due()
                self.assertEqual(len(self.backend.submitted), 2)
                self.assertEqual(self.controller.data['wakeReason'], 'inference_recovery')
                self.fail(detail)
                self.assertEqual(self.controller.data['inferenceBackoff']['attempt'], 2)
                self.assertEqual(self.controller.data['failures'], 0)
                self.assertTrue(read_json(self.state / 'control.json')['enabled'])
                public = read_json(self.public)
                self.assertEqual(public['lastInferenceFailure']['kind'], 'local_queue_timeout')
                self.assertEqual(public['inferenceBackoff']['attempt'], 2)

    def test_known_failure_preserves_actual_actions_and_original_error(self):
        self.controller.tick()
        turn = self.controller.data['active']['turnId']
        receipt = {'schema': 2, 'actionId': 'a' * 32, 'turnId': turn, 'tool': 'eat',
                   'status': 'completed', 'completionConfirmed': True,
                   'before': {'ok': True, 'counts': {'minecraft:bread': 1}},
                   'after': {'ok': True, 'counts': {}}, 'result': {'ok': True, 'completionConfirmed': True}}
        self.gateway.turn_receipts = lambda _: [copy.deepcopy(receipt)]
        self.fail()
        self.assertEqual(self.controller.data['lastDecision']['actions'], [receipt])
        self.assertFalse(self.controller.data['lastDecision']['completed'])
        self.assertEqual(read_json(self.state / 'lease.json')['status'], 'closed')
        self.assertEqual(self.controller.data['lastInferenceFailure']['code'], 'MODEL_QUOTA_EXCEEDED')

    def test_unclassified_and_window_failures_keep_existing_repeated_failure_stop(self):
        for detail in (error('Quota exceeded'), error('month allocated quota exceeded')):
            with self.subTest(detail=detail['message']):
                self.setUp()
                self.controller.tick()
                self.fail(detail)
                self.assertNotIn('inferenceBackoff', self.controller.data)
                self.assertEqual(self.controller.data['failures'], 1)
                self.clock.now += 180
                self.backend.reply = {'status': 'running'}
                self.controller.tick()
                self.fail(detail)
                self.assertFalse(read_json(self.state / 'control.json')['enabled'])
                self.assertEqual(self.controller.data['pauseReason'], 'repeated_model_failure')

    def test_unknown_task_result_and_unknown_action_are_never_recovered_by_backoff(self):
        self.controller.tick()
        self.backend.reply = ValueError('missing_native_task')
        self.controller.tick()
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertNotIn('inferenceBackoff', self.controller.data)
        self.assertEqual(len(self.backend.submitted), 1)
        self.setUp()
        self.controller.tick()
        self.fail()
        self.write('unknown.json', {'schema': 1, 'actionId': 'unresolved-action'})
        self.clock.now += 600
        self.controller.tick()
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(self.controller.data['pauseReason'], 'action_outcome_unknown')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_invalid_persistent_deadline_is_not_dropped_or_submitted(self):
        self.controller.tick()
        self.fail()
        self.controller.data['inferenceBackoff']['nextAttemptAt'] = 10**20
        self.controller.save()
        self.controller = self.create()
        self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'inference_backoff_invalid')
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(read_json(self.public)['inferenceBackoff']['valid'], False)

    def test_operator_pause_and_drain_are_not_automatically_released(self):
        for control in ({'schema': 1, 'enabled': False, 'pauseReason': 'repeated_model_failure'},
                        {'schema': 1, 'enabled': True, 'drain': {'status': 'requested'}}):
            with self.subTest(control=control):
                self.setUp()
                self.controller.tick()
                self.fail()
                self.write('control.json', control)
                self.clock.now += 600
                self.controller.tick()
                self.assertEqual(len(self.backend.submitted), 1)
                self.assertFalse(read_json(self.state / 'control.json')['enabled'])

    def test_nonfailed_native_status_does_not_turn_error_text_into_retry_permission(self):
        self.controller.tick()
        self.fail(native_status='cancelled')
        self.assertNotIn('inferenceBackoff', self.controller.data)
        self.assertEqual(self.controller.data['lastInferenceFailure']['kind'], 'unknown')

    def test_delayed_party_receipt_retains_failure_class_across_restart(self):
        from test_survival_life_session import FakeParty
        party = FakeParty()
        party.delivery = {'settled': False, 'heard': False, 'status': 'waiting'}
        # A failed model does not send an answer, but its native failure receipt
        # must still settle before the controller opens any new life turn.
        def failed(reservation, task_id, reason):
            return copy.deepcopy(party.delivery)
        party.failed = failed
        self.controller.party = party
        self.controller.tick()
        self.fail()
        self.assertEqual(self.controller.data['active']['nativeTerminal']['inferenceFailure']['kind'],
                         'provider_throttled')
        self.assertNotIn('inferenceBackoff', self.controller.data)
        self.controller = self.create()
        self.controller.party = party
        party.delivery = {'settled': True, 'heard': False, 'status': 'failed'}
        self.clock.now += 1
        self.controller.tick()
        self.assertIsNone(self.controller.data['active'])
        self.assertEqual(self.controller.data['inferenceBackoff']['attempt'], 1)
        self.assertEqual(self.controller.data['lastInferenceFailure']['kind'], 'provider_throttled')
        self.assertEqual(len(self.backend.submitted), 1)


if __name__ == '__main__':
    unittest.main()
