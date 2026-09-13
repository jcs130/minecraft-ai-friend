import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch


class RetiredMaidModelProbeTests(unittest.TestCase):
    def test_reports_retirement_without_credentials_network_or_inference(self):
        path = Path(__file__).resolve().parents[1] / 'tools/smoke_maid_model.py'
        spec = importlib.util.spec_from_file_location('retired_maid_model_probe', path)
        probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(probe)
        output = io.StringIO()
        with contextlib.redirect_stdout(output), \
                patch.object(Path, 'read_text', side_effect=AssertionError('must not read provider credentials')), \
                patch('urllib.request.urlopen', side_effect=AssertionError('must not call a model')):
            self.assertEqual(probe.main(), 2)
        report = json.loads(output.getvalue())
        self.assertIs(report['ok'], False)
        self.assertEqual(report['code'], 'direct_provider_probe_retired')
        self.assertEqual(report['submittedModelRequests'], 0)
        self.assertIn('QwenPaw', report['message'])


if __name__ == '__main__':
    unittest.main()
