"""Safety-zone contract for the verified InControl 1.21-10.2.7 semantics.

No server commands or synthetic entity spawns. Geometry matches the shipped
Area.isInBox bytecode; hook names/defaults match SpawnRule/ForgeEventHandlers.
"""
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class VillageSafeZoneTest(unittest.TestCase):
    def setUp(self):
        self.areas = json.loads((ROOT / 'config/incontrol/areas.json').read_text(encoding='utf-8'))
        self.rules = json.loads((ROOT / 'config/incontrol/spawn.json').read_text(encoding='utf-8'))
        self.area = self.areas[0]

    def in_area(self, position):
        # InControl box uses inclusive half-extents, NOT full side lengths.
        return all(abs(value - self.area[axis]) <= self.area['dim' + axis]
                   for axis, value in zip(('x', 'y', 'z'), position))

    def denied(self, position, *, when, hostile, mob='minecraft:zombie',
               dimension='minecraft:overworld'):
        if dimension != self.area['dimension'] or not self.in_area(position):
            return False
        return any(rule['when'] == when and rule['dimension'] == dimension
                   and rule['area'] == self.area['name']
                   and (('hostile' in rule and rule['hostile'] is hostile)
                        or mob in rule.get('mob', []))
                   and rule['result'] == 'deny' for rule in self.rules)

    def test_only_existing_village_and_selectors_are_protected(self):
        self.assertEqual(len(self.areas), 1)
        self.assertEqual(self.area['name'], 'village')
        self.assertEqual(self.area['type'], 'box')
        self.assertEqual(self.area['dimension'], 'minecraft:overworld')
        self.assertEqual((self.area['x'], self.area['z']), (-545, 865))
        self.assertEqual((self.area['dimx'], self.area['dimz']), (170, 170))
        for rule in self.rules:
            selector = {'hostile'} if 'hostile' in rule else {'mob'}
            self.assertEqual(set(rule), {'when', 'dimension', 'area', 'result'} | selector)
            self.assertEqual(rule['dimension'], 'minecraft:overworld')
            self.assertEqual(rule['area'], 'village')
            self.assertEqual(rule['result'], 'deny')
            if 'hostile' in rule:
                self.assertIs(rule['hostile'], True)
            else:
                self.assertEqual(rule['mob'], ['minecraft:phantom'])

    def test_every_original_selector_has_all_three_explicit_hooks(self):
        for selector in ('hostile', 'mob'):
            hooks = [r['when'] for r in self.rules if selector in r]
            self.assertCountEqual(hooks, ['position', 'finalize', 'onjoin'])
        self.assertEqual(len(self.rules), 6)

    def test_full_overworld_build_height_including_top_boundary(self):
        for y in range(-64, 321):
            for hook in ('position', 'finalize', 'onjoin'):
                self.assertTrue(self.denied((-544, y, 865), when=hook, hostile=True))
        self.assertFalse(self.in_area((-544, -65, 865)))
        self.assertFalse(self.in_area((-544, 321, 865)))

    def test_horizontal_corners_included_one_block_outside_allowed(self):
        for x in (-715, -375):
            for z in (695, 1035):
                self.assertTrue(self.in_area((x, 70, z)))
        for pos in ((-716, 70, 865), (-374, 70, 865), (-545, 70, 694), (-545, 70, 1036)):
            for hook in ('position', 'finalize', 'onjoin'):
                self.assertFalse(self.denied(pos, when=hook, hostile=True))

    def test_confirmed_villager_death_sites_have_enemy_deny_rules(self):
        sites = ((-560.74, 74, 899.30), (-517.30, 71, 849),
                 (-621.42, 74, 934.70), (-529.34, 63, 863.11))
        for pos in sites:
            for hook in ('position', 'finalize', 'onjoin'):
                self.assertTrue(self.denied(pos, when=hook, hostile=True))

    def test_friendly_entities_and_other_dimensions_are_unaffected(self):
        for hook in ('position', 'finalize', 'onjoin'):
            for mob in ('minecraft:villager', 'minecraft:iron_golem', 'minecraft:wolf',
                        'minecraft:cat', 'touhou_little_maid:maid', 'example:neutral'):
                self.assertFalse(self.denied((-544, 70, 865), when=hook, hostile=False, mob=mob))
            self.assertFalse(self.denied((-544, 70, 865), when=hook, hostile=True,
                                         dimension='minecraft:the_nether'))

    def test_original_explicit_phantom_rule_survives_each_hook(self):
        # Independent of hostile classification: do not silently drop old policy.
        for hook in ('position', 'finalize', 'onjoin'):
            self.assertTrue(self.denied((-544, 200, 865), when=hook, hostile=False,
                                        mob='minecraft:phantom'))


if __name__ == '__main__':
    unittest.main()
