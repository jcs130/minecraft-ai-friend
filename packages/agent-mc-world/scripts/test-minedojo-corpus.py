"""Offline boundary checks using original synthetic text, not redistributed Wiki data."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('minedojo_corpus', Path(__file__).with_name('minedojo-corpus.py'))
corpus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(corpus)


class OfflineReferenceContract(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.input = self.root / 'source.json'
        self.index = self.root / 'index.sqlite'
        # This is our own contract fixture, not a claim about Minecraft mechanics.
        self.fixture = {
            'metadata': {'url': 'https://minecraft.fandom.com/wiki/Bread', 'title': 'Bread', 'time': '17/04/2022 03:54:59'},
            'texts': [{'text': 'Synthetic bread reference. ' * 300}, {'text': 'Synthetic bread reference. ' * 300}],
            'tables': [{'bbox': [1, 2, 3, 4], 'headers': {'text': ['Own example'], 'bboxes': [[1, 2, 3, 4]]},
                        'cells': {'text': ['x' * 300] * 35, 'bboxes': [[1, 2, 3, 4]] * 35}}],
            'images': [{'path': 'not-downloaded.png'}], 'sprites': [],
        }
        self.write(self.fixture)

    def write(self, value, path=None):
        (path or self.input).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')

    def build(self):
        return corpus.build([self.input], self.index)

    def test_provenance_unknowns_and_immutable_bounded_reads(self):
        built = self.build()
        self.assertEqual(built['textBlocks'], 1)
        before = hashlib.sha256(self.index.read_bytes()).hexdigest()
        results = corpus.search(self.index, '面包', 5)['results']
        self.assertEqual(len(results), 1)
        row = results[0]
        self.assertEqual(row['annotationSha256'], hashlib.sha256(self.input.read_bytes()).hexdigest())
        self.assertEqual(row['sourceLicense'], 'CC-BY-NC-SA-3.0')
        self.assertIsNone(row['minecraftVersion'])
        self.assertIsNone(row['capturedTimezone'])
        self.assertFalse(row['minecraftVersionVerified'])
        self.assertFalse(row['currentWorldVerified'])
        self.assertFalse(row['trustedInstructions'])
        page = corpus.get(self.index, row['id'], 0, 4000)
        self.assertEqual(len(page['text']), 4000)
        self.assertEqual(page['nextOffset'], 4000)
        self.assertFalse(page['imagesLoaded'])
        table = corpus.get(self.index, row['id'], 0, 1, table_index=0)
        self.assertEqual(len(table['cells']), 16)
        self.assertEqual(len(table['cells'][0]['text']), 256)
        self.assertTrue(table['cells'][0]['truncated'])
        self.assertIn('unverified', table['layout'])
        tail = corpus.get(self.index, row['id'], 0, 1, table_index=0, cell_offset=32)
        self.assertEqual(len(tail['cells']), 3)
        self.assertIsNone(tail['nextCellOffset'])
        self.assertEqual(hashlib.sha256(self.index.read_bytes()).hexdigest(), before)
        with corpus.closing(corpus.open_index(self.index)) as connection:
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute('DELETE FROM pages')

    def test_existing_index_and_conflicting_snapshots_are_preserved(self):
        self.build()
        before = self.index.read_bytes()
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual(self.index.read_bytes(), before)
        other = copy.deepcopy(self.fixture)
        other['texts'].append({'text': 'Conflicting snapshot'})
        conflict = self.root / 'conflict.json'
        self.write(other, conflict)
        with self.assertRaisesRegex(ValueError, 'Conflicting snapshots'):
            corpus.build([self.input, conflict], self.root / 'other.sqlite')

    def test_unexpected_source_and_malformed_tables_fail_before_build(self):
        for url in ['http://minecraft.fandom.com/wiki/Bread', 'https://example.org/wiki/Bread',
                    'https://user:secret@minecraft.fandom.com/wiki/Bread']:
            with self.subTest(url=url):
                value = copy.deepcopy(self.fixture)
                value['metadata']['url'] = url
                self.write(value)
                with self.assertRaisesRegex(ValueError, 'source URL'):
                    self.build()
                self.assertFalse(self.index.exists())
        value = copy.deepcopy(self.fixture)
        value['tables'][0]['cells']['bboxes'] = [['x', 1, 2, 3]]
        self.write(value)
        with self.assertRaisesRegex(ValueError, 'table cells'):
            self.build()
        self.assertFalse(self.index.exists())

    def test_query_syntax_and_bounds_do_not_become_sql_or_body_actions(self):
        self.build()
        for query, limit in [('', 5), ('x' * 201, 5), ('bread', 0), ('bread', 11)]:
            with self.subTest(query=query, limit=limit), self.assertRaises(ValueError):
                corpus.search(self.index, query, limit)
        self.assertEqual(corpus.search(self.index, '"; DROP TABLE pages; --', 5)['results'], [])
        self.assertEqual(corpus.search(self.index, 'bread', 1)['results'][0]['title'], 'Bread')
        with self.assertRaises(ValueError):
            corpus.get(self.index, 'missing', 0, 1)
        for offset, length in [(-1, 1), (0, 4001), (0, 0)]:
            with self.subTest(offset=offset, length=length), self.assertRaises(ValueError):
                corpus.get(self.index, 'any', offset, length)


if __name__ == '__main__':
    unittest.main()
