import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('portal_storage_guard', Path(__file__).resolve().parents[1] / 'portal-storage-guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def volume(available=3 * guard.GIB, root_free=4 * guard.GIB, inodes=5000):
    return SimpleNamespace(f_frsize=4096, f_bsize=4096, f_bavail=available // 4096,
                           f_bfree=root_free // 4096, f_favail=inodes, f_files=100000)


class StorageGuardTests(unittest.TestCase):
    def test_root_reserved_space_cannot_make_an_unprivileged_website_pass(self):
        with tempfile.TemporaryDirectory() as root:
            result = guard.storage_budget([root], probe=lambda _: volume(available=0))
        self.assertFalse(result['passed'])
        self.assertEqual(result['checks'][0]['reason'], 'PORTAL_STORAGE_LOW_SPACE')

    def test_budget_covers_the_next_backup_before_stopping_a_healthy_site(self):
        with tempfile.TemporaryDirectory() as root:
            result = guard.storage_budget([root], write_budget_bytes=2 * guard.GIB,
                                          probe=lambda _: volume())
        self.assertFalse(result['passed'])
        self.assertEqual(result['checks'][0]['requiredBytes'], 4 * guard.GIB)

    def test_each_deployment_filesystem_is_checked(self):
        with tempfile.TemporaryDirectory() as root:
            first, second = Path(root) / 'one', Path(root) / 'two'
            first.mkdir(); second.mkdir()
            result = guard.storage_budget([first, second], probe=lambda p: volume(available=3 * guard.GIB if p == first else 0))
        self.assertFalse(result['passed'])
        self.assertTrue(result['checks'][0]['passed'])
        self.assertFalse(result['checks'][1]['passed'])

    def test_an_empty_inode_pool_is_rejected_even_when_bytes_are_available(self):
        with tempfile.TemporaryDirectory() as root:
            result = guard.storage_budget([root], probe=lambda _: volume(inodes=0))
        self.assertEqual(result['checks'][0]['reason'], 'PORTAL_STORAGE_LOW_INODES')

    def test_missing_target_uses_its_existing_parent_without_creating_it(self):
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'new' / 'candidate'
            report = guard.require_storage([destination], probe=lambda _: volume())
            self.assertTrue(report['passed'])
            self.assertFalse(destination.exists())

    def test_invalid_budget_is_rejected(self):
        for kwargs in [{'write_budget_bytes': -1}, {'minimum_free_bytes': -1}, {'minimum_free_inodes': -1}]:
            with self.assertRaises(ValueError):
                guard.storage_budget(['.'], **kwargs)


if __name__ == '__main__':
    unittest.main()
