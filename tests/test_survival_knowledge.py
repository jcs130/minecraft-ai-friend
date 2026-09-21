"""Historical knowledge and conversation goals never grant body actions."""
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

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


class KnowledgePathTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def write_pack(self, root, name, content):
        path = root / name / 'SKILL.md'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        return path

    def test_explicit_roots_override_environment_and_read_independently_after_restart(self):
        roots = [self.root / name for name in ('kirito', 'naruto')]
        fallback = self.root / 'fallback'
        paths = [self.write_pack(root, 'tier_progression', content)
                 for root, content in zip(roots + [fallback],
                                          ('Kirito reference', 'Naruto reference', 'Environment decoy'))]
        paths += [self.write_pack(roots[0], 'combat_basics', 'Kirito combat'),
                  self.write_pack(roots[1], 'containers', 'Naruto containers')]
        before = {path: path.read_bytes() for path in paths}
        with patch.dict('knowledge.os.environ', {'SURVIVOR_KNOWLEDGE_ROOT': str(fallback)}):
            libraries = [KnowledgeLibrary(roots[0]), KnowledgeLibrary(str(roots[1]))]
            hashes = []
            for index, root in enumerate(roots):
                with self.subTest(root=root):
                    expected_names = {'tier_progression', ('combat_basics', 'containers')[index]}
                    first = libraries[index].read('tier_progression')
                    self.assertTrue(first['ok'])
                    self.assertEqual(first['content'], ('Kirito reference', 'Naruto reference')[index])
                    hashes.append(first['sha256'])
                    for library in (libraries[index], KnowledgeLibrary(root)):
                        self.assertEqual(library.root, root.absolute())
                        self.assertEqual(library.read('tier_progression'), first)
                        self.assertEqual({item['name'] for item in library.catalog()['items']}, expected_names)
                        self.assertFalse(library.read(('containers', 'combat_basics')[index])['ok'])
            self.assertNotEqual(*hashes)
        # KnowledgeLibrary is read-only: restart/read/catalog must not rewrite either pack.
        self.assertEqual({path: path.read_bytes() for path in paths}, before)

    def test_omitted_and_none_root_capture_environment_fallback_per_instance(self):
        libraries = []
        for name in ('first', 'second'):
            root = self.root / name
            self.write_pack(root, 'tier_progression', name)
            with patch.dict('knowledge.os.environ', {'SURVIVOR_KNOWLEDGE_ROOT': str(root)}):
                for kwargs in ({}, {'root': None}):
                    libraries.append((KnowledgeLibrary(**kwargs), root, name))
        # Changing/restoring the process environment cannot redirect an existing instance.
        for library, root, content in libraries:
            with self.subTest(root=root):
                self.assertEqual(library.root, root.absolute())
                self.assertEqual(library.read('tier_progression')['content'], content)

    def test_unset_environment_keeps_legacy_default_without_production_io(self):
        with patch.dict('knowledge.os.environ', {}, clear=True):
            for kwargs in ({}, {'root': None}):
                with self.subTest(kwargs=kwargs), patch('knowledge.Path') as path:
                    path.return_value.absolute.return_value = self.root
                    library = KnowledgeLibrary(**kwargs)
                    path.assert_called_once_with('/survival-knowledge')
                    self.assertEqual(library.root, self.root)


class ConversationGoalTests(unittest.TestCase):
    def test_goal_is_persisted_without_resuming_or_changing_lease_and_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            write_json(state / 'settings.json', {'bodyUuid': 'fixture-body', 'ownerUuid': 'fixture-owner'})
            values = {'control.json': {'enabled': False}, 'lease.json': {'status': 'closed'},
                      'driver-state.json': {'modelCalls': 51, 'decisions': [1, 2, 3]}}
            for name, value in values.items():
                write_json(state / name, value)
            result = submit_goal(state, '找到自己的安全营地，然后学习真正的技能。', clock=lambda: 1800000000)
            self.assertEqual(result['code'], 'goal_queued'); self.assertFalse(result['executionConfirmed'])
            from goal_agenda import GoalAgenda
            intent = GoalAgenda(state).snapshot()['goals'][0]
            self.assertEqual(str(uuid.UUID(intent['goalId'])), result['intentId'])
            self.assertEqual(intent['createdAt'], 1800000000000)
            self.assertIn('安全营地', intent['goal'])
            for name, value in values.items():
                self.assertEqual(read_json(state / name), value)
            self.assertFalse((state / 'unknown.json').exists())

    def test_empty_or_oversized_goal_cannot_overwrite_an_accepted_goal(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            write_json(state / 'settings.json', {'bodyUuid': 'fixture-body', 'ownerUuid': 'fixture-owner'})
            from goal_agenda import GoalAgenda
            submit_goal(state, '保留目标')
            old = GoalAgenda(state).snapshot()
            for value in ('', '   ', 'x' * 1201, '\0', None, {}):
                self.assertFalse(submit_goal(state, value)['ok'])
                self.assertEqual(GoalAgenda(state).snapshot(), old)


if __name__ == '__main__':
    unittest.main()
