import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_adventure_pack', SOURCE / 'build_client_pack.py')
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class ClientPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lock = dict(schemaVersion=1, minecraft='1.21.1', loader='neoforge',
            clientLoaderVersion='21.1.248', deployment='isolated_only', artifacts=[])
        for project in sorted(pack.PROJECTS):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as jar:
                jar.writestr('META-INF/neoforge.mods.toml', 'modLoader="javafml"\n')
                jar.writestr('fixture.txt', project)
            data = buffer.getvalue()
            filename = project + '.jar'
            (self.root / filename).write_bytes(data)
            self.lock['artifacts'].append(dict(project=project, filename=filename,
                url='https://cdn.modrinth.com/data/test/' + filename, bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(), sha512=hashlib.sha512(data).hexdigest()))

    def build(self):
        return pack.build(self.lock, self.root, self.root / 'candidate.mrpack')

    def test_only_reviewed_client_files_enter_pack(self):
        (self.root / 'accounts.json').write_text('PRIVATE', encoding='utf-8')
        (self.root / 'qa.jar').write_bytes(b'not for players')
        result = self.build()
        self.assertEqual(result['artifacts'], 7)
        with zipfile.ZipFile(self.root / 'candidate.mrpack') as archive:
            self.assertEqual(len(archive.namelist()), 2)
            index = json.loads(archive.read('modrinth.index.json'))
            self.assertEqual(len(index['files']), 7)
            self.assertTrue(all(f['env']['server'] == 'unsupported' for f in index['files']))
            self.assertNotIn(b'PRIVATE', b''.join(archive.read(name) for name in archive.namelist()))

    def test_damaged_artifact_leaves_no_candidate(self):
        path = self.root / self.lock['artifacts'][0]['filename']
        data = bytearray(path.read_bytes()); data[-1] ^= 1; path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.build()
        self.assertFalse((self.root / 'candidate.mrpack').exists())

    def test_server_mod_or_qa_artifact_is_not_accepted_as_extra(self):
        self.lock['artifacts'].append(copy.deepcopy(self.lock['artifacts'][0]))
        with self.assertRaisesRegex(ValueError, 'seven'):
            self.build()

    def test_traversal_rejected(self):
        self.lock['artifacts'][0]['filename'] = '../account.jar'
        with self.assertRaisesRegex(ValueError, 'filename'):
            self.build()

    def test_download_credentials_and_foreign_hosts_rejected(self):
        for url in ['https://cdn.modrinth.com/a.jar?token=private', 'https://unreviewed.invalid/a.jar',
                    'http://cdn.modrinth.com/a.jar', 'https://user:password@cdn.modrinth.com/a.jar']:
            with self.subTest(url=url):
                self.lock['artifacts'][0]['url'] = url
                with self.assertRaisesRegex(ValueError, 'official'):
                    self.build()

    def test_existing_archive_is_preserved(self):
        self.build()
        before = (self.root / 'candidate.mrpack').read_bytes()
        with self.assertRaises(FileExistsError):
            self.build()
        self.assertEqual((self.root / 'candidate.mrpack').read_bytes(), before)

    def test_unverified_loader_and_production_claim_rejected(self):
        for key, value in [('clientLoaderVersion', '21.1.265'), ('deployment', 'production'), ('minecraft', '1.20.1')]:
            with self.subTest(key=key):
                lock = copy.deepcopy(self.lock); lock[key] = value
                with self.assertRaises(ValueError):
                    pack.validate_lock(lock)

    def test_pack_is_deterministic_for_same_lock(self):
        first = self.build()
        second = pack.build(self.lock, self.root, self.root / 'second.mrpack')
        self.assertEqual(first['sha256'], second['sha256'])


if __name__ == '__main__':
    unittest.main()
