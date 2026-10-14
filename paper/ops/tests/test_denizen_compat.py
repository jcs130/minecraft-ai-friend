import importlib.util
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch as mock_patch
import zipfile

spec = importlib.util.spec_from_file_location('denizen_patch', Path(__file__).parents[1] / 'patch-denizen-1.21.1.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


def fixture(descriptor=patch.OLD, shared=False):
    def utf(value):
        return b'\x01' + struct.pack('>H', len(value)) + value
    entries = [utf(patch.OWNER), b'\x07\x00\x01', utf(b'INSTANCE'), utf(descriptor),
               b'\x0c\x00\x03\x00\x04', b'\x09\x00\x02\x00\x05']
    if shared:
        entries.append(b'\x09\x00\x02\x00\x05')
    return b'\xca\xfe\xba\xbe\x00\x00\x00\x41' + struct.pack('>H', len(entries) + 1) + b''.join(entries) + b'method-bytecode-and-mapping-fingerprint'


class DenizenCompatTest(unittest.TestCase):
    def test_only_descriptor_changes_and_methods_retained(self):
        source = fixture()
        result = patch.patch_class(source)
        self.assertTrue(result.endswith(b'method-bytecode-and-mapping-fingerprint'))
        self.assertIn(patch.NEW, result)
        self.assertEqual(struct.unpack_from('>H', result, 8)[0], 8)
        self.assertEqual(source, fixture())

    def test_repeat_and_other_versions_rejected(self):
        with self.assertRaises(ValueError):
            patch.patch_class(patch.patch_class(fixture()))
        with self.assertRaises(ValueError):
            patch.patch_class(fixture(b'Lother/Type;'))

    def test_shared_or_missing_reference_rejected(self):
        with self.assertRaises(ValueError):
            patch.patch_class(fixture(shared=True))
        with self.assertRaises(ValueError):
            patch.patch_class(b'not a class')

    def test_unknown_artifact_and_overwrite_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            source, output = Path(root) / 'source.jar', Path(root) / 'output.jar'
            source.write_bytes(b'unknown upstream build')
            with self.assertRaises(ValueError):
                patch.patch_archive(source, output)
            self.assertFalse(output.exists())
            output.write_bytes(b'keep')
            with self.assertRaises(ValueError):
                patch.patch_archive(source, output)
            self.assertEqual(output.read_bytes(), b'keep')

    def test_archive_retains_source_and_other_entries(self):
        with tempfile.TemporaryDirectory() as root:
            source, output = Path(root) / 'source.jar', Path(root) / 'output.jar'
            with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(patch.CLASS, fixture())
                archive.writestr('license.txt', 'original license')
                archive.writestr('other.class', b'unchanged')
            original = source.read_bytes()
            with mock_patch.object(patch, 'SOURCE_SHA256', hashlib.sha256(original).hexdigest()):
                report = patch.patch_archive(source, output)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(report['unchangedEntries'], 2)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read('other.class'), b'unchanged')
                self.assertIsNone(archive.testzip())


if __name__ == '__main__':
    unittest.main()
