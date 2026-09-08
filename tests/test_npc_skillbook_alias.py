"""Offline checks of the actual NPC shop constructors; no runtime files/RCON."""
import ast
from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock


def constructors():
    path = Path(__file__).resolve().parents[1] / 'world/sidecar/mc_npc.py'
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    functions = {'normalize_profiles', '_resolve_skillbook', '_snbt_esc',
                 '_skillbook_nbt', '_recipes_nbt'}
    selected = [node for node in tree.body
                if (isinstance(node, ast.FunctionDef) and node.name in functions)
                or (isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == 'SKILLBOOKS'
                    for target in node.targets))]
    namespace = {'json': json, 'print': Mock(), 'quest_of': lambda _: None,
                 'quests_today': lambda: {'quests': []}}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace


class SkillbookAlias(unittest.TestCase):
    def setUp(self):
        self.ns = constructors()

    def test_legacy_and_canonical_construct_identical_writable_books(self):
        definition = self.ns['SKILLBOOKS']['craft']
        self.assertIs(definition['writable'], True)
        resolved = [self.ns['_resolve_skillbook'](key, 'fixture') for key in ['craftbook', 'craft']]
        self.assertEqual([key for key, _ in resolved], ['craft', 'craft'])
        self.assertTrue(all(book is definition for _, book in resolved))
        items = [self.ns['_skillbook_nbt'](book, key) for key, book in resolved]
        self.assertEqual(items[0], items[1])
        self.assertEqual(items[0], '{id:"minecraft:writable_book",count:1,components:'
                         '{"minecraft:custom_data":{"craftreq":true}}}')
        self.ns['print'].assert_not_called()

    def test_complete_offers_preserve_price_stock_and_imported_profile(self):
        old = {'key': 'fixture', 'shop': [[{'skillbook': 'craftbook', 'emerald': 6, 'max': 3}]]}
        original = deepcopy(old)
        normalized = self.ns['normalize_profiles']([old])[0]
        canonical = deepcopy(normalized)
        canonical['shop'][0]['skillbook'] = 'craft'
        legacy_offer = self.ns['_recipes_nbt'](normalized)
        self.assertEqual(legacy_offer, self.ns['_recipes_nbt'](canonical))
        self.assertIn('buy:{id:"minecraft:emerald",count:6}', legacy_offer)
        self.assertIn('maxUses:3', legacy_offer)
        self.assertEqual(old, original)
        self.assertEqual(normalized['shop'][0]['skillbook'], 'craftbook')

    def test_other_unknown_keys_are_logged_and_skipped(self):
        valid = {'item': 'bread', 'emerald': 1, 'count': 6}
        mixed = {'key': 'fixture', 'shop': [{'skillbook': 'unrecognized_spell'}, valid]}
        self.assertEqual(self.ns['_recipes_nbt'](mixed),
                         self.ns['_recipes_nbt']({'key': 'fixture', 'shop': [valid]}))
        self.ns['print'].assert_called_once()
        message = self.ns['print'].call_args.args[0]
        self.assertIn('unrecognized_spell', message)
        self.assertIn('fixture', message)
        self.assertIn('skipped', message)
        self.assertIsNone(self.ns['_recipes_nbt']({'key': 'fixture', 'shop': [{'skillbook': 'unknown_only'}]}))


if __name__ == '__main__':
    unittest.main()
