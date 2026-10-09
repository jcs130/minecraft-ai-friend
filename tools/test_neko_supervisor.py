import subprocess
import unittest
from unittest.mock import Mock, call
from tools.start_neko_trial import stop_owned_process


class NekoSupervisorTest(unittest.TestCase):
    def test_graceful_watchdog_stop_is_not_reported_as_force_termination(self):
        process = Mock()
        process.wait.return_value = 0
        self.assertFalse(stop_owned_process(process))
        process.terminate.assert_not_called()
        process.wait.assert_called_once_with(timeout=15)

    def test_only_owned_process_exceeding_grace_is_force_terminated(self):
        process = Mock()
        process.wait.side_effect = [subprocess.TimeoutExpired('owned-test', 15), 1]
        self.assertTrue(stop_owned_process(process))
        process.terminate.assert_called_once_with()
        self.assertEqual(process.wait.call_args_list, [call(timeout=15), call(timeout=10)])


if __name__ == '__main__':
    unittest.main()
