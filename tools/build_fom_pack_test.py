"""Packaging regressions: preserve the tested pack, reject unsafe/changed inputs."""
import copy
import hashlib
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

from build_fom_pack import build, hashes, json_bytes, RECEIPT, verify, write_zip


class FomPackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / 'author.mrpack'
        self.downloads = self.root / 'downloads'
        self.agent = self.root / 'agent'
        self.cache = self.root / 'cache'
        for folder in (self.downloads, self.agent, self.cache):
            folder.mkdir()
        self.output = self.root / 'combined.mrpack'
        self.lock = self.root / 'pack.json'
        self.content_lock = self.root / 'content.json'
        self.original = b'base JAR fixture'
        self.index = {'formatVersion': 1, 'game': 'minecraft', 'versionId': '2.42', 'name': 'Author FOM',
                      'dependencies': {'minecraft': '1.21.1', 'neoforge': '21.1.248'},
                      'files': [self.row('mods/original.jar', self.original), self.row('mods/disabled.jar.disabled', b'disabled')]}
        self.base_entries = {'overrides/config/author.toml': b'keep-author-defaults = true\r\n',
                             'overrides/options.txt': b'lang:zh_cn',
                             'overrides/mods/author-extra.jar': b'original override JAR'}
        addition = b'content JAR fixture'
        (self.downloads / 'addition.jar').write_bytes(addition)
        self.content = {'schemaVersion': 1, 'minecraft': '1.21.1', 'testedNeoForge': '21.1.248',
                        'mods': [{'file': 'addition.jar', **hashes(addition), 'url': 'https://cdn.modrinth.com/addition.jar'}]}
        self.pack = {'schemaVersion': 1, 'name': 'Derived FOM', 'summary': 'Content extension',
                     'dependencies': self.index['dependencies'], 'upstream': {'version': '2.42', 'downloadReferences': 2, 'enabledJars': 2},
                     'profiles': {'player': {'versionId': 'derived-player', 'counts': {'enabledJars': 3, 'authorDisabled': 1}},
                                  'agent': {'versionId': 'derived-agent', 'counts': {'enabledJars': 6, 'authorDisabled': 1}}},
                     'agentMods': []}
        for name, url in (('bridge.jar', None), ('script.jar', 'https://cdn.modrinth.com/script.jar'),
                          ('navigator.jar', 'https://github.com/author/project/releases/download/v1/navigator.jar')):
            raw = name.encode()
            (self.agent / name).write_bytes(raw)
            row = {'file': name, **hashes(raw)}
            if url:
                row['url'] = url
            self.pack['agentMods'].append(row)
        self.save()

    @staticmethod
    def row(path, raw):
        return {'path': path, 'hashes': hashes(raw), 'downloads': ['https://cdn.modrinth.com/data/' + path],
                'fileSize': len(raw), 'env': {'client': 'required', 'server': 'required'}}

    def save(self):
        if self.base.exists():
            self.base.unlink()
        write_zip(self.base, {'modrinth.index.json': json_bytes(self.index), **self.base_entries})
        self.pack['upstream'].update(hashes(self.base.read_bytes()))
        self.lock.write_bytes(json_bytes(self.pack))
        self.content_lock.write_bytes(json_bytes(self.content))

    def build(self, **kwargs):
        return build(self.base, self.downloads, self.output, lock=self.lock, content_lock=self.content_lock, **kwargs)

    def test_player_keeps_every_original_reference_and_clean_override(self):
        result = self.build()
        self.assertEqual((result['enabledJars'], result['authorDisabled']), (3, 1))
        self.assertFalse(result['installedGameChanged'])
        with zipfile.ZipFile(self.output) as archive:
            index = json.loads(archive.read('modrinth.index.json'))
            self.assertEqual(index['files'][:2], self.index['files'])
            self.assertEqual(index['dependencies'], self.index['dependencies'])
            for name, raw in self.base_entries.items():
                self.assertEqual(archive.read(name), raw)
            self.assertEqual(index['files'][2]['env'], {'client': 'required', 'server': 'required'})
            self.assertNotIn('client-overrides/mods/bridge.jar', archive.namelist())

    def test_agent_adds_only_client_components_and_new_bridge_state_is_absent(self):
        (self.agent / 'connection.json').write_text('private-token-do-not-export')
        (self.agent / 'world.dat').write_bytes(b'private-world')
        result = self.build(profile='agent', agent_bundle=self.agent)
        self.assertEqual(result['enabledJars'], 6)
        with zipfile.ZipFile(self.output) as archive:
            index = json.loads(archive.read('modrinth.index.json'))
            self.assertEqual(archive.read('client-overrides/mods/bridge.jar'), b'bridge.jar')
            self.assertTrue(all(row['env']['server'] == 'unsupported' for row in index['files'][-2:]))
            self.assertFalse(any('connection.json' in name or 'world.dat' in name for name in archive.namelist()))
            self.assertNotIn(b'private-token-do-not-export', self.output.read_bytes())

    def test_reproducible_bytes_independent_of_output_name(self):
        self.build()
        second = self.root / 'another-name.mrpack'
        build(self.base, self.downloads, second, lock=self.lock, content_lock=self.content_lock)
        self.assertEqual(self.output.read_bytes(), second.read_bytes())

    def test_unchanged_loader_preserves_author_dependency_key_order(self):
        self.index['dependencies']=dict(reversed(list(self.index['dependencies'].items())))
        self.save();self.build()
        with zipfile.ZipFile(self.output) as archive:
            index=json.loads(archive.read('modrinth.index.json'))
            self.assertEqual(list(index['dependencies']),list(self.index['dependencies']))

    def test_existing_game_or_release_is_never_overwritten(self):
        self.output.write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError, 'new output'):
            self.build()
        self.assertEqual(self.output.read_bytes(), b'keep')

    def test_tampered_upstream_rejected_before_any_output(self):
        self.base.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_tampered_content_rejected_before_any_output(self):
        (self.downloads / 'addition.jar').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_agent_requires_exact_explicit_bundle(self):
        with self.assertRaisesRegex(ValueError, 'explicit locked'):
            self.build(profile='agent')
        (self.agent / 'bridge.jar').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.build(profile='agent', agent_bundle=self.agent)
        self.assertFalse(self.output.exists())

    def test_rejects_archive_path_escape_and_private_state(self):
        for name in ('overrides/../escaped', 'overrides/saves/world.dat', 'overrides/config/connection.json',
                     'overrides/config/../../private.txt', 'C:/private', 'overrides\\config\\file'):
            with self.subTest(name=name):
                self.base_entries[name] = b'bad'
                self.save()
                if '\\' in name:
                    # ZipInfo normalizes backslashes on Windows; emulate a
                    # foreign archive with the original unsafe header names.
                    raw = self.base.read_bytes().replace(name.replace('\\', '/').encode(), name.encode())
                    self.base.write_bytes(raw)
                    self.pack['upstream'].update(hashes(raw))
                    self.lock.write_bytes(json_bytes(self.pack))
                with self.assertRaises(ValueError):
                    self.build()
                del self.base_entries[name]
                self.assertFalse(self.output.exists())

    def test_rejects_case_collisions_in_index_and_overrides(self):
        self.base_entries['overrides/mods/ORIGINAL.jar'] = b'conflict'
        self.save()
        with self.assertRaisesRegex(ValueError, 'Conflicting game path'):
            self.build()

    def test_rejects_duplicate_zip_members_and_symlinks(self):
        with zipfile.ZipFile(self.base, 'a') as archive:
            archive.writestr('overrides/config/AUTHOR.toml', b'duplicate')
        self.pack['upstream'].update(hashes(self.base.read_bytes()))
        self.lock.write_bytes(json_bytes(self.pack))
        with self.assertRaisesRegex(ValueError, 'Duplicate or linked'):
            self.build()
        self.save()
        with zipfile.ZipFile(self.base, 'a') as archive:
            info = zipfile.ZipInfo('overrides/config/link')
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, b'../private')
        self.pack['upstream'].update(hashes(self.base.read_bytes()))
        self.lock.write_bytes(json_bytes(self.pack))
        with self.assertRaisesRegex(ValueError, 'Duplicate or linked'):
            self.build()

    def test_rejects_unsafe_or_duplicate_index_download(self):
        for path in ('../outside.jar', '/mods/outside.jar', 'mods\\outside.jar', 'mods/original.jar'):
            with self.subTest(path=path):
                self.index['files'][1]['path'] = path
                self.save()
                with self.assertRaises(ValueError):
                    self.build()

    def test_rejects_mismatched_target(self):
        self.content['testedNeoForge'] = 'different-loader'
        self.save()
        with self.assertRaisesRegex(ValueError, 'targets differ'):
            self.build()

    def test_reviewed_loader_patch_preserves_upstream_and_targets_derivative(self):
        self.pack['upstreamDependencies']=copy.deepcopy(self.index['dependencies'])
        self.pack['dependencies']={'minecraft':'1.21.1','neoforge':'21.1.250'}
        self.content['testedNeoForge']='21.1.250'
        self.save();self.build()
        with zipfile.ZipFile(self.output) as archive:
            index=json.loads(archive.read('modrinth.index.json'))
            self.assertEqual(index['dependencies']['neoforge'],'21.1.250')
            self.assertEqual(index['files'][:2],self.index['files'])
        self.assertTrue(verify(self.output)['ok'])

    def test_pinned_redistributable_mod_and_notices_can_be_bundled_without_new_download_hosts(self):
        self.content['mods'][0]['distribution']='override'
        self.content['mods'][0]['url']='https://mediafilez.forgecdn.net/files/example.jar'
        notice=b'GPL license and public source notice';(self.downloads/'LICENSE.txt').write_bytes(notice)
        self.content['bundledNotices']=[{'file':'LICENSE.txt',**hashes(notice)}]
        self.save();self.build()
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.read('overrides/mods/addition.jar'),b'content JAR fixture')
            self.assertEqual(archive.read('client-overrides/FOM-QiandengJi/LICENSE.txt'),notice)
            self.assertEqual(len(json.loads(archive.read('modrinth.index.json'))['files']),2)
        self.assertTrue(verify(self.output)['ok'])

    def test_download_domain_allowlist_cannot_be_bypassed(self):
        for url in ('https://mediafilez.forgecdn.net/a.jar','https://cdn.modrinth.com.evil.test/a.jar','http://cdn.modrinth.com/a.jar','https://key@cdn.modrinth.com/a.jar','https://cdn.modrinth.com:444/a.jar'):
            with self.subTest(url=url):
                self.content['mods'][0]['url']=url;self.save()
                with self.assertRaisesRegex(ValueError,'Unsupported download URL'):self.build()

    def test_bundled_mod_never_overwrites_author_override(self):
        row=self.content['mods'][0];row.update(file='author-extra.jar',distribution='override')
        (self.downloads/row['file']).write_bytes(b'content JAR fixture');self.save()
        with self.assertRaisesRegex(ValueError,'Conflicting game path'):self.build()

    def test_instructions_cannot_escape_docs(self):
        self.pack['instructions']='../private.txt';self.save()
        with self.assertRaisesRegex(ValueError,'Unsafe relative path'):self.build()

    def test_rejects_missing_hash_http_url_and_wrong_side(self):
        original = copy.deepcopy(self.index['files'][0])
        for update in ({'hashes': {'sha1': '0' * 40}}, {'downloads': ['http://example.com/file.jar']},
                       {'downloads': ['https://cdn.modrinth.com/a b.jar']}, {'env': {'client': 'enabled'}}):
            with self.subTest(update=update):
                self.index['files'][0] = {**original, **update}
                self.save()
                with self.assertRaises(ValueError):
                    self.build()

    def test_verifier_detects_member_change_even_when_zip_crc_is_valid(self):
        self.build()
        with zipfile.ZipFile(self.output) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        entries['overrides/config/author.toml'] = b'changed'
        changed = self.root / 'changed.mrpack'
        write_zip(changed, entries)
        with self.assertRaisesRegex(ValueError, 'differs from build receipt'):
            verify(changed)

    def test_verifier_checks_actual_cached_download_bytes_not_command_success(self):
        self.build()
        for name, raw in (('mods/original.jar', self.original), ('mods/disabled.jar.disabled', b'disabled'),
                          ('mods/addition.jar', b'content JAR fixture')):
            path = self.cache / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(raw)
        self.assertEqual(verify(self.output, self.cache)['cachedDownloadsVerified'], 3)
        (self.cache / 'mods/original.jar').write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'differs from installer'):
            verify(self.output, self.cache)
        (self.cache / 'mods/original.jar').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing or linked cached'):
            verify(self.output, self.cache)


if __name__ == '__main__':
    unittest.main()
