"""Offline regression for the observed turn-index replace/read ENOENT race."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
import numen_gateway as gateway

TURN = 'survival-bdddcbb9afd04e5fbed19cfad0a3a3f8'
FIRST = 'c779dc693c8943209619b5bd1466a40c'
SECOND = '074283b41952413ba95e2caf21dea491'


class StateReadTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.path = self.root / 'turn-actions' / (TURN + '.json')
        self.index = {'schema': 1, 'turnId': TURN, 'actionIds': [FIRST, SECOND]}
        gateway.write_json(self.path, self.index)

    def test_stat_disappearance_after_exists_recovers_latest_index(self):
        real_stat = Path.stat
        remaining = [1]
        def transient_stat(path, *args, **kwargs):
            # is_symlink uses lstat; reproduce the failing follow-symlink stat.
            if path == self.path and kwargs.get('follow_symlinks', True) and remaining[0]:
                remaining[0] -= 1
                raise FileNotFoundError('fixture replace visibility gap')
            return real_stat(path, *args, **kwargs)
        self.assertTrue(self.path.exists())
        with patch.object(Path, 'stat', transient_stat), patch.object(gateway.time, 'sleep') as sleep:
            self.assertEqual(gateway.read_json(self.path), self.index)
        sleep.assert_called_once_with(0.05)

    def test_read_disappearance_after_stat_recovers_exact_unknown_receipt(self):
        unknown = {'actionId': SECOND, 'turnId': TURN, 'status': 'unknown',
                   'result': 'unknown', 'completionConfirmed': False}
        gateway.write_json(self.path, unknown)
        before = self.path.read_bytes()
        real_read = Path.read_text
        remaining = [2]
        def transient_read(path, *args, **kwargs):
            if path == self.path and remaining[0]:
                remaining[0] -= 1
                raise FileNotFoundError('fixture replace visibility gap')
            return real_read(path, *args, **kwargs)
        with patch.object(Path, 'read_text', transient_read), patch.object(gateway.time, 'sleep') as sleep:
            actual = gateway.read_json(self.path)
        self.assertEqual(actual, unknown)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [0.05, 0.1])

    def test_persistent_missing_file_raises_after_bounded_reads(self):
        self.path.unlink()
        with patch.object(gateway.time, 'sleep') as sleep:
            with self.assertRaises(FileNotFoundError):
                gateway.read_json(self.path)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [0.05, 0.1, 0.2])
        self.assertFalse(self.path.exists())

    def test_existing_index_disappearing_during_turn_read_is_not_empty_success(self):
        client = gateway.NumenGateway(self.root, object())
        real_read = Path.read_text
        def missing_read(path, *args, **kwargs):
            if path == self.path:
                raise FileNotFoundError('fixture lost index')
            return real_read(path, *args, **kwargs)
        with patch.object(Path, 'read_text', missing_read), patch.object(gateway.time, 'sleep'):
            with self.assertRaises(FileNotFoundError):
                client.turn_receipts(TURN)

    def test_no_action_turn_keeps_existing_empty_semantics(self):
        client = gateway.NumenGateway(self.root, object())
        with patch.object(gateway.time, 'sleep') as sleep:
            self.assertEqual(client.turn_receipts('turn_0123456789abcdef'), [])
        sleep.assert_not_called()

    def test_invalid_state_is_never_retried_or_defaulted(self):
        variants = [(b'[]', gateway.GatewayError), (b'{', json.JSONDecodeError),
                    (b' ' * 262145, gateway.GatewayError)]
        for raw, error in variants:
            with self.subTest(error=error.__name__, size=len(raw)):
                self.path.write_bytes(raw)
                with patch.object(gateway.time, 'sleep') as sleep:
                    with self.assertRaises(error):
                        gateway.read_json(self.path)
                sleep.assert_not_called()

    def test_symlink_and_permission_denial_are_never_retried(self):
        with patch.object(Path, 'is_symlink', return_value=True), patch.object(gateway.time, 'sleep') as sleep:
            with self.assertRaisesRegex(gateway.GatewayError, 'invalid_state_file'):
                gateway.read_json(self.path)
            sleep.assert_not_called()
        with patch.object(Path, 'read_text', side_effect=PermissionError('fixture denial')), patch.object(gateway.time, 'sleep') as sleep:
            with self.assertRaises(PermissionError):
                gateway.read_json(self.path)
            sleep.assert_not_called()


if __name__ == '__main__':
    unittest.main()
