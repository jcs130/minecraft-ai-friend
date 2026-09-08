"""Only STT imports remain; ignored LLM runtime is never read or overwritten."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('local_model_config', ROOT / 'tools/local_model_config.py')
config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config)


class LocalModelConfigTests(unittest.TestCase):
    def test_only_stt_credentials_restore_and_llm_remains_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, target = root / 'source', root / 'target'
            source.mkdir(); target.mkdir()
            (source / 'llm.json').write_text('malformed retired input must never be read', encoding='utf8')
            (target / 'llm.json').write_text('QwenPaw bridge fixture', encoding='utf8')
            (source / 'stt.json').write_text(json.dumps({'asr': {'secret_key': 'stt-fixture', 'model': 'ignored-source'}}), encoding='utf8')
            (target / 'stt.json').write_text(json.dumps({'asr': {'secret_key': '', 'model': 'current-stt'}}), encoding='utf8')
            output = io.StringIO()
            with patch.object(config, 'SOURCE', source), patch.object(config, 'TARGET', target), contextlib.redirect_stdout(output):
                config.main()
            self.assertEqual((target / 'llm.json').read_text(encoding='utf8'), 'QwenPaw bridge fixture')
            self.assertEqual(json.loads((target / 'stt.json').read_text(encoding='utf8')),
                             {'asr': {'secret_key': 'stt-fixture', 'model': 'current-stt'}})
            report = json.loads(output.getvalue())
            self.assertEqual(report['local_model_config_restored'], ['stt.json'])
            self.assertEqual(report['retired'], ['llm.json'])
            self.assertNotIn('stt-fixture', output.getvalue())


if __name__ == '__main__':
    unittest.main()
