"""Guard that compatibility repairs leave existing rewards and criteria intact."""
import copy
import json
from pathlib import Path
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from prepare_content_fixes import repair, SPECS


class ExistingContentPreserved(unittest.TestCase):
    def test_pinned_upstream_content_only_loses_invalid_references(self):
        for jar, resource, kind in SPECS:
            with self.subTest(resource=resource), zipfile.ZipFile(ROOT/'server/mc/mods'/jar) as archive:
                original = json.loads(archive.read(resource))
                unchanged = copy.deepcopy(original)
                fixed = repair(original, kind)
                self.assertEqual(original, unchanged, 'Repair must not mutate input')
                restored = copy.deepcopy(fixed)
                if kind == 'anthill':
                    old = original['pools'][0]['entries']
                    new = restored['pools'][0]['entries']
                    self.assertEqual(sum(e.get('weight', 1) for e in old), sum(e.get('weight', 1) for e in new))
                    for index, entry in enumerate(old):
                        if entry.get('name') == 'spawn:roly_poly':
                            self.assertEqual(new[index]['type'], 'minecraft:empty')
                            new[index] = entry
                elif kind == 'assassin':
                    restored['pools'][0]['entries'][0]['functions'][0]['components']['minecraft:enchantments']['levels']['farmersdelight:backstabbing'] = 3
                else:
                    self.assertEqual(fixed['criteria'], original['criteria'])
                    self.assertEqual(fixed['parent'], 'dungeons_arise:wda_root')
                    restored['parent'] = original['parent']
                    restored['display']['icon'] = original['display']['icon']
                self.assertEqual(restored, original, 'All unrelated content must survive unchanged')

    def test_unexpected_upstream_shape_is_rejected(self):
        with self.assertRaises(ValueError):
            repair({'pools': [{'entries': [{'name': 'spawn:future_item'}]}]}, 'anthill')
        with self.assertRaises(ValueError):
            repair({'parent': 'dungeons_arise:new_root'}, 'advancement')


if __name__ == '__main__':
    unittest.main()
