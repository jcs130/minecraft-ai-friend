"""A persisted catalogue replaces runtime discovery, without granting execution."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from skill_library import SkillLibrary, SkillError
from test_survival_skills import SOURCE, FIXTURES


class IndexTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.library = SkillLibrary(self.root / 'local', self.root / 'shared')

    def draft(self, description='one'):
        return self.library.draft('example', SOURCE, FIXTURES, description)['version']

    def test_reads_and_restarts_do_not_enumerate_directories(self):
        version = self.draft()
        with patch.object(Path, 'iterdir', side_effect=AssertionError('runtime scan')):
            second = SkillLibrary(self.library.root, self.library.world_root)
            self.assertEqual(second.catalog()['skills'][0]['draftVersion'], version)
            self.assertEqual(second.read('example')['version'], version)

    def test_other_process_sees_promotions_and_keeps_active_description_on_draft(self):
        second = SkillLibrary(self.library.root)
        old = self.draft()
        self.library.test('example', old)
        self.library.promote('example', old)
        new = self.draft('two')
        row = second.catalog()['skills'][0]
        self.assertEqual((row['activeVersion'], row['draftVersion'], row['description']),
                         (old, new, 'one'))
        self.library.test('example', new)
        self.library.promote('example', new)
        self.assertEqual(second.catalog()['skills'][0]['description'], 'two')

    def test_shared_publication_updates_reader_index_and_local_takes_precedence(self):
        reader = SkillLibrary(self.root / 'reader', self.library.world_root)
        version = self.draft()
        self.library.test('example', version)
        self.library.promote('example', version)
        self.library.publish('example', version)
        self.assertEqual(reader.catalog()['skills'][0]['activeVersion'], version)
        self.assertTrue(reader.catalog()['skills'][0]['shared'])
        reader.draft('example', SOURCE, FIXTURES, 'local fix')
        self.assertNotIn('shared', reader.catalog()['skills'][0])
        self.assertFalse(self.library.publish('example', version)['published'])

    def test_corrupt_index_requires_explicit_repair_and_never_scans_on_read(self):
        self.draft()
        (self.library.root / 'catalog.json').write_text('broken', encoding='utf8')
        with patch.object(Path, 'iterdir', side_effect=AssertionError('runtime scan')):
            with self.assertRaisesRegex(SkillError, 'invalid_skill_store'):
                self.library.catalog()
        self.assertEqual(len(self.library.rebuild_index()['skills']), 1)

    def test_index_cannot_grant_promotion_or_tests(self):
        version = self.draft()
        path = self.library.root / 'catalog.json'
        data = json.loads(path.read_text())
        data['skills'][0]['activeVersion'] = version
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(SkillError, 'promoted_skill_required'):
            self.library.run('example', {})

    def test_same_store_cannot_deadlock_publication(self):
        with self.assertRaisesRegex(SkillError, 'shared_skill_store_must_be_distinct'):
            SkillLibrary(self.root, self.root)


if __name__ == '__main__':
    unittest.main()
