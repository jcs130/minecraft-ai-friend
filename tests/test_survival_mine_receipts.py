"""Exact mining terminals, including ACK loss; never touches a live world."""
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

PREFIX = 'QD_WORLD_INTERACTION_JSON '


class MineRcon(MockRcon):
    def __init__(self):
        super().__init__()
        self.mine_receipt = None
        self.lose_ack = False
        self.initial_state = 'accepted'
        self.query_change = {}

    def cmd(self, command):
        if command.startswith('qdworld mine '):
            import base64
            self.calls.append(command)
            _, _, actor, action, payload = command.split()
            self.mine_receipt = {'schema': 1, 'capability': 'numen_interaction_receipt_v1',
                'actorUuid': actor, 'requestId': action, 'epoch': 'e0200f85-b8e7-46df-9c28-8f431d67aaef',
                'tool': 'mine', 'args': json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))),
                'observedAt': NOW * 1000, 'dispatched': True, 'nativeTaskId': 't1',
                'status': self.initial_state, 'miningSelection': {'radius': 16, 'loadedOnly': True,
                    'candidateCount': 4, 'candidateLimit': 64, 'truncated': False,
                    'origin': dict(self.position), 'dimension': 'minecraft:overworld'}}
            if self.initial_state == 'terminal':
                self.finish('FAILED')
            elif self.initial_state == 'rejected':
                self.mine_receipt.update(dispatched=False, code='no_loaded_mining_targets',
                    result={'success': False, 'message': 'No requested blocks within 16 blocks in loaded chunks.'})
                self.mine_receipt.pop('nativeTaskId')
            if self.lose_ack:
                raise TimeoutError('ACK lost after native dispatch')
            return PREFIX + json.dumps(self.mine_receipt)
        if command.startswith('qdworld mining '):
            self.calls.append(command)
            return PREFIX + json.dumps((self.mine_receipt or {}) | self.query_change)
        return super().cmd(command)

    def finish(self, state='SUCCESS', gathered=4):
        self.mine_receipt.update(status='terminal', nativeState=state, completedAt=NOW * 1000 + 2000,
            result={'success': state == 'SUCCESS', 'message': f'{state}: gathered {gathered}/4 oak_log',
                    'data': {'requested': 4, 'gathered': gathered, 'target': 'oak_log'}})


class MineReceiptTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rcon = MineRcon()
        self.gateway = NumenGateway(self.root, self.rcon, clock=lambda: NOW)
        write_json(self.root / 'settings.json', {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
            'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160},
            'anchor': {'x': 0, 'z': 0}, 'protectedRadius': 32})
        write_json(self.root / 'control.json', {'schema': 1, 'enabled': True})
        self.gateway.open_lease(TURN, NOW * 1000 + 120000)

    def mine(self):
        return self.gateway.action(TURN, 'mine', {'block_ids': ['minecraft:oak_log'], 'count': 4})

    def sent(self):
        return [x for x in self.rcon.calls if x.startswith('qdworld mine ')]

    def test_exact_success_reports_native_quantity_without_inferred_inventory_delta(self):
        result = self.mine()
        self.assertTrue(result['ok'])
        self.assertEqual(result['receipt']['status'], 'in_flight')
        self.rcon.finish()
        receipt = self.gateway.action_status()['receipt']
        self.assertEqual(receipt['status'], 'completed')
        self.assertTrue(receipt['completionConfirmed'])
        self.assertEqual(receipt['nativeMineOutcome']['result']['data']['gathered'], 4)
        self.assertIsNone(receipt['navigationOutcome'])
        self.assertEqual(len(self.sent()), 1)

    def test_idle_before_terminal_preserves_original_inflight(self):
        self.mine()
        for _ in range(2):
            status = self.gateway.action_status()
            self.assertTrue(status['inFlight'])
            self.assertEqual(status['receipt']['status'], 'in_flight')
        self.assertEqual(len(self.sent()), 1)

    def test_known_failure_timeout_and_cancelled_release_without_unknown(self):
        self.mine()
        original = read_json(self.root / 'inflight-action.json')
        for state in ('FAILED', 'TIMEOUT', 'CANCELLED'):
            with self.subTest(state=state):
                write_json(self.root / 'inflight-action.json', copy.deepcopy(original))
                self.rcon.finish(state, 0)
                status = self.gateway.action_status()
                self.assertTrue(status['ok'])
                self.assertFalse(status['inFlight'])
                self.assertEqual(status['receipt']['status'], 'failed')
                self.assertTrue(status['receipt']['completionConfirmed'])
                self.assertIn(state, status['receipt']['nativeMineOutcome']['result']['message'])
                self.assertFalse((self.root / 'unknown.json').exists())

    def test_immediate_failure_is_known_non_success(self):
        self.rcon.initial_state = 'terminal'
        result = self.mine()
        self.assertFalse(result['ok'])
        self.assertTrue(result['completionConfirmed'])
        self.assertEqual(result['receipt']['status'], 'failed')

    def test_no_loaded_targets_is_clear_rejection_without_inflight(self):
        self.rcon.initial_state = 'rejected'
        result = self.mine()
        self.assertFalse(result['ok'])
        self.assertEqual(result['result']['nativeMineReceipt']['code'], 'no_loaded_mining_targets')
        self.assertFalse((self.root / 'inflight-action.json').exists())
        self.assertFalse((self.root / 'unknown.json').exists())

    def test_lost_ack_queries_only_exact_id_and_duplicate_turn_never_resends(self):
        self.rcon.lose_ack = True
        result = self.mine()
        self.assertTrue(result['ok'])
        self.assertFalse(self.mine()['ok'])
        self.assertEqual(len(self.sent()), 1)
        queries = [x for x in self.rcon.calls if x.startswith('qdworld mining ')]
        self.assertEqual(len(queries), 1)
        self.assertTrue(queries[0].endswith(result['actionId']))
        self.assertRegex(self.sent()[0].split()[-1], r'^[A-Za-z0-9_-]+$')

    def test_interrupted_unknown_retains_claim_and_never_replays(self):
        self.rcon.lose_ack = True
        self.rcon.query_change = {'status': 'unknown', 'code': 'native_runtime_interrupted'}
        self.assertEqual(self.mine()['code'], 'outcome_unknown')
        self.assertEqual(self.mine()['code'], 'lease_invalid')
        self.assertEqual(len(self.sent()), 1)
        self.assertTrue((self.root / 'unknown.json').exists())

    def test_durable_terminal_survives_navigation_epoch_change(self):
        accepted = self.mine()
        self.rcon.finish()
        self.rcon.navigation_epoch = 'replacement-navigation-epoch'

        status = self.gateway.action_status()

        self.assertFalse(status['inFlight'])
        self.assertEqual(status['receipt']['status'], 'completed')
        self.assertTrue(status['receipt']['completionConfirmed'])
        self.assertEqual(status['receipt']['actionId'], accepted['actionId'])
        self.assertEqual(status['receipt']['nativeMineOutcome']['nativeTaskId'], 't1')
        self.assertEqual(status['receipt']['nativeMineOutcome']['epoch'],
                         'e0200f85-b8e7-46df-9c28-8f431d67aaef')
        self.assertEqual(len(self.sent()), 1)
        self.assertFalse((self.root / 'inflight-action.json').exists())

    def test_unknown_after_navigation_epoch_change_preserves_exact_claim(self):
        accepted = self.mine()
        self.rcon.navigation_epoch = 'replacement-navigation-epoch'
        self.rcon.query_change = {'status': 'unknown', 'code': 'native_runtime_interrupted'}

        status = self.gateway.action_status()

        self.assertFalse(status['ok'])
        self.assertTrue(status['inFlight'])
        original = read_json(self.root / 'inflight-action.json')
        self.assertEqual(original['actionId'], accepted['actionId'])
        self.assertEqual(original['nativeTaskId'], 't1')
        self.assertEqual(len(self.sent()), 1)
        queries = [x for x in self.rcon.calls if x.startswith('qdworld mining ')]
        self.assertEqual(len(queries), 1)
        self.assertTrue(queries[0].endswith(accepted['actionId']))

    def test_identity_epoch_quantities_and_states_must_match(self):
        self.mine()
        self.rcon.finish()
        for change in ({'actorUuid': 'other'}, {'epoch': 'eeb6a013-af16-4a00-918b-936b04d9fd35'},
                {'requestId': '0' * 32}, {'nativeTaskId': 't2'}, {'args': {'block_ids': ['minecraft:stone'], 'count': 4}},
                {'tool': 'eat'}, {'nativeState': 'FAILED'},
                {'result': {'success': True, 'data': {'requested': 5, 'gathered': 4, 'target': 'oak_log'}}}):
            with self.subTest(change=change):
                self.rcon.query_change = change
                status = self.gateway.action_status()
                self.assertFalse(status['ok'])
                self.assertTrue(status['inFlight'])
                self.assertTrue((self.root / 'inflight-action.json').exists())
        self.assertEqual(len(self.sent()), 1)

    def test_legacy_t557_style_receipt_remains_unverified(self):
        result = self.mine()
        path = self.root / 'inflight-action.json'
        legacy = read_json(path)
        legacy['result']['result'].pop('nativeMineReceipt')
        write_json(path, legacy)
        status = self.gateway.action_status()
        self.assertEqual(status['receipt']['actionId'], result['actionId'])
        self.assertEqual(status['receipt']['status'], 'observed_ended')
        self.assertFalse(status['receipt']['completionConfirmed'])
        self.assertFalse(any(x.startswith('qdworld mining ') for x in self.rcon.calls))

    def test_model_summary_gets_terminal_failure_and_quantity_not_initial_ack(self):
        from numen_gateway import receipt_evidence
        self.mine()
        self.rcon.finish('TIMEOUT', gathered=2)
        summary = receipt_evidence(self.gateway.action_status()['receipt'])
        self.assertEqual(summary['requested'], {'block_ids': ['minecraft:oak_log'], 'count': 4})
        self.assertEqual(summary['mining']['nativeState'], 'TIMEOUT')
        self.assertEqual(summary['mining']['gathered'], 2)
        self.assertEqual(summary['mining']['requested'], 4)
        self.assertIn('TIMEOUT: gathered 2/4', summary['outcomeDetail'])
        self.assertNotIn('accepted', summary['outcomeDetail'])


if __name__ == '__main__':
    unittest.main()
