import copy
import unittest
from city_policy import BOUNDS, CENTER, POINTS, REGION, block_policy, city_regions, guide_script


class CityPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = {'schema-version': 1, 'enabled': True, 'editors': ['editor-a', 'editor-b'],
                       'villages': [{'world': 'world', 'min-x': -20, 'max-x': 20, 'min-z': -20, 'max-z': 20},
                                    {'world': 'aincrad', 'min-x': -29999984, 'max-x': 29999984, 'min-z': -29999984, 'max-z': 29999984}]}
        self.regions = {'regions': {REGION: {'type': 'cuboid', 'min': {'x': -29999984}, 'max': {'x': 29999984},
                         'priority': 1000000, 'members': {}, 'owners': {},
                         'flags': {'build': 'deny', 'block-break': 'deny', 'block-place': 'deny', 'tnt': 'deny', 'chest-access': 'allow'}},
                         'qd_block_access_editors': {'priority': 1000001, 'members': {'unique-ids': ['a', 'b']}}}}

    def test_only_city_reservation_changes_and_inputs_are_immutable(self):
        original = copy.deepcopy(self.policy)
        result = block_policy(self.policy)
        self.assertEqual(original, self.policy)
        self.assertEqual(result['editors'], original['editors'])
        self.assertEqual(result['villages'][0], original['villages'][0])
        self.assertEqual(result['villages'][1], {'world': 'aincrad', **BOUNDS})
        self.assertLess(BOUNDS['max-x'] - BOUNDS['min-x'], 750)

    def test_polygon_follows_round_city_and_excludes_rectangle_corners(self):
        self.assertEqual(len(POINTS), 64)
        def inside(x, z):
            # Convex polygon membership, including its boundary.
            return all((b['x'] - a['x']) * (z - a['z']) - (b['z'] - a['z']) * (x - a['x']) >= 0
                       for a, b in zip(POINTS, POINTS[1:] + POINTS[:1]))
        for point in [CENTER, (-942, 934), (-226, 934), (-584, 1296)]:
            self.assertTrue(inside(*point), point)
        for point in [(-1000, 934), (-180, 934), (-584, 540), (-584, 1340), (-920, 1260)]:
            self.assertFalse(inside(*point), point)

    def test_place_is_allowed_without_relaxing_break_explosions_or_editors(self):
        before = copy.deepcopy(self.regions)
        result = city_regions(self.regions)
        self.assertEqual(before, self.regions)
        self.assertEqual(result['regions']['qd_block_access_editors'], before['regions']['qd_block_access_editors'])
        region = result['regions'][REGION]
        self.assertEqual(region['type'], 'poly2d')
        self.assertNotIn('min', region)
        self.assertEqual(region['flags']['block-place'], 'allow')
        self.assertEqual(region['flags']['build'], 'allow')
        for flag in ['block-break', 'tnt']:
            self.assertEqual(region['flags'][flag], 'deny')
        self.assertEqual(region['flags']['chest-access'], 'allow')

    def test_unknown_or_disabled_policy_is_not_silently_replaced(self):
        for value in [{}, {**self.policy, 'enabled': False}, {**self.policy, 'villages': []}]:
            with self.assertRaises(ValueError):
                block_policy(value)
        with self.assertRaises(ValueError):
            city_regions({'regions': {}})

    def test_all_four_corner_regions_are_explicit_and_survive_native_prefix_reload(self):
        result = city_regions(self.regions)['regions']
        for suffix in ['ne', 'se', 'sw', 'nw']:
            key = 'qd_aincrad_outside_' + suffix
            self.assertFalse(key.startswith('qd_block_access_'))
            self.assertEqual(result[key]['flags']['block-break'], 'allow')
            self.assertEqual(result[key]['flags']['block-place'], 'allow')
            self.assertEqual(result[key]['priority'], result[REGION]['priority'])
            self.assertEqual(len(result[key]['points']), 18)

    def test_guide_keeps_loader_and_commands_and_rejects_unknown_text(self):
        text = 'loader: unchanged\n  - narrate "地图建筑禁止拆建、倒水倒岩浆和爆破；可以开门、开箱、探索与战斗。个人箱：/mycli arena stash（已学travel，成功开页耗2魔力）。"\n'
        result = guide_script(text)
        self.assertTrue(result.startswith('loader: unchanged\n'))
        self.assertIn('城外可正常挖掘建造', result)
        self.assertNotIn('地图建筑禁止拆建', result)
        with self.assertRaises(ValueError):
            guide_script('operator edited this guide')


if __name__ == '__main__':
    unittest.main()
