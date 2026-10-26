import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from live_registry import LiveRegistry


class RegistryBootTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.complete = self.root / 'server/dump/maw-registry-ids/complete.json'
        self.complete.parent.mkdir(parents=True)
        self.registry = LiveRegistry({'serverDir': str(self.root / 'server'), 'runtimeDir': str(self.root / 'ops'),
            '_raw': {'agentGateway': {'releaseDir': str(self.root / 'release')}}})
        self.commands = []

    def tearDown(self): self.temp.cleanup()

    def write(self, pid, version):
        self.complete.write_text(json.dumps({'processId': pid, 'completedAt': version}), encoding='utf-8')

    def test_old_same_pid_export_does_not_count_and_request_is_not_repeated(self):
        self.write(42, 'old')
        with patch.object(self.registry, '_start_prepare') as prepare:
            self.assertFalse(self.registry.tick(42, self.commands.append))
            self.assertFalse(self.registry.tick(42, self.commands.append))
            self.assertEqual(self.commands, ['maw_registry dumpids'])
            prepare.assert_not_called()
            self.write(42, 'fresh')
            self.assertFalse(self.registry.tick(42, self.commands.append))
            prepare.assert_called_once()

    def test_foreign_pid_can_never_start_preparation(self):
        with patch.object(self.registry, '_start_prepare') as prepare:
            self.registry.tick(42, self.commands.append)
            self.write(99, 'fresh')
            self.assertFalse(self.registry.tick(42, self.commands.append))
            prepare.assert_not_called()
            with self.assertRaisesRegex(RuntimeError, 'not ready'): self.registry.environment()

    def test_new_jvm_invalidates_previous_ready_snapshot(self):
        self.registry.pid = 42; self.registry.phase = 'ready'; self.registry.output = self.root / 'old'
        self.assertFalse(self.registry.tick(43, self.commands.append))
        self.assertIsNone(self.registry.output)
        self.assertEqual(self.registry.phase, 'waiting_for_export')
        with self.assertRaisesRegex(RuntimeError, 'not ready'): self.registry.environment()


if __name__ == '__main__': unittest.main()
