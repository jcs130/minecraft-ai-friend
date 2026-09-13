"""Goto execution cap: exact stop once, terminal evidence, crash and pause safety."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from numen_gateway import NumenGateway, NAVIGATION_MAX_WAIT_MS, read_json, write_json

BODY = 'd4ac9523-4962-43ed-98c5-19b49e104048'
EPOCH = '1a682536-4f82-494b-84e8-670ffcea4091'
ACTION = 'b' * 32
NOW = 1800000000000


class Gateway(NumenGateway):
    def __init__(self, state):
        super().__init__(state, clock=lambda: NOW / 1000)
        self.calls, self.effect, self.lost_ack = [], True, False
        self.body = {'ok': True, 'bodyUuid': BODY, 'dimension': 'minecraft:overworld',
                     'position': {'x': 100, 'y': 64, 'z': 100}, 'navigationEpoch': EPOCH,
                     'task': {'busy': True, 'task_id': 't22'}, 'navigationResult': None}

    def snapshot(self):
        return copy.deepcopy(self.body)

    def _invoke(self, tool, args=None):
        self.calls.append((tool, copy.deepcopy(args)))
        assert tool == 'task_stop' and args == {'task_id': 't22'}
        if self.effect:
            self.finish('cancelled')
        if self.lost_ack:
            raise ConnectionError('PRIVATE lost response')
        return {'success': True, 'data': {'task_id': 't22'}}

    def finish(self, state):
        self.body.update(task={'busy': False}, navigationResult={
            'task_id': 't22', 'navigation_epoch': EPOCH, 'state': state, 'success': state == 'success'})


class NavigationDeadlineTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.state = Path(tmp.name)
        self.gateway = Gateway(self.state)
        self.marker = {'schema': 2, 'actionId': ACTION, 'nativeTaskId': 't22', 'turnId': 'turn_test',
            'tool': 'goto', 'args': {'x': 110, 'z': 100}, 'acceptedAt': NOW - NAVIGATION_MAX_WAIT_MS,
            'status': 'in_flight', 'completionConfirmed': False, 'before': {
                'bodyUuid': BODY, 'dimension': 'minecraft:overworld', 'navigationEpoch': EPOCH},
            'result': {'ok': True, 'code': 'accepted'}}
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': True})
        write_json(self.state / 'lease.json', {'schema': 1, 'status': 'closed', 'actionId': ACTION})
        self.save_marker()
        delay = patch('numen_gateway.time.sleep', return_value=None)
        delay.start()
        self.addCleanup(delay.stop)

    def save_marker(self):
        write_json(self.state / 'inflight-action.json', self.marker)
        write_json(self.state / 'action-receipts' / (ACTION + '.json'), self.marker)

    def enforce(self):
        return self.gateway.enforce_navigation_deadline(self.gateway.snapshot())

    def test_expired_navigation_stops_exact_task_once_and_normal_observer_records_failure(self):
        after = self.enforce()
        self.assertEqual(self.gateway.calls, [('task_stop', {'task_id': 't22'})])
        result = self.gateway.action_status(after)
        self.assertFalse(result['inFlight'])
        self.assertEqual(result['receipt']['status'], 'failed')
        self.assertEqual(result['receipt']['navigationOutcome']['state'], 'cancelled')
        self.assertTrue(result['receipt']['completionConfirmed'])
        self.assertEqual(result['receipt']['navigationStop']['reason'], 'navigation_total_wait_limit')
        self.enforce()
        self.assertEqual(len(self.gateway.calls), 1)
        self.assertFalse((self.state / 'unknown.json').exists())

    def test_live_success_at_boundary_never_gets_stopped_or_renamed_failed(self):
        self.gateway.finish('success')
        result = self.gateway.action_status(self.enforce())
        self.assertFalse(self.gateway.calls)
        self.assertEqual(result['receipt']['status'], 'completed')

    def test_unexpired_other_tool_and_operator_pause_do_not_stop(self):
        for change in ({'acceptedAt': NOW - NAVIGATION_MAX_WAIT_MS + 1}, {'tool': 'mine'}):
            with self.subTest(change=change):
                original = self.marker
                self.marker = original | change
                self.save_marker()
                self.enforce()
                self.marker = original
        self.save_marker()
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': False})
        self.enforce()
        self.assertFalse(self.gateway.calls)

    def test_epoch_body_or_task_mismatch_never_stops_a_different_task(self):
        original = self.gateway.snapshot()
        for change in ({'bodyUuid': 'other'}, {'navigationEpoch': 'other'},
                       {'task': {'busy': True, 'task_id': 't23'}}):
            with self.subTest(change=change):
                self.gateway.body = original | change
                self.enforce()
        self.assertFalse(self.gateway.calls)
        self.assertFalse((self.state / 'navigation-stops').exists())

    def test_lost_stop_ack_is_recovered_from_exact_native_terminal_only(self):
        self.gateway.lost_ack = True
        after = self.enforce()
        result = self.gateway.action_status(after)
        self.assertEqual(len(self.gateway.calls), 1)
        self.assertEqual(result['receipt']['status'], 'failed')
        self.assertEqual(result['receipt']['navigationStop']['stopErrorType'], 'ConnectionError')
        self.assertNotIn('PRIVATE', str(result))

    def test_unconfirmed_stop_marks_unknown_and_restart_never_resends(self):
        self.gateway.effect, self.gateway.lost_ack = False, True
        self.enforce()
        self.assertEqual(len(self.gateway.calls), 1)
        self.assertEqual(read_json(self.state / 'unknown.json')['reason'], 'navigation_stop_outcome_unknown')
        self.assertTrue(self.gateway.navigation_stop_pending(self.gateway.snapshot()))
        restarted = Gateway(self.state)
        restarted.enforce_navigation_deadline(restarted.snapshot())
        self.assertFalse(restarted.calls)
        self.assertTrue(restarted.action_status()['inFlight'])

    def test_crash_after_claim_is_read_only_and_never_assumes_stop_was_not_sent(self):
        journal = {'schema': 1, 'actionId': ACTION, 'nativeTaskId': 't22', 'bodyUuid': BODY,
            'navigationEpoch': EPOCH, 'phase': 'dispatching', 'reason': 'navigation_total_wait_limit'}
        write_json(self.state / 'navigation-stops' / (ACTION + '.json'), journal)
        self.enforce()
        self.assertFalse(self.gateway.calls)
        self.assertTrue((self.state / 'unknown.json').exists())

    def test_status_remains_read_only_even_when_navigation_exceeds_deadline(self):
        result = self.gateway.action_status()
        self.assertTrue(result['inFlight'])
        self.assertFalse(self.gateway.calls)
        self.assertFalse((self.state / 'navigation-stops').exists())


if __name__ == '__main__':
    unittest.main()
