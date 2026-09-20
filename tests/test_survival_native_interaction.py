"""Generic controls use the existing receipt journal, never replay a click."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_survival_world_actions import FakeGateway, POINT
from numen_gateway import GatewayError, read_json, write_json, TOOLS
from world_actions import validate_world_action
from mcp_server import TOOL_NAMES

TURN = 'turn_native_interaction_123456'
ARGS = {**POINT, 'button': 'right', 'hold_ticks': 0}


class NativeInteractionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name)
        self.gateway = FakeGateway(self.state)
        self.gateway.on_interaction_receipt = lambda row: row.update(nativeTaskId='native-original')
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': True})
        write_json(self.state / 'lease.json', {'schema': 1, 'status': 'open', 'turnId': TURN,
            'expiresAt': self.gateway._now() + 100000, 'actionsUsed': 0, 'actionLimit': 6})

    def action(self, args=None):
        return self.gateway.action(TURN, 'interact_at', copy.deepcopy(ARGS if args is None else args))

    def clicks(self):
        return [call for call in self.gateway.calls if call[0] == 'rcon' and 'qdworld interact ' in call[1]]

    def test_same_primitive_available_to_model_and_program(self):
        self.assertIn('interact_at', TOOL_NAMES)
        self.assertIn('interact_at', TOOLS)
        result = self.action()
        self.assertTrue(result['completionConfirmed'], result)
        self.assertEqual(result['receipt']['status'], 'completed')
        self.assertEqual(len(self.clicks()), 1)
        # Completion certifies the native interaction, not a guessed skill goal.
        self.assertNotIn('verified', result['result']['data'])

    def test_holding_and_forward_use_are_preserved(self):
        args = {'button': 'right', 'x': None, 'y': None, 'z': None, 'hold_ticks': 100,
                'item_id': 'minecraft:coal'}
        result = self.action(args)
        self.assertTrue(result['ok'], result)
        self.assertEqual(self.gateway.interaction_receipts[result['actionId']]['args'], args)

    def test_invalid_partial_targets_durations_items_do_not_dispatch(self):
        for changes in ({'x': None}, {'hold_ticks': -1}, {'hold_ticks': 101}, {'hold_ticks': True},
                        {'x': True}, {'button': 'execute'}, {'item_id': 'minecraft:dirt\nkill @a'},
                        {'extra': 'ignored'}):
            with self.subTest(changes=changes):
                with self.assertRaises(GatewayError):
                    validate_world_action('interact_at', ARGS | changes)
        self.assertFalse(self.clicks())

    def test_body_area_and_carried_item_checks_precede_dispatch(self):
        with patch.object(self.gateway, '_area', side_effect=GatewayError('protected_area')):
            self.assertEqual(self.action()['code'], 'protected_area')
        self.assertEqual(self.action(ARGS | {'item_id': 'minecraft:diamond'})['code'], 'required_item_not_carried')
        self.assertFalse(self.clicks())
        self.assertEqual(read_json(self.state / 'lease.json')['actionsUsed'], 0)

    def test_accepted_with_idle_body_is_pending_then_exact_terminal_without_replay(self):
        self.gateway.interaction_states = ['accepted', 'running', 'terminal']
        result = self.action()
        self.assertTrue(result['ok'], result)
        self.assertFalse(result['completionConfirmed'])
        self.assertEqual(result['receipt']['status'], 'in_flight')
        pending = self.gateway._settle_inflight(self.gateway.snapshot())
        self.assertEqual(pending['status'], 'in_flight')
        done = self.gateway._settle_inflight(self.gateway.snapshot())
        self.assertEqual(done['status'], 'completed')
        self.assertTrue(done['completionConfirmed'])
        self.assertIn('nativeInteractionOutcome', done)
        self.assertEqual(len(self.clicks()), 1)

    def test_native_failure_is_known_and_does_not_claim_success(self):
        self.gateway.native_reply = {'success': False, 'message': 'ray_occluded'}
        result = self.action()
        self.assertFalse(result['ok'])
        self.assertTrue(result['completionConfirmed'])
        self.assertEqual(result['receipt']['status'], 'failed')
        self.assertFalse((self.state / 'unknown.json').exists())

    def test_changed_epoch_or_task_cannot_settle_original_action(self):
        for key, value in [('epoch', '11111111-1111-1111-1111-111111111111'), ('nativeTaskId', 'different')]:
            with self.subTest(key=key):
                self.gateway.interaction_states = ['accepted']
                result = self.action()
                self.assertTrue(result['ok'], result)
                def changed(row, key=key, value=value):
                    row['nativeTaskId'] = 'native-original'
                    row[key] = value
                self.gateway.on_interaction_receipt = changed
                with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
                    self.gateway._settle_inflight(self.gateway.snapshot())
                self.assertTrue((self.state / 'inflight-action.json').exists())
                self.gateway.on_interaction_receipt = lambda row: row.update(nativeTaskId='native-original')
                self.gateway._settle_inflight(self.gateway.snapshot())
        self.assertEqual(len(self.clicks()), 2)

    def test_lost_dispatch_reply_queries_original_id_only(self):
        original = self.gateway._native_interact
        def lost(*args):
            original(*args)
            raise TimeoutError('lost after native dispatch')
        with patch.object(self.gateway, '_native_interact', side_effect=lost), patch('world_actions.time.sleep'):
            result = self.action()
        self.assertTrue(result['completionConfirmed'], result)
        self.assertEqual(len(self.clicks()), 1)


if __name__ == '__main__':
    unittest.main()
