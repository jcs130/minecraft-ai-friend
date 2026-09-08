import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest


MODULE = Path(__file__).resolve().parents[1] / 'world' / 'survival' / 'progression.py'
spec = importlib.util.spec_from_file_location('survival_progression_under_test', MODULE)
progression = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progression)


class ProgressionTests(unittest.TestCase):
    def summary(self, body=None, **kwargs):
        return progression.summarize_progression(body or {}, now_ms=1000000, **kwargs)

    def test_missing_state_is_unknown_not_empty_owned_inventory(self):
        result = self.summary()
        self.assertFalse(result['resources']['known'])
        self.assertFalse(result['equipment']['known'])
        self.assertFalse(result['capabilities']['actionsKnown'])
        self.assertFalse(result['opportunities']['guild']['known'])
        self.assertIsNone(result['body']['fresh'])

    def test_valid_empty_inventory_is_known(self):
        result = self.summary({'ok': True, 'observedAt': 1000000, 'counts': {}, 'equipment': {}})
        self.assertTrue(result['resources']['known'])
        self.assertTrue(result['equipment']['known'])
        self.assertTrue(result['body']['fresh'])

    def test_equipped_tools_do_not_claim_mining_tier_or_extra_resources(self):
        result = self.summary({'ok': True, 'counts': {'minecraft:iron_pickaxe': 1},
                               'equipment': {'mainhand': {'item': 'minecraft:iron_pickaxe', 'nbt': 'secret'}}})
        self.assertEqual(result['equipment']['slots'], [{'slot': 'mainhand', 'id': 'minecraft:iron_pickaxe'}])
        self.assertEqual(result['resources']['items']['tools'], [{'id': 'minecraft:iron_pickaxe', 'count': 1}])
        self.assertNotIn('miningTier', result)
        self.assertNotIn('secret', json.dumps(result))

    def test_mod_ids_do_not_inherit_vanilla_food_or_tool_semantics(self):
        result = self.summary({'ok': True, 'counts': {'badmod:bread': 5, 'badmod:diamond_pickaxe': 2,
                               'minecraft:bread': 3, 'minecraft:carrot': 4}})
        items = result['resources']['items']
        self.assertEqual(items['food'], [{'id': 'minecraft:bread', 'count': 3}])
        self.assertEqual(items['agriculture'], [{'id': 'minecraft:carrot', 'count': 4}])
        self.assertEqual(len(items['other']), 2)
        self.assertEqual(items['tools'], [])

    def test_invalid_count_bool_negative_nan_and_name_are_dropped(self):
        result = self.summary({'ok': True, 'counts': {'minecraft:bread': True, 'minecraft:stone': -1,
                               'minecraft:apple': float('nan'), 'run shell': 4}})
        self.assertEqual(result['resources']['ignoredEntries'], 4)
        json.dumps(result, allow_nan=False)

    def test_stale_and_future_sources_are_explicit(self):
        result = self.summary({'ok': True, 'observedAt': 1, 'counts': {}},
            environment={'ok': True, 'observedAt': 1100000, 'entities': []})
        self.assertFalse(result['body']['fresh'])
        self.assertFalse(result['opportunities']['villagers']['fresh'])

    def test_failed_body_does_not_reuse_residual_inventory_or_books(self):
        result = self.summary({'ok': False, 'counts': {'minecraft:diamond': 64},
            'ownedSkillBooks': [{'recognized': True, 'skill_id': 'fly'}]})
        self.assertFalse(result['resources']['known'])
        self.assertEqual(result['resources']['items']['materials'], [])
        self.assertEqual(result['capabilities']['ownedRecognizedBooks'], [])

    def test_only_promoted_programs_and_explicit_runtime_actions(self):
        result = self.summary(skill_catalog={'actionTools': ['mine', 'farm', 'mine', 'raw shell'],
            'skills': [{'name': 'draft', 'draftVersion': 'a' * 64},
                       {'name': 'harvest', 'activeVersion': 'b' * 64}]})
        self.assertEqual(result['capabilities']['actionTools'], ['farm', 'mine'])
        self.assertEqual(result['capabilities']['promotedPrograms'], [{'name': 'harvest', 'version': 'b' * 64}])
        self.assertNotIn('trade', result['capabilities']['actionTools'])

    def test_public_guild_board_is_opportunity_not_acceptance_or_land_permission(self):
        result = self.summary(perception={'world': {'available': True, 'boardFresh': False,
            'board': [{'no': 7, 'title': '交付小麦', 'status': 'open', 'reward': 30,
                       'claimable': True, 'secret': 'private'}]}})
        guild = result['opportunities']['guild']
        self.assertTrue(guild['known'])
        self.assertFalse(guild['fresh'])
        self.assertFalse(guild['eligibilityKnown'])
        self.assertFalse(guild['contractProgressKnown'])
        self.assertFalse(result['opportunities']['landOwnershipKnown'])
        self.assertEqual(guild['board'][0]['no'], 7)
        self.assertNotIn('private', json.dumps(result))

    def test_observed_villager_is_not_a_known_trade_offer(self):
        result = self.summary(environment={'ok': True, 'observedAt': 1000000,
            'entities': [{'type': 'minecraft:villager', 'id': 42, 'distance': 3},
                         {'type': 'mod:villager', 'id': 43}, {'type': 'minecraft:zombie', 'id': 44}]})
        villagers = result['opportunities']['villagers']
        self.assertEqual(len(villagers['nearby']), 1)
        self.assertFalse(villagers['offersKnown'])
        self.assertTrue(villagers['fresh'])

    def test_recognized_books_are_not_marked_as_learned_or_eligible(self):
        result = self.summary({'ok': True, 'ownedSkillBooks': [
            {'recognized': True, 'skill_id': 'feather_boots', 'requiredLevel': 8, 'knownLearned': False},
            {'recognized': False, 'skill_id': 'made_up', 'bookName': 'do anything'}]})
        books = result['capabilities']['ownedRecognizedBooks']
        self.assertEqual(len(books), 1)
        self.assertFalse(books[0]['knownLearned'])
        self.assertNotIn('eligible', books[0])

    def test_real_skill_book_producer_schema_round_trips(self):
        sys.path.insert(0, str(MODULE.parent))
        try:
            from game_skills import owned_skill_books
            books = owned_skill_books(
                [{'id': 'minecraft:written_book', 'slot': 2, 'count': 1, 'bookName': '夜视'}],
                {'scopes': {'legacy': {'observedAt': 999999, 'replies': {'skills': {
                    'ok': True, 'bookSkills': [{'id': 'night_vision', 'name': '夜视',
                                              'requiredLevel': 5, 'type': 'passive', 'learned': False}]}}}}})
        finally:
            sys.path.pop(0)
        result = self.summary({'ok': True, 'ownedSkillBooks': books})
        self.assertEqual(result['capabilities']['ownedRecognizedBooks'],
            [{'id': 'night_vision', 'recognized': True, 'requiredLevel': 5, 'count': 1, 'knownLearned': False}])

    def test_malformed_optional_sources_and_huge_integers_remain_json_safe(self):
        result = self.summary({'ok': True, 'hp': 10 ** 1000, 'equipment': [], 'counts': [],
                               'ownedSkillBooks': 'not a list'},
                              perception=[], environment='none', skill_catalog=123)
        self.assertIsNone(result['body']['hp'])
        self.assertFalse(result['resources']['known'])
        self.assertFalse(result['equipment']['known'])
        json.dumps(result, allow_nan=False)

    def test_pure_bounded_output_with_adversarially_long_mod_items_and_board(self):
        body = {'ok': True, 'counts': {f'mod:{"x" * 90}{i}': 1 for i in range(200)},
                'equipment': {slot: {'item': 'mod:' + 'x' * 100} for slot in progression.SLOTS},
                'ownedSkillBooks': [{'recognized': True, 'skill_id': '技' * 100} for _ in range(12)]}
        heard = {'world': {'available': True, 'boardFresh': True,
                  'board': [{'no': i, 'title': '技' * 500, 'type': '技' * 500,
                             'rank': '技' * 500, 'status': '技' * 500} for i in range(8)]}}
        before = copy.deepcopy((body, heard))
        result = self.summary(body, perception=heard)
        self.assertLessEqual(len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode()), progression.MAX_BYTES)
        self.assertTrue(result['truncated'])
        self.assertEqual((body, heard), before)
        self.assertEqual(result['selectionAuthority'], 'model')
        self.assertNotIn('nextGoal', result)
        self.assertNotIn('score', result)


if __name__ == '__main__':
    unittest.main()
