"""Source state safety checks; all subprocess and RCON calls are mocked."""
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('capture_source', Path(__file__).resolve().parents[1] / 'tools/capture_source.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureSafety(unittest.TestCase):
    def test_stopped_source_receives_no_rcon(self):
        with patch.object(Path, 'exists', return_value=False), patch.object(capture, 'source_state', return_value='stopped'), patch.object(capture, 'rcon') as rcon, patch.object(capture.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)) as run:
            self.assertEqual(capture.main(), 0)
            rcon.assert_not_called()
            self.assertIn('--source-quiesced', run.call_args.args[0])

    def test_running_source_restores_save_after_failure(self):
        with patch.object(Path, 'exists', return_value=False), patch.object(capture, 'source_state', return_value='running'), patch.object(capture, 'rcon', side_effect=['Saving is now disabled', 'Saved the game', 'Saving is now enabled']) as rcon, patch.object(capture.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1)):
            with self.assertRaisesRegex(RuntimeError, 'did not complete'):
                capture.main()
            self.assertEqual([c.args[0] for c in rcon.call_args_list], ['save-off', 'save-all flush', 'save-on'])

    def test_source_start_invalidates_stopped_capture(self):
        with patch.object(Path, 'exists', return_value=False), patch.object(capture, 'source_state', side_effect=['stopped','running']), patch.object(capture, 'rcon') as rcon, patch.object(capture.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)):
            with self.assertRaisesRegex(RuntimeError, 'started during capture'):
                capture.main()
            rcon.assert_not_called()

    def test_unknown_state_fails_closed(self):
        for state in ['{"Status":"restarting","Running":true,"Restarting":true}', '{"Status":"paused","Paused":true,"Running":true}', '{"Status":"dead","Dead":true,"Running":false}', '{}']:
            with patch.object(capture.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=state)):
                with self.assertRaises(RuntimeError):
                    capture.source_state()
