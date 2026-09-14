"""Real-file cursor/rotation checks without a server or model."""
import errno
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from log_tail import LogTail


class LogTailTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'latest.log'
        self.path.write_bytes('旧聊天\n'.encode())
        self.messages = []
        self.reader = LogTail(self.path, self.messages.append)
        self.addCleanup(self.reader.close)
        self.assertEqual(self.reader.readline(), '')

    def append(self, data):
        with self.path.open('ab') as handle:
            handle.write(data)

    def test_read_failure_after_advancing_reopens_last_delivered_position(self):
        self.append('已交付\n'.encode())
        self.assertEqual(self.reader.readline(), '已交付\n')
        original = self.reader.stream

        class BrokenRead:
            def readline(self):
                original.read(4)
                raise OSError(getattr(errno, 'ENODATA', 61), 'No data available')

            def close(self):
                original.close()

        self.reader.stream = BrokenRead()
        self.append('桐人：等我一起\n'.encode())
        self.assertEqual(self.reader.readline(), '')
        self.assertEqual(self.reader.readline(), '桐人：等我一起\n')
        self.assertEqual(self.reader.readline(), '')
        self.assertEqual(len(self.messages), 2)

    def test_partial_utf8_and_line_are_not_delivered_early(self):
        message = '结衣：我听见了\n'.encode()
        self.append(message[:2])
        self.assertEqual(self.reader.readline(), '')
        self.append(message[2:-1])
        self.assertEqual(self.reader.readline(), '')
        self.append(message[-1:])
        self.assertEqual(self.reader.readline(), message.decode())
        self.assertEqual(self.reader.readline(), '')

    def test_rotation_skips_preexisting_lines_without_replaying_old_chat(self):
        self.reader.close()
        self.path.rename(self.path.with_suffix('.old'))
        self.path.write_bytes(b'historical replacement\n')
        self.assertEqual(self.reader.readline(), '')
        self.append(b'new after rotation\n')
        self.assertEqual(self.reader.readline(), 'new after rotation\n')

    def test_missing_file_does_not_terminate_loop_or_spam_error(self):
        self.reader.close()
        self.path.unlink()
        self.assertEqual(self.reader.readline(), '')
        self.assertEqual(self.reader.readline(), '')
        self.assertEqual(len(self.messages), 1)
        self.path.write_bytes(b'replacement\n')
        self.assertEqual(self.reader.readline(), '')
        self.append(b'current\n')
        self.assertEqual(self.reader.readline(), 'current\n')


if __name__ == '__main__':
    unittest.main()
