"""Only the atomic rename is retried on transient host sharing violations."""
import errno
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
import numen_gateway as gateway


class AtomicStateTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.path = self.root / 'controller.json'
        self.path.write_text('{"previous":true}', encoding='utf8')

    def test_sharing_violation_retries_one_synced_file_with_identical_bytes(self):
        replace, fsync = gateway.os.replace, gateway.os.fsync
        seen = []
        def transient(source, target):
            seen.append((source, target, source.read_bytes()))
            if len(seen) <= 2:
                self.assertEqual(json.loads(target.read_text()), {'previous': True})
                raise PermissionError(errno.EACCES, 'fixture host sharing lock')
            return replace(source, target)
        with patch.object(gateway.os, 'replace', side_effect=transient), \
             patch.object(gateway.os, 'fsync', wraps=fsync) as sync, \
             patch.object(gateway.time, 'sleep') as sleep:
            gateway.write_json(self.path, {'active': {'phase': 'reserved'}, 'attempts': [1, 2, 3]})
        self.assertEqual(len(seen), 3)
        self.assertTrue(all(row == seen[0] for row in seen))
        self.assertEqual(sync.call_count, 1)
        self.assertEqual([call.args for call in sleep.call_args_list], [(0.05,), (0.1,)])
        self.assertEqual(gateway.read_controller_json(self.path)['attempts'], [1, 2, 3])
        self.assertEqual(list(self.root.glob('*.tmp')), [])

    def test_persistent_permission_failure_is_bounded_and_keeps_last_committed_state(self):
        with patch.object(gateway.os, 'replace', side_effect=PermissionError(errno.EACCES, 'fixture')) as replace, \
             patch.object(gateway.time, 'sleep') as sleep:
            with self.assertRaises(PermissionError):
                gateway.write_json(self.path, {'new': True})
        self.assertEqual(replace.call_count, 6)
        self.assertEqual(sum(call.args[0] for call in sleep.call_args_list), 1.55)
        self.assertEqual(gateway.read_json(self.path), {'previous': True})
        self.assertEqual(list(self.root.glob('*.tmp')), [])

    def test_other_io_errors_are_not_treated_as_host_reader_contention(self):
        with patch.object(gateway.os, 'replace', side_effect=OSError(errno.EIO, 'fixture')) as replace, \
             patch.object(gateway.time, 'sleep') as sleep:
            with self.assertRaises(OSError):
                gateway.write_json(self.path, {'new': True})
        self.assertEqual(replace.call_count, 1)
        sleep.assert_not_called()
        self.assertEqual(gateway.read_json(self.path), {'previous': True})

    def test_serialization_failure_never_renames_partial_state(self):
        with patch.object(gateway.os, 'replace') as replace:
            with self.assertRaises(ValueError):
                gateway.write_json(self.path, {'invalid': float('nan')})
        replace.assert_not_called()
        self.assertEqual(gateway.read_json(self.path), {'previous': True})
        self.assertEqual(list(self.root.glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
