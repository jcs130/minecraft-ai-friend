import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from prepare_runtime import extract, replace


class PreparationSafety(unittest.TestCase):
    def archive(self, root, name, kind=None):
        archive = root / 'input.tgz'
        with tarfile.open(archive, 'w:gz') as tar:
            row = tarfile.TarInfo(name)
            if kind:
                row.type = kind; row.linkname = '../outside'
                tar.addfile(row)
            else:
                row.size = 4; tar.addfile(row, io.BytesIO(b'test'))
        return archive

    def test_valid_archive_keeps_root_and_exact_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); extract(self.archive(root, 'package/lib/value.txt'), root/'out')
            self.assertEqual((root/'out/lib/value.txt').read_bytes(), b'test')

    def test_traversal_and_absolute_archive_are_rejected(self):
        for name in ['package/../../outside', '/package/outside', 'package/C:/outside', 'package/a\\outside']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                with self.assertRaises(ValueError): extract(self.archive(root, name), root/'out')
                self.assertFalse((root/'outside').exists())

    def test_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ValueError): extract(self.archive(root, 'package/link', tarfile.SYMTYPE), root/'out')

    def test_existing_directory_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'out').mkdir()
            with self.assertRaises(FileExistsError): extract(self.archive(root, 'package/a'), root/'out')

    def test_patch_refuses_unreviewed_or_duplicate_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp)/'source'; file.write_text('a a')
            with self.assertRaises(ValueError): replace(file, 'a', 'b')
            self.assertEqual(file.read_text(), 'a a')


if __name__ == '__main__': unittest.main()
