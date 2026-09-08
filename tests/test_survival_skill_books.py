"""Carried skill book discovery without book text, actions or live servers."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from game_skills import owned_skill_books
from numen_gateway import inventory_from_snbt, NumenGateway, write_json
from test_survival_gateway import MockRcon, BODY_UUID, NOW


def cache(rows, stamp=100):
    return {'schema': 1, 'observedAt': stamp, 'scopes': {'legacy': {
        'observedAt': stamp, 'replies': {'skills': {'ok': True, 'bookSkills': rows}}}}}


def inventory(label='夜视'):
    from nbtlib import String
    return '[{Slot:-106b,id:"minecraft:written_book",count:1,components:{"minecraft:custom_data":{skillbook:' + String(label).snbt() + ',secret:"PRIVATE"},"minecraft:written_book_content":{title:"PRIVATE",pages:["PRIVATE"]}}}]'


class SkillBookTests(unittest.TestCase):
    def test_only_short_exact_component_survives_inventory_projection(self):
        items, counts = inventory_from_snbt(inventory())
        self.assertEqual(items, [{'id': 'minecraft:written_book', 'count': 1, 'slot': -106, 'bookName': '夜视'}])
        self.assertEqual(counts, {'minecraft:written_book': 1})
        self.assertNotIn('PRIVATE', json.dumps(items))
        for label in ('x' * 65, 'name\ncommand', ''):
            self.assertNotIn('bookName', inventory_from_snbt(inventory(label))[0][0])
        forged = '[{Slot:1b,id:"minecraft:written_book",count:1,components:{"minecraft:written_book_content":{title:"skillbook:夜视"}}}]'
        self.assertNotIn('bookName', inventory_from_snbt(forged)[0][0])
        nonbook = inventory().replace('minecraft:written_book"', 'minecraft:paper"')
        self.assertNotIn('bookName', inventory_from_snbt(nonbook)[0][0])

    def test_passive_book_maps_to_real_id_without_claiming_learning(self):
        books = inventory_from_snbt(inventory())[0]
        source = cache([{'id': 'night_vision', 'name': '夜视', 'type': 'passive', 'requiredLevel': 5, 'learned': False}])
        original = copy.deepcopy(source)
        row = owned_skill_books(books, source)[0]
        self.assertEqual(row['skill_id'], 'night_vision')
        self.assertEqual(row['type'], 'passive'); self.assertEqual(row['requiredLevel'], 5)
        self.assertTrue(row['recognized']); self.assertFalse(row['knownLearned'])
        self.assertTrue(row['historicalCatalog']); self.assertEqual(row['catalogObservedAt'], 100)
        self.assertEqual(source, original)

    def test_unknown_missing_and_ambiguous_catalogs_never_invent_an_id(self):
        books = inventory_from_snbt(inventory())[0]
        for source, reason in (({}, 'catalog_unavailable'), (cache([]), 'unrecognized'),
                (cache([{'id': 'a', 'name': '夜视'}, {'id': 'b', 'name': '夜视'}]), 'ambiguous')):
            row = owned_skill_books(books, source)[0]
            self.assertEqual(row['recognition'], reason)
            self.assertFalse(row['recognized']); self.assertNotIn('skill_id', row)

    def test_latest_catalog_wins_and_projection_is_bounded(self):
        books = [{'id': 'minecraft:written_book', 'count': 1, 'slot': i, 'bookName': '名' * 64} for i in range(36)]
        source = cache([{'id': 'old', 'name': '名' * 64}])
        source['scopes']['all'] = cache([{'id': 'current', 'name': '名' * 64}], 200)['scopes']['legacy']
        rows = owned_skill_books(books, source)
        self.assertTrue(rows); self.assertLessEqual(len(rows), 12)
        self.assertLessEqual(len(json.dumps(rows, ensure_ascii=False).encode('utf-8')), 6000)
        self.assertTrue(all(row['skill_id'] == 'current' for row in rows))

    def test_invalid_numeric_catalog_metadata_cannot_break_body_observation(self):
        books = inventory_from_snbt(inventory())[0]
        invalid = cache([{'id': 'night_vision', 'name': '夜视', 'requiredLevel': 10 ** 400}])
        self.assertNotIn('requiredLevel', owned_skill_books(books, invalid)[0])
        invalid['scopes']['legacy']['observedAt'] = 10 ** 400
        self.assertEqual(owned_skill_books(books, invalid)[0]['recognition'], 'catalog_unavailable')

    def test_snapshot_reuses_its_existing_read_and_cached_catalog_without_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            write_json(state / 'settings.json', {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID})
            write_json(state / 'game-skills.json', cache([{'id': 'night_vision', 'name': '夜视', 'type': 'passive'}]))
            rcon = MockRcon(); rcon.inventory = inventory()
            body = NumenGateway(state, rcon, clock=lambda: NOW).snapshot()
            self.assertTrue(body['ok']); self.assertEqual(body['skillBooks'][0]['bookName'], '夜视')
            self.assertEqual(body['ownedSkillBooks'][0]['skill_id'], 'night_vision')
            self.assertFalse(body['skillBooksTruncated']); self.assertNotIn('PRIVATE', json.dumps(body))
            self.assertEqual(sum(' Inventory' in command for command in rcon.calls), 1)
            self.assertFalse(rcon.mutations())


class SkillBookContextTests(unittest.TestCase):
    import test_survival_controller as fixtures
    setUp = fixtures.ControllerTests.setUp
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def test_matching_book_ids_reach_model_context_without_full_book_contents(self):
        self.controller.data['wakeReason'] = 'world_event'
        books = inventory_from_snbt(inventory())[0]
        owned = owned_skill_books(books, cache([{'id': 'night_vision', 'name': '夜视', 'type': 'passive'}]))
        body = self.gateway.body | {'skillBooks': books, 'ownedSkillBooks': owned, 'skillBooksTruncated': False}
        context = self.controller.planning_context(body, {}, 'turn')
        self.assertEqual(context['body']['ownedSkillBooks'][0]['skill_id'], 'night_vision')
        self.assertEqual(context['body']['skillBooks'], books)
        self.assertNotIn('PRIVATE', json.dumps(context))


if __name__ == '__main__':
    unittest.main()
