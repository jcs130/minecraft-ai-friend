from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest
import yaml

OPS = Path(__file__).resolve().parents[1]
spec = spec_from_file_location("floor_regions", OPS / "prepare-dungeon-floor-regions.py")
regions = module_from_spec(spec)
spec.loader.exec_module(regions)


class FloorRegionTests(unittest.TestCase):
    def test_only_six_room_interiors_are_open(self):
        cells = set()
        for guard in regions.guards().values():
            lo, hi = guard['min'], guard['max']
            for x in range(lo['x'], hi['x'] + 1):
                for y in range(lo['y'], hi['y'] + 1):
                    for z in range(lo['z'], hi['z'] + 1):
                        cell = (x, y, z)
                        self.assertNotIn(cell, cells)
                        cells.add(cell)
        for x in range(-610, -569):
            for y in range(-64, 102):
                for z in range(-338, -269):
                    interior = -602 < x < -578 and -317 < z < -293 and any(
                        h < y < h + 7 for h in regions.LEVELS)
                    self.assertEqual((x, y, z) in cells, not interior)

    def test_preserves_other_regions_flags_and_is_idempotent(self):
        source = (OPS.parent / 'content/trial-facility-ground-region.yml').read_text(encoding='utf-8')
        source += '  separate_private_home:\n    priority: 1000010\n    flags: {block-break: deny}\n'
        candidate = regions.render(source)
        self.assertEqual(regions.render(candidate), candidate)
        after = yaml.safe_load(candidate)['regions']
        before = yaml.safe_load(source)['regions']
        self.assertEqual(before['separate_private_home'], after['separate_private_home'])
        expected = dict(before[regions.PARENT]['flags'])
        del expected['block-place'], expected['block-break']
        self.assertEqual(expected, after[regions.PARENT]['flags'])
        with self.assertRaises(ValueError):
            regions.render(source.replace('block-break: deny', 'block-break: allow', 1))

if __name__ == '__main__':
    unittest.main()
