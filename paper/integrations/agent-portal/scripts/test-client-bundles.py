"""Small packaging regressions; real public-archive installs are tested separately."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('bundles', Path(__file__).with_name('build-client-bundles.py'))
bundles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundles)


class BundleTests(unittest.TestCase):
    def test_archive_members_cannot_escape_or_use_windows_paths(self):
        for name in ['../secrets', '/absolute', 'C:/absolute', 'a\\b', 'a//b', 'a/./b', 'a/../b', 'a\x00b']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                bundles.safe_relative(name)
        self.assertEqual(bundles.safe_relative('runtime/resources/file.ogg'), 'runtime/resources/file.ogg')

    def test_original_release_requires_exact_public_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            name, digest = bundles.ORIGINALS['cortico']
            (root / name).write_bytes(b'not-the-published-package')
            with self.assertRaisesRegex(ValueError, 'hash differs'):
                bundles.checked_original(root, 'cortico')
            self.assertEqual(len(digest), 64)

    def test_split_is_lossless_and_shared_audio_covers_each_sdk(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            source = root / 'source.zip'
            audio = b'fixture-original-audio'
            sound = 'runtime/resources/vanilla-1.21.1/public/sounds/entity/test.ogg'
            exe = 'runtime/browser/chrome-headless-shell-win64/chrome-headless-shell.exe'
            files = {sound: audio, exe: b'fixture-browser', 'runtime/browser/LICENSE': b'fixture-license',
                     'runtime/licenses/THIRD-PARTY-NOTICES.txt': b'fixture-notices', 'runtime/runtime-manifest.json': b'original-manifest',
                     'runtime/viewer/modern-viewer/index.html': b'original-viewer', 'plugin.neko-plugin': b'original-plugin'}
            with zipfile.ZipFile(source, 'w') as z:
                for name, data in files.items():
                    z.writestr(name, data)
            skill = root / 'skill.zip'
            skill.write_bytes(b'fixture-skill')
            output = root / 'out'
            output.mkdir()
            item = {'sha1': hashlib.sha1(audio).hexdigest(), 'sha256': hashlib.sha256(audio).hexdigest(), 'bytes': len(audio)}
            with patch.object(bundles, 'checked_original', return_value=source), patch.object(bundles.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
                rows = bundles.split_resources(root, output, skill, [{'files': [item]}, {'files': [item]}])
            combined = {}
            for row in rows:
                with zipfile.ZipFile(output / row['filename']) as z:
                    for entry in z.infolist():
                        self.assertNotIn(entry.filename, combined)
                        combined[entry.filename] = z.read(entry.filename)
                self.assertEqual(bundles.sha(output / row['filename']), row['sha256'])
            for name, data in files.items():
                self.assertEqual(combined[name], data)
            metadata = json.loads(combined['shared-audio.json'])
            self.assertEqual(len(metadata['objects']), 1)
            self.assertEqual(metadata['objects'][item['sha1']]['file'], sound)
            self.assertIn('qiandengji/skill.zip', combined)
            self.assertIn('准备千灯纪离线包.cmd', combined)
            self.assertNotIn('runtime/shared-audio.json', combined)


if __name__ == '__main__':
    unittest.main()
