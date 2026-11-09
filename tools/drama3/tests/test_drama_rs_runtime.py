"""Deployment selection tests use temporary assets and no production ports."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import drama_rs_runtime as runtime


class RuntimeConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.model = self.root / 'model'
        self.model.mkdir()
        self.binary = self.root / 'drama'
        self.binary.write_bytes(b'fixture binary')
        (self.model / 'drama.json').write_text('{"format":"drama-rs-v1"}')
        self.manifest = {'source_revision': 'a'*40, 'converter_revision': 'b'*40,
                         'format': 'drama-rs-v1', 'files': []}
        for name in ['globals.safetensors', 'tower.safetensors', 'codec.safetensors', 'tokenizer.json'] + [f'layer{i:02}.safetensors' for i in range(40)]:
            (self.model / name).write_bytes(b'fixture')
            self.manifest['files'].append({'name': name, 'bytes': 7, 'sha256': 'c'*64})
        self.manifest_path = self.model / 'asset-manifest.json'
        self.manifest_path.write_text(json.dumps(self.manifest))
        self.config = {'schema_version': 1, 'engine_version': '0.3.0',
                       'binary': str(self.binary), 'model': str(self.model),
                       'binary_sha256': hashlib.sha256(self.binary.read_bytes()).hexdigest(),
                       'manifest_sha256': hashlib.sha256(self.manifest_path.read_bytes()).hexdigest()}
        self.path = self.root / 'runtime.json'

    def tearDown(self):
        self.temp.cleanup()

    def write_config(self):
        self.path.write_text(json.dumps(self.config))

    def test_missing_selection_keeps_legacy_defaults(self):
        self.assertIsNone(runtime.load_runtime(self.path))

    def test_pinned_selection_exposes_sources_without_private_paths(self):
        self.write_config()
        result = runtime.load_runtime(self.path)
        self.assertEqual(result['identity']['source_revision'], 'a'*40)
        self.assertEqual(result['identity']['converter_revision'], 'b'*40)
        self.assertEqual(result['model'], str(self.model))
        self.assertNotIn(str(self.root), json.dumps(result['identity']))

    def test_changed_binary_or_manifest_is_rejected(self):
        self.write_config()
        self.binary.write_bytes(b'changed binary')
        with self.assertRaisesRegex(ValueError, 'binary'):
            runtime.load_runtime(self.path)
        self.binary.write_bytes(b'fixture binary')
        self.manifest_path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'manifest'):
            runtime.load_runtime(self.path)

    def test_incomplete_model_and_unknown_config_are_rejected(self):
        self.write_config()
        (self.model / 'layer39.safetensors').unlink()
        with self.assertRaisesRegex(ValueError, 'layer39'):
            runtime.load_runtime(self.path)
        self.config['shell_command'] = 'untrusted'
        self.write_config()
        with self.assertRaisesRegex(ValueError, 'config'):
            runtime.load_runtime(self.path)


if __name__ == '__main__':
    unittest.main()
