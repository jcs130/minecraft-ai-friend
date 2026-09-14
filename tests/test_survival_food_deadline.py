"""Food's total waiting cap shares the existing one-shot native stop journal."""
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
sys.path.insert(0, str(ROOT / 'tests'))
import test_survival_food_receipts as fixtures
from numen_gateway import NumenGateway, FOOD_MAX_WAIT_MS, read_json, write_json


class FoodDeadlineTests(unittest.TestCase):
    def setUp(self):
        fixtures.FoodReceiptTests.setUp(self)
        self.eat_result = fixtures.FoodReceiptTests.eat(self)
        self.action_id = self.eat_result['actionId']
        self.gateway.clock = lambda: fixtures.NOW + FOOD_MAX_WAIT_MS / 1000
        self.rcon.busy = True
        self.stop_calls = []
        self.stop_effect, self.stop_lost_ack = True, False
        original = self.rcon.cmd

        def transport(command):
            if ' task_stop ' in command:
                self.stop_calls.append(command)
                self.assertTrue(command.endswith('{"task_id": "t1"}'))
                if self.stop_effect:
                    self.rcon.busy = False
                    self.rcon.finish('CANCELLED')
                if self.stop_lost_ack:
                    raise ConnectionError('PRIVATE lost stop acknowledgement')
                return json.dumps({'success': True, 'data': {'task_id': 't1'}})
            return original(command)
        self.rcon.cmd = transport
        delay = patch('numen_gateway.time.sleep', return_value=None)
        delay.start()
        self.addCleanup(delay.stop)

    def enforce(self):
        return self.gateway.enforce_navigation_deadline(self.gateway.snapshot())

    def test_expired_food_stops_exact_native_task_and_reads_food_terminal(self):
        status = self.gateway.action_status(self.enforce())
        self.assertEqual(len(self.stop_calls), 1)
        self.assertEqual(status['receipt']['status'], 'failed')
        self.assertTrue(status['receipt']['completionConfirmed'])
        self.assertEqual(status['receipt']['nativeFoodOutcome']['nativeState'], 'CANCELLED')
        self.assertIsNone(status['receipt']['navigationOutcome'])
        journal = status['receipt']['foodStop']
        self.assertEqual(journal['reason'], 'food_total_wait_limit')
        self.assertEqual(journal['maxWaitMs'], FOOD_MAX_WAIT_MS)
        self.assertEqual(journal['terminal']['requestId'], self.action_id)
        self.assertTrue((self.root / 'action-stops' / (self.action_id + '.json')).exists())
        self.assertFalse((self.root / 'unknown.json').exists())
        self.enforce()
        self.assertEqual(len(self.stop_calls), 1)

    def test_stop_ack_loss_uses_read_only_original_food_receipt(self):
        self.stop_lost_ack = True
        status = self.gateway.action_status(self.enforce())
        self.assertEqual(len(self.stop_calls), 1)
        self.assertEqual(status['receipt']['status'], 'failed')
        self.assertEqual(status['receipt']['foodStop']['stopErrorType'], 'ConnectionError')
        self.assertNotIn('PRIVATE', str(status))
        self.assertEqual(len(fixtures.FoodReceiptTests.sent(self)), 1)

    def test_unknown_stop_remains_blocked_without_repeat_after_restart(self):
        self.stop_effect, self.stop_lost_ack = False, True
        self.enforce()
        self.assertEqual(len(self.stop_calls), 1)
        self.assertEqual(read_json(self.root / 'unknown.json')['reason'], 'food_stop_outcome_unknown')
        self.assertTrue(self.gateway.navigation_stop_pending(self.gateway.snapshot()))
        restarted = NumenGateway(self.root, self.rcon, clock=self.gateway.clock)
        restarted.enforce_navigation_deadline(restarted.snapshot())
        self.assertEqual(len(self.stop_calls), 1)
        self.assertTrue(restarted.action_status()['inFlight'])

    def test_crash_after_stop_claim_never_assumes_it_can_send_again(self):
        receipt = read_json(self.root / 'inflight-action.json')
        journal = {'schema': 1, 'actionId': self.action_id, 'nativeTaskId': 't1',
                   'bodyUuid': fixtures.BODY_UUID, 'navigationEpoch': receipt['before']['navigationEpoch'],
                   'tool': 'eat', 'foodEpoch': 'food-epoch', 'phase': 'dispatching',
                   'reason': 'food_total_wait_limit'}
        write_json(self.root / 'action-stops' / (self.action_id + '.json'), journal)
        self.enforce()
        self.assertFalse(self.stop_calls)
        self.assertTrue((self.root / 'unknown.json').exists())

    def test_read_only_status_does_not_cancel_expired_food(self):
        status = self.gateway.action_status()
        self.assertTrue(status['inFlight'])
        self.assertFalse(self.stop_calls)
        self.assertFalse((self.root / 'action-stops').exists())

    def test_natural_food_success_at_boundary_is_not_cancelled(self):
        self.rcon.busy = False
        self.rcon.finish()
        status = self.gateway.action_status(self.enforce())
        self.assertFalse(self.stop_calls)
        self.assertEqual(status['receipt']['status'], 'completed')

    def test_unexpired_legacy_other_body_or_operator_pause_never_stops(self):
        path = self.root / 'inflight-action.json'
        original = read_json(path)
        self.gateway.clock = lambda: fixtures.NOW + FOOD_MAX_WAIT_MS / 1000 - .001
        self.enforce()
        self.gateway.clock = lambda: fixtures.NOW + FOOD_MAX_WAIT_MS / 1000
        legacy = copy.deepcopy(original)
        legacy['result']['result'].pop('nativeFoodReceipt')
        write_json(path, legacy)
        self.enforce()
        write_json(path, original)
        self.rcon.task_id = 't2'
        self.enforce()
        self.rcon.task_id = 't1'
        write_json(self.root / 'control.json', {'schema': 1, 'enabled': False})
        self.enforce()
        self.assertFalse(self.stop_calls)

    def test_changed_food_epoch_after_stop_stays_unknown(self):
        self.rcon.query_change = {'epoch': 'other-native-process'}
        self.enforce()
        self.assertEqual(len(self.stop_calls), 1)
        self.assertEqual(read_json(self.root / 'unknown.json')['reason'], 'food_stop_outcome_unknown')
        self.assertEqual(read_json(self.root / 'inflight-action.json')['status'], 'in_flight')


if __name__ == '__main__':
    unittest.main()
