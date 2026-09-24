"""An escaped body may return or eat carried food; world permissions stay bounded."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import test_survival_gateway as fixture
import numen_gateway as gateway


class AreaRecoveryTests(unittest.TestCase):
    setUp = fixture.GatewayTests.setUp
    write = fixture.GatewayTests.write
    lease = fixture.GatewayTests.lease

    def test_short_inward_step_can_still_end_outside(self):
        self.rcon.position = {'x': 200, 'y': 64, 'z': 100}
        self.lease()
        with patch('navigation_sense.NavigationSense.for_destination', return_value={}), patch(
                'navigation_sense.supported_column_y', return_value=64):
            result = self.client.action(fixture.TURN, 'goto', {'x': 180, 'z': 100})
        self.assertEqual(result['code'], 'accepted')
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_inward_step_must_keep_height_and_distance_guards(self):
        self.rcon.position = {'x': 200, 'y': 64, 'z': 100}
        self.lease()
        result = self.client.action(fixture.TURN, 'goto', {'x': 160, 'z': 100})
        self.assertEqual(result['code'], 'walk_target_too_far')
        with patch('navigation_sense.NavigationSense.for_destination', return_value={}), patch(
                'navigation_sense.supported_column_y', return_value=None):
            result = self.client.action(fixture.TURN, 'goto', {'x': 180, 'z': 100})
        self.assertEqual(result['code'], 'walk_height_unverified')
        self.assertFalse(self.rcon.mutations())

    def test_escape_never_authorizes_sideways_away_or_other_actions(self):
        self.rcon.position = {'x': 170, 'y': 64, 'z': 170}
        self.lease()
        for target in ({'x': 180, 'z': 160}, {'x': 170, 'z': 175}, {'x': 170, 'z': 170}):
            self.assertEqual(self.client.action(fixture.TURN, 'goto', target)['code'], 'outside_work_area')
        for tool, args in (('craft', {'item_id': 'minecraft:bread', 'count': 1}),
                           ('mine', {'block_ids': ['minecraft:oak_log'], 'count': 1}),
                           ('drop_items', {'item_id': 'minecraft:bread', 'count': 1})):
            self.assertEqual(self.client.action(fixture.TURN, tool, args)['code'], 'outside_work_area')
        self.assertFalse(self.rcon.mutations())

    def test_boundary_error_gives_computed_inward_direction(self):
        self.rcon.position = {'x': 200, 'y': 64, 'z': 100}
        self.lease()
        result = self.client.action(fixture.TURN, 'goto', {'x': 210, 'z': 100})
        self.assertEqual(result['code'], 'outside_work_area')
        hint = result['areaPreflight']['recovery']
        # A boundary target within the native arrival tolerance can report
        # success while the body remains outside. Aim beyond that tolerance.
        self.assertEqual(hint['nearestInside'], {'x': 158, 'z': 100})
        self.assertEqual(hint['arrivalInset'], 2)
        self.assertEqual(hint['direction'], 'west')
        self.assertLess(hint['suggestedStep']['x'], 200)
        self.assertLessEqual(hint['maxHorizontalDistance'], 24)

    def test_unknown_still_blocks_inward_steps(self):
        self.rcon.position = {'x': 200, 'y': 64, 'z': 100}
        self.lease()
        self.write('unknown.json', {'status': 'unknown'})
        result = self.client.action(fixture.TURN, 'goto', {'x': 180, 'z': 100})
        self.assertEqual(result['code'], 'outcome_unknown')
        result = self.client.action(fixture.TURN, 'eat', {'item_id': 'minecraft:bread'})
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertFalse(self.rcon.mutations())

    def test_outside_eat_uses_exact_native_receipt_even_after_lost_ack(self):
        from test_survival_food_receipts import FoodRcon
        self.rcon = self.client.rcon = FoodRcon()
        self.rcon.position = {'x': 200, 'y': 64, 'z': 100}
        self.rcon.lose_ack = True
        self.lease()
        result = self.client.action(fixture.TURN, 'eat', {'item_id': 'minecraft:bread'})
        self.assertEqual(result['code'], 'accepted')
        self.assertFalse(result['completionConfirmed'])
        action_id = result['actionId']
        self.assertTrue(any(cmd.endswith(action_id) for cmd in self.rcon.calls if cmd.startswith('qdworld eating ')))
        self.rcon.finish()
        receipt = self.client.action_status()['receipt']
        self.assertEqual(receipt['actionId'], action_id)
        self.assertEqual(receipt['status'], 'completed')
        self.assertTrue(receipt['completionConfirmed'])
        self.assertEqual(receipt['nativeFoodOutcome']['requestId'], action_id)
        self.assertFalse(self.client.action(fixture.TURN, 'eat', {'item_id': 'minecraft:bread'})['ok'])
        self.assertEqual(len([cmd for cmd in self.rcon.calls if cmd.startswith('qdworld eat ')]), 1)

    def test_motor_outside_eat_owns_one_body_slot_until_exact_terminal(self):
        from test_survival_food_receipts import FoodRcon
        from motor_mailbox import open_cognition, enqueue_locked, view
        from motor_loop import tick
        self.rcon = self.client.rcon = FoodRcon()
        self.rcon.position = {'x': 200, 'y': 64, 'z': 100}
        self.settings['asyncMotor'] = True
        self.write('settings.json', self.settings)
        clock = lambda: fixture.NOW
        open_cognition(self.state, fixture.TURN, (fixture.NOW + 100) * 1000, clock)
        with gateway.action_lock(self.state):
            enqueue_locked(self.state, fixture.TURN, 'action',
                           {'tool': 'eat', 'args': {'item_id': 'minecraft:bread'}}, clock)
            enqueue_locked(self.state, fixture.TURN, 'action',
                           {'tool': 'goto', 'args': {'x': 180, 'y': 64, 'z': 100}}, clock)
        controller = SimpleNamespace(root=self.state, gateway=self.client, data={}, clock=clock,
            discard_policy=lambda: None, pause=lambda reason: self.fail(reason),
            collect_action_receipts=lambda turn: None, record=lambda *args, **kwargs: None)
        tick(controller, self.client.snapshot(), {'enabled': True})
        rows = view(self.state)['requests']
        self.assertEqual([row['status'] for row in rows], ['claimed', 'queued'])
        controller.data['actionExecution'] = self.client.action_status()
        tick(controller, self.client.snapshot(), {'enabled': True})
        self.assertEqual(len(self.rcon.mutations()), 1)
        self.assertEqual([row['status'] for row in view(self.state)['requests']], ['claimed', 'queued'])
        self.rcon.finish()
        controller.data['actionExecution'] = self.client.action_status()
        tick(controller, self.client.snapshot(), {'enabled': True})
        rows = view(self.state)['requests']
        self.assertEqual([row['status'] for row in rows], ['completed', 'claimed'])
        self.assertTrue(rows[0]['receipt']['completionConfirmed'])
        full = self.client.turn_receipts(rows[0]['motorTurnId'])[-1]
        self.assertEqual(full['turnId'], rows[0]['motorTurnId'])
        self.assertEqual(full['actionId'], rows[0]['receipt']['actionId'])
        self.assertEqual(len([cmd for cmd in self.rcon.calls if cmd.startswith('qdworld eat ')]), 1)
        self.assertEqual(len(self.rcon.mutations()), 2)

    def test_motor_dispatches_only_explicit_recovery_and_keeps_exact_receipt(self):
        from motor_mailbox import open_cognition, enqueue_locked, view
        from motor_loop import tick
        self.settings['asyncMotor'] = True
        self.write('settings.json', self.settings)
        self.rcon.position = {'x': 200, 'y': 64, 'z': 100}
        clock = lambda: fixture.NOW
        open_cognition(self.state, fixture.TURN, (fixture.NOW + 100) * 1000, clock)
        with gateway.action_lock(self.state):
            enqueue_locked(self.state, fixture.TURN, 'action',
                           {'tool': 'craft', 'args': {'item_id': 'minecraft:bread', 'count': 1}}, clock)
            enqueue_locked(self.state, fixture.TURN, 'action',
                           {'tool': 'goto', 'args': {'x': 180, 'y': 64, 'z': 100}}, clock)
        controller = SimpleNamespace(root=self.state, gateway=self.client, data={}, clock=clock,
            discard_policy=lambda: None, pause=lambda reason: self.fail(reason),
            collect_action_receipts=lambda turn: None, record=lambda *args, **kwargs: None)
        tick(controller, self.client.snapshot(), {'enabled': True})
        self.assertFalse(self.rcon.mutations())
        self.assertEqual(view(self.state)['requests'][0]['status'], 'failed')
        tick(controller, self.client.snapshot(), {'enabled': True})
        rows = view(self.state)['requests']
        self.assertEqual(rows[1]['status'], 'claimed')
        self.assertEqual(len(self.rcon.mutations()), 1)
        self.assertEqual(self.client.turn_receipts(rows[1]['motorTurnId'])[-1]['status'], 'in_flight')


if __name__ == '__main__':
    unittest.main()
