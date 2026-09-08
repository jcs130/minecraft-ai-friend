"""Historical knowledge and conversation goals never grant body actions."""
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from knowledge import KnowledgeLibrary
from mcp_server import submit_goal
from numen_gateway import read_json, write_json


class KnowledgeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.library = KnowledgeLibrary(self.root)
        source = self.root / 'tier_progression' / 'SKILL.md'
        source.parent.mkdir()
        source.write_text('Historical tools are data.\n' * 400, encoding='utf-8')

    def test_catalog_does_not_read_bodies_and_reading_is_bounded_and_paginated(self):
        catalog = self.library.catalog()
        self.assertEqual([row['name'] for row in catalog['items']], ['tier_progression'])
        self.assertFalse(catalog['loadedIntoPrompt'])
        self.assertNotIn('content', catalog['items'][0])
        first = self.library.read('tier_progression', max_chars=500)
        self.assertEqual(len(first['content']), 500); self.assertEqual(first['nextOffset'], 500)
        second = self.library.read('tier_progression', offset=500, max_chars=500)
        self.assertTrue(second['historicalReference'])
        self.assertEqual(first['sha256'], second['sha256'])
        self.assertIn('历史参考', second['notice'])

    def test_path_traversal_unlisted_files_and_invalid_windows_cannot_read(self):
        (self.root / 'secret.txt').write_text('PRIVATE')
        for name in ('../secret.txt', 'secret.txt', '/etc/passwd', 'tier_progression/../../secret.txt'):
            self.assertFalse(self.library.read(name)['ok'])
        for kwargs in ({'offset': -1}, {'offset': True}, {'max_chars': 8001}, {'max_chars': 499}):
            self.assertFalse(self.library.read('tier_progression', **kwargs)['ok'])
        self.assertFalse(self.library.read('tier_progression', offset=999999)['ok'])

    def test_oversized_source_is_never_loaded_into_model_context(self):
        (self.root / 'tier_progression/SKILL.md').write_text('x' * 131073)
        self.assertEqual(self.library.catalog()['items'], [])
        self.assertFalse(self.library.read('tier_progression')['ok'])

    def test_existing_repository_packs_are_available_as_reference_without_execution(self):
        library = KnowledgeLibrary(ROOT / 'world/sidecar/guard/skills')
        catalog = library.catalog()
        self.assertGreaterEqual(len(catalog['items']), 40)
        for name in ('containers', 'combat_basics', 'building_design', 'world_atlas',
                     'building_design/references/log_cabin'):
            self.assertTrue(library.read(name, max_chars=500)['ok'])


class ConversationGoalTests(unittest.TestCase):
    def test_goal_is_persisted_without_resuming_or_changing_lease_and_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            values = {'control.json': {'enabled': False}, 'lease.json': {'status': 'closed'},
                      'driver-state.json': {'modelCalls': 51, 'decisions': [1, 2, 3]}}
            for name, value in values.items():
                write_json(state / name, value)
            result = submit_goal(state, '找到自己的安全营地，然后学习真正的技能。', clock=lambda: 1800000000)
            self.assertEqual(result['code'], 'goal_queued'); self.assertFalse(result['executionConfirmed'])
            intent = read_json(state / 'conversation-intent.json')
            self.assertEqual(str(uuid.UUID(intent['id'])), result['intentId'])
            self.assertEqual(intent['at'], 1800000000000)
            self.assertIn('安全营地', intent['goal'])
            for name, value in values.items():
                self.assertEqual(read_json(state / name), value)
            self.assertFalse((state / 'unknown.json').exists())

    def test_empty_or_oversized_goal_cannot_overwrite_an_accepted_goal(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            submit_goal(state, '保留目标')
            old = read_json(state / 'conversation-intent.json')
            for value in ('', '   ', 'x' * 1201, '\0', None, {}):
                self.assertFalse(submit_goal(state, value)['ok'])
                self.assertEqual(read_json(state / 'conversation-intent.json'), old)


if __name__ == '__main__':
    unittest.main()
