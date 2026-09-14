"""Native food receipts, including lost ACKs and restart uncertainty; no live mutations."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
sys.path.insert(0, str(ROOT / 'tests'))
from test_survival_gateway import MockRcon, BODY_UUID, NOW, TURN
from numen_gateway import NumenGateway, read_json, write_json
from food_actions import PREFIX


class FoodRcon(MockRcon):
    def __init__(self):
        super().__init__()
        self.food = None
        self.lose_ack = False
        self.initial_state = 'accepted'
        self.query_change = {}

    def cmd(self, command):
        if command.startswith('qdworld eat '):
            self.calls.append(command)
            import base64
            _, _, actor, action, payload = command.split()
            self.food = {'schema': 1, 'capability': 'numen_interaction_receipt_v1',
                         'actorUuid': actor, 'requestId': action, 'epoch': 'food-epoch', 'tool': 'eat',
                         'args': json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))),
                         'observedAt': NOW * 1000, 'dispatched': True, 'nativeTaskId': 't1',
                         'status': self.initial_state}
            if self.initial_state == 'terminal':
                self.finish('FAILED')
            if self.lose_ack:
                raise TimeoutError('original reply lost')
            return PREFIX + json.dumps(self.food)
        if command.startswith('qdworld eating '):
            self.calls.append(command)
            return PREFIX + json.dumps(self.food | self.query_change)
        return super().cmd(command)

    def finish(self, state='SUCCESS'):
        self.food.update(status='terminal', nativeState=state, completedAt=NOW * 1000 + 1700,
                         result={'success': state == 'SUCCESS', 'message': 'native result'})


class FoodReceiptTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rcon = FoodRcon()
        self.gateway = NumenGateway(self.root, self.rcon, clock=lambda: NOW)
        write_json(self.root / 'settings.json', {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
            'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160},
            'anchor': {'x': 0, 'z': 0}, 'protectedRadius': 32})
        write_json(self.root / 'control.json', {'schema': 1, 'enabled': True})
        self.gateway.open_lease(TURN, NOW * 1000 + 120000)

    def eat(self):
        return self.gateway.action(TURN, 'eat', {'item_id': 'minecraft:bread'})

    def sent(self):
        return [command for command in self.rcon.calls if command.startswith('qdworld eat ')]

    def test_native_success_completes_without_inferring_inventory_delta(self):
        result = self.eat()
        self.assertEqual(result['receipt']['status'], 'in_flight')
        self.assertFalse(result['completionConfirmed'])
        self.rcon.finish()
        status = self.gateway.action_status()
        self.assertEqual(status['receipt']['status'], 'completed')
        self.assertTrue(status['receipt']['completionConfirmed'])
        self.assertEqual(status['receipt']['nativeFoodOutcome']['nativeTaskId'], 't1')
        self.assertIsNone(status['receipt']['navigationOutcome'])
        self.assertEqual(len(self.sent()), 1)

    def test_full_hunger_failure_is_definite_failure(self):
        self.eat()
        self.rcon.finish('FAILED')
        status = self.gateway.action_status()
        self.assertTrue(status['ok'])
        self.assertEqual(status['receipt']['status'], 'failed')
        self.assertTrue(status['receipt']['completionConfirmed'])
        self.assertFalse((self.root / 'unknown.json').exists())

    def test_immediate_native_failure_is_not_false_completed_success(self):
        self.rcon.initial_state = 'terminal'
        result = self.eat()
        self.assertFalse(result['ok'])
        self.assertTrue(result['completionConfirmed'])
        self.assertEqual(result['receipt']['status'], 'failed')

    def test_idle_with_pending_native_result_stays_in_flight(self):
        self.eat()
        for _ in range(2):
            status = self.gateway.action_status()
            self.assertTrue(status['inFlight'])
            self.assertEqual(status['receipt']['status'], 'in_flight')
        self.assertEqual(len(self.sent()), 1)

    def test_lost_ack_only_queries_original_action_id(self):
        self.rcon.lose_ack = True
        result = self.eat()
        self.assertTrue(result['ok'])
        self.assertEqual(len(self.sent()), 1)
        queries = [command for command in self.rcon.calls if command.startswith('qdworld eating ')]
        self.assertEqual(len(queries), 1)
        self.assertTrue(queries[0].endswith(result['actionId']))
        self.assertFalse((self.root / 'unknown.json').exists())

    def test_payload_is_a_valid_brigadier_unquoted_word(self):
        self.eat()
        payload = self.sent()[0].split()[-1]
        self.assertNotIn('=', payload)
        self.assertRegex(payload, r'^[A-Za-z0-9_-]+$')

    def test_unknown_dispatch_does_not_replay_food(self):
        self.rcon.lose_ack = True
        self.rcon.query_change = {'status': 'unknown', 'code': 'native_runtime_interrupted'}
        result = self.eat()
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertEqual(self.eat()['code'], 'lease_invalid')
        self.assertEqual(len(self.sent()), 1)
        self.assertTrue((self.root / 'unknown.json').exists())

    def test_wrong_identity_epoch_args_task_or_contradictory_state_never_settles(self):
        self.eat()
        self.rcon.finish()
        for change in ({'actorUuid': 'other'}, {'epoch': 'new-process'}, {'requestId': '0' * 32},
                       {'nativeTaskId': 't2'}, {'args': {'item_id': 'minecraft:carrot'}},
                       {'tool': 'interact_at'}, {'nativeState': 'FAILED'}):
            with self.subTest(change=change):
                self.rcon.query_change = change
                status = self.gateway.action_status()
                self.assertFalse(status['ok'])
                self.assertTrue(status['inFlight'])
                self.assertTrue((self.root / 'inflight-action.json').exists())
        self.assertEqual(len(self.sent()), 1)

    def test_native_timeout_and_cancelled_are_known_non_success(self):
        self.eat()
        original = read_json(self.root / 'inflight-action.json')
        for state in ('TIMEOUT', 'CANCELLED'):
            with self.subTest(state=state):
                write_json(self.root / 'inflight-action.json', copy.deepcopy(original))
                self.rcon.finish(state)
                status = self.gateway.action_status()
                self.assertTrue(status['ok'])
                self.assertFalse(status['inFlight'])
                self.assertEqual(status['receipt']['status'], 'failed')
                self.assertTrue(status['receipt']['completionConfirmed'])

    def test_body_epoch_changed_cannot_consume_old_terminal(self):
        self.eat()
        self.rcon.finish()
        self.rcon.navigation_epoch = 'another-body-process'
        status = self.gateway.action_status()
        self.assertEqual(status['code'], 'inflight_epoch_changed')
        self.assertTrue((self.root / 'inflight-action.json').exists())

    def test_legacy_observed_receipt_is_not_rewritten_as_success(self):
        result = self.eat()
        path = self.root / 'inflight-action.json'
        legacy = read_json(path)
        legacy['result']['result'].pop('nativeFoodReceipt')
        write_json(path, legacy)
        status = self.gateway.action_status()
        self.assertEqual(status['receipt']['actionId'], result['actionId'])
        self.assertEqual(status['receipt']['status'], 'observed_ended')
        self.assertFalse(status['receipt']['completionConfirmed'])
        self.assertFalse(any(command.startswith('qdworld eating ') for command in self.rcon.calls))


if __name__ == '__main__':
    unittest.main()
