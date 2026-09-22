"""Routine candidate generator tests: shape, preconditions, boundedness. No IO."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))

from routine_candidates import build_candidates, MAX_STEP
from system_one import validate_choice


BODY = {'ok': True, 'hp': 20.0, 'maxHp': 20.0, 'hunger': 20,
        'position': {'x': -215.0, 'y': 64.0, 'z': 884.0},
        'counts': {}, 'equipment': {'mainhand': {'item': 'minecraft:iron_sword', 'count': 1}}}


class RoutineCandidatesTests(unittest.TestCase):
    def test_valid_shape_passes_validate_choice(self):
        body = dict(BODY, hunger=8, counts={'minecraft:bread': 3})
        proposal = build_candidates(body, 'explore east')
        self.assertIsNotNone(proposal)
        validate_choice(proposal)
        ids = [c['id'] for c in proposal['candidates']]
        self.assertIn('eat_food', ids)
        self.assertIn('none', ids)

    def test_quiet_body_yields_no_proposal(self):
        self.assertIsNone(build_candidates(BODY, 'whatever'))

    def test_body_not_ok_never_generates(self):
        self.assertIsNone(build_candidates({'ok': False}, 'goal'))

    def test_eat_uses_food_actually_in_bag(self):
        body = dict(BODY, hunger=10, counts={'minecraft:apple': 1})
        row = next(c for c in build_candidates(body)['candidates'] if c['id'] == 'eat_food')
        self.assertEqual(row['action'], {'tool': 'eat', 'args': {'item_id': 'minecraft:apple'}})

    def test_eat_heal_only_when_hurt(self):
        body = dict(BODY, hp=8.0, maxHp=20.0, hunger=20, counts={'minecraft:bread': 2})
        ids = [c['id'] for c in build_candidates(body)['candidates']]
        self.assertIn('eat_heal', ids)
        self.assertNotIn('eat_food', ids)

    def test_equip_only_when_mainhand_empty_and_tool_in_bag(self):
        body = dict(BODY, equipment={'mainhand': {}}, counts={'minecraft:iron_axe': 1})
        row = next(c for c in build_candidates(body)['candidates'] if c['id'] == 'equip_tool')
        self.assertEqual(row['action']['tool'], 'equip_item')
        self.assertEqual(row['action']['args']['slot'], 'mainhand')
        self.assertIsNone(build_candidates(dict(BODY, counts={'minecraft:iron_axe': 1})))

    def test_goto_leg_is_bounded_and_directed(self):
        anchor = {'x': -500.0, 'z': 800.0}
        row = next(c for c in build_candidates(BODY, 'go', anchor)['candidates'] if c['id'] == 'goto_leg')
        args = row['action']['args']
        self.assertEqual(row['action']['tool'], 'goto')
        dx, dz = args['x'] - BODY['position']['x'], args['z'] - BODY['position']['z']
        self.assertLessEqual((dx * dx + dz * dz) ** .5, MAX_STEP + 1e-6)
        self.assertLess(args['x'], BODY['position']['x'])
        self.assertLess(args['z'], BODY['position']['z'])

    def test_no_goto_for_near_anchor(self):
        self.assertIsNone(build_candidates(BODY, 'goal', {'x': -220.0, 'z': 890.0}))

    def test_none_candidate_has_no_action(self):
        body = dict(BODY, hunger=8, counts={'minecraft:bread': 3})
        row = next(c for c in build_candidates(body)['candidates'] if c['id'] == 'none')
        self.assertIsNone(row['action'])


if __name__ == '__main__':
    unittest.main()
