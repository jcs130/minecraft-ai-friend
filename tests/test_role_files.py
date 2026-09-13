"""QA file ownership and native-result contracts; no Qwen/model needed."""
import asyncio
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import smoke_role_files as smoke


class RoleFileSmoke(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.nonce = 'a' * 32

    def test_colliding_file_is_not_overwritten_or_deleted(self):
        path = smoke.qa_path(self.folder, 'notes', self.nonce)
        path.parent.mkdir(); path.write_text('preexisting')
        async def forbidden(*args): self.fail('must not invoke file tools on collision')
        row = asyncio.run(smoke.exercise_file(self.folder, 'notes', self.nonce, forbidden))
        self.assertFalse(row['ok'])
        self.assertEqual(path.read_text(), 'preexisting')

    def test_cleanup_rejects_foreign_content(self):
        path = smoke.qa_path(self.folder, 'notes', self.nonce)
        smoke.reserve(path); path.write_text('changed by another writer')
        with self.assertRaisesRegex(ValueError, 'qa_cleanup_content_changed'):
            smoke.clean_file(self.folder, 'notes', self.nonce, {'our original'})
        self.assertTrue(path.exists())

    def test_cleanup_does_not_remove_neighbor(self):
        path = smoke.qa_path(self.folder, 'notes', self.nonce)
        created = smoke.reserve(path)
        neighbor = path.parent / 'real-note.md'; neighbor.write_text('keep')
        self.assertTrue(smoke.clean_file(self.folder, 'notes', self.nonce, {''}, created_directory=created))
        self.assertEqual(neighbor.read_text(), 'keep')

    def test_invalid_paths_and_nonce_fail_before_filesystem_changes(self):
        for directory, nonce in [('../other', self.nonce), ('notes', '../escape'), ('memory', 'a' * 33)]:
            with self.assertRaisesRegex(ValueError, 'invalid_qa_path'):
                smoke.qa_path(self.folder, directory, nonce)
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_linked_parent_is_rejected(self):
        target = self.folder / 'outside'; target.mkdir()
        try:
            (self.folder / 'notes').symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest('symlink permission unavailable')
        with self.assertRaisesRegex(ValueError, 'linked_path_rejected'):
            smoke.qa_path(self.folder, 'notes', self.nonce)

    def test_native_error_is_reported_and_owned_file_cleaned(self):
        async def failed(*args): return SimpleNamespace(state='denied', content=[])
        row = asyncio.run(smoke.exercise_file(self.folder, 'memory', self.nonce, failed))
        self.assertFalse(row['ok']); self.assertTrue(row['cleaned'])
        self.assertEqual(row['nativeCalls'], [{'tool': 'write_file', 'state': 'denied'}])
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_true_result_requires_read_tool_content_and_disk_match(self):
        calls = []
        async def invoke(name, arguments):
            calls.append(name)
            path = Path(arguments['file_path'])
            if not path.is_absolute(): path = self.folder / path
            if name == 'write_file': path.write_text(arguments['content'], encoding='utf-8')
            elif name == 'append_file':
                with path.open('a', encoding='utf-8') as stream: stream.write(arguments['content'])
            elif name == 'edit_file':
                path.write_text(path.read_text(encoding='utf-8').replace(arguments['old_text'], arguments['new_text']), encoding='utf-8')
            body = path.read_text(encoding='utf-8') if name == 'read_file' else 'success'
            return SimpleNamespace(state='success', content=[SimpleNamespace(type='text', text=body)])
        row = asyncio.run(smoke.exercise_file(self.folder, 'notes', self.nonce, invoke))
        self.assertTrue(row['ok']); self.assertTrue(row['cleaned'])
        self.assertEqual(calls, list(smoke.FILE_TOOLS))


if __name__ == '__main__':
    unittest.main()
