from pathlib import Path
import hashlib, json, tempfile, unittest, zipfile
from unittest.mock import patch
from prepare_fom_content import prepare

class ContentOverlayTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'downloads'; self.source.mkdir()
        self.jar = self.source / 'example.jar'
        with zipfile.ZipFile(self.jar, 'w') as jar:
            jar.writestr('META-INF/neoforge.mods.toml', '[[mods]]\nmodId="example"\nversion="1.0"\n')
        raw = self.jar.read_bytes()
        self.row = {'file': self.jar.name, 'modIds': ['example'],
                    **{kind: hashlib.new(kind, raw).hexdigest() for kind in ('sha256', 'sha512')}}
        self.lock = self.root / 'lock.json'; self.output = self.root / 'overlay'

    def save(self, rows=None):
        self.lock.write_text(json.dumps({'schemaVersion': 1, 'minecraft': '1.21.1', 'mods': rows or [self.row]}), encoding='utf-8')

    def test_prepares_identical_bytes_without_changing_source(self):
        self.save(); before = self.jar.read_bytes()
        result = prepare(self.source, self.output, self.lock)
        self.assertFalse(result['installedGameChanged'])
        self.assertEqual((self.output / 'mods/example.jar').read_bytes(), before)
        self.assertEqual(self.jar.read_bytes(), before)
        self.assertTrue((self.output / 'content.lock.json').is_file())

    def test_never_overwrites_existing_game_or_overlay(self):
        self.save(); self.output.mkdir(); marker = self.output / 'world.dat'; marker.write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError, 'new overlay'): prepare(self.source, self.output, self.lock)
        self.assertEqual(marker.read_bytes(), b'keep')

    def test_rejects_tampered_bytes_before_creating_output(self):
        self.save(); self.jar.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'official lock'): prepare(self.source, self.output, self.lock)
        self.assertFalse(self.output.exists())

    def test_rejects_unsafe_filenames_and_duplicate_jars(self):
        for name in ('../example.jar', 'other\\example.jar', 'C:example.jar'):
            self.row['file'] = name; self.save()
            with self.assertRaisesRegex(ValueError, 'filename'): prepare(self.source, self.output, self.lock)
            self.assertFalse(self.output.exists())
        self.row['file'] = 'example.jar'; self.save([self.row, self.row])
        with self.assertRaisesRegex(ValueError, 'filename'): prepare(self.source, self.output, self.lock)

    def test_rejects_native_identity_mismatch(self):
        self.row['modIds'] = ['other']; self.save()
        with self.assertRaisesRegex(ValueError, 'identity'): prepare(self.source, self.output, self.lock)
        self.assertFalse(self.output.exists())

    def test_rejects_unsafe_datapack_path_before_creating_output(self):
        self.save(); record = json.loads(self.lock.read_text('utf-8'))
        record['serverDataPackFiles'] = {'../../../AGENTS.md': '0' * 64}
        self.lock.write_text(json.dumps(record), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'data pack file'): prepare(self.source, self.output, self.lock)
        self.assertFalse(self.output.exists())

    def test_windows_checkout_emits_locked_lf_pack_bytes_without_changing_source(self):
        self.save(); pack = self.root / 'pack'; pack.mkdir()
        canonical = b'{\n  "pack": {"pack_format": 48}\n}\n'
        original = canonical.replace(b'\n', b'\r\n')
        (pack / 'pack.mcmeta').write_bytes(original)
        record = json.loads(self.lock.read_text('utf-8'))
        record['serverDataPackFiles'] = {'pack.mcmeta': hashlib.sha256(canonical).hexdigest()}
        self.lock.write_text(json.dumps(record), encoding='utf-8')
        with patch('prepare_fom_content.DATA_PACK', pack): prepare(self.source, self.output, self.lock)
        self.assertEqual((self.output / 'server-only/datapacks/qdfom_content_compat/pack.mcmeta').read_bytes(), canonical)
        self.assertEqual((pack / 'pack.mcmeta').read_bytes(), original)

if __name__ == '__main__': unittest.main()
