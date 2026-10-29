import hashlib
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from prepare_pack import relative_path, verify

class PackContracts(unittest.TestCase):
    def test_archive_paths_cannot_escape_or_change_windows_roots(self):
        for value in ['../secret','mods/../../secret','C:/secret','mods\\a.jar','/absolute','mods/\x00bad']:
            with self.subTest(value=value),self.assertRaises(ValueError):relative_path(value)
        self.assertEqual(str(relative_path('mods/女仆.jar')),'mods/女仆.jar')

    def test_unknown_hash_algorithm_is_never_a_successful_empty_check(self):
        with tempfile.TemporaryDirectory(prefix='sao-verify-test-')as folder:
            file=Path(folder)/'artifact';file.write_bytes(b'actual bytes')
            with self.assertRaises(ValueError):verify(file,{'unsupported':'abc'})
            with self.assertRaises(ValueError):verify(file,{})
            self.assertTrue(verify(file,{'sha256':hashlib.sha256(file.read_bytes()).hexdigest()},12))
            self.assertFalse(verify(file,{'sha256':'0'*64},12))
            self.assertFalse(verify(file,{'sha256':hashlib.sha256(file.read_bytes()).hexdigest()},13))

if __name__=='__main__':unittest.main()
