"""Stopped-server deployment, fork preservation and source evidence regressions."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deploy_numen_restore', ROOT/'tools/deploy_numen_body_restore.py')
deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.baseline = self.root/'runtime/build/baseline-numen.jar'; self.baseline.parent.mkdir(parents=True)
        self.jar = self.baseline.with_name('candidate.jar')
        self.entries = {f'preserved/{index}.txt': str(index).encode() for index in range(495)}
        entry = 'com/dwinovo/numen/core/NumenCoreNeoForge.class'
        native = 'com/dwinovo/numen/core/entity/ExistingBodyRestore.class'
        for path, entries in ((self.baseline, self.entries | {entry:b'old'}),
                              (self.jar, self.entries | {entry:b'new', native:b'restore'})):
            with zipfile.ZipFile(path, 'w') as archive:
                for name, data in entries.items(): archive.writestr(name, data)
        self.target = self.root/'server/mc/mods'/deploy.FILENAME
        self.target.parent.mkdir(parents=True); self.target.write_bytes(self.baseline.read_bytes())
        actuator = self.target.with_name('numen_act-neoforge-1.21.1-0.1.1.jar'); actuator.write_bytes(b'actuator')
        manifest = {'capability':'existing_body_restore_v1', 'baselineJarSha256':deploy.sha(self.baseline),
            'actuatorJarSha256':deploy.sha(actuator), 'sourceCommit':'fixture',
            'classFamilies':[entry[:-6], native[:-6]]}
        deploy.write(self.root/deploy.MANIFEST, manifest)
        sources = ['tools/build_numen_body_restore.py', 'tools/build_numen_walk_only.py',
            'world/botgate-src/build.py',
            'world/numen-patches/restore-src/com/dwinovo/numen/core/entity/ExistingBodyRestore.java',
            'world/numen-patches/tests/ExistingBodyRestoreTest.java']
        for relative in sources:
            path = self.root/relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(relative)
        self.record = {'ok':True, 'capability':manifest['capability'], 'sourceCommit':'fixture',
            'baselineJarSha256':manifest['baselineJarSha256'], 'baselineJar':str(self.baseline),
            'jar':str(self.jar), 'sha256':deploy.sha(self.jar), 'tests':{'ok':True,'assertions':26},
            'preservedEntries':495, 'preservedEntryHashes':{n:hashlib.sha256(d).hexdigest() for n,d in self.entries.items()},
            'sourceFiles':{n:deploy.sha(self.root/n) for n in sources+[deploy.MANIFEST]}}
        self.record_path = self.baseline.with_name('build-record.json'); deploy.write(self.record_path, self.record)
        deploy.write(self.root/'manifests/server-extensions.lock.json', {'files':[{'path':'unchanged','sha256':'keep'}]})

    def run_deploy(self, apply=False, running=lambda:False):
        return deploy.deploy(self.record_path, apply, self.root, running)

    def test_preview_verifies_without_installing_or_creating_backup(self):
        result = self.run_deploy()
        self.assertTrue(result['ok']); self.assertEqual(deploy.sha(self.target), deploy.sha(self.baseline))
        self.assertFalse((self.root/'runtime/numen-restore-backups').exists())

    def test_running_server_refuses_before_creating_backup(self):
        with self.assertRaisesRegex(ValueError, 'stop_exact_project_mc_first'): self.run_deploy(True, lambda:True)
        self.assertEqual(deploy.sha(self.target), deploy.sha(self.baseline))
        self.assertFalse((self.root/'runtime/numen-restore-backups').exists())

    def test_restarted_server_during_backup_refuses_before_replacement(self):
        states = iter([False, True])
        with self.assertRaisesRegex(ValueError, 'mc_started_during_backup'): self.run_deploy(True, lambda:next(states))
        self.assertEqual(deploy.sha(self.target), deploy.sha(self.baseline))

    def test_apply_backs_up_exact_fork_and_updates_only_server_lock(self):
        result = self.run_deploy(True)
        saved = Path(result['backup'])/'server/mc/mods'/deploy.FILENAME
        self.assertEqual(deploy.sha(saved), deploy.sha(self.baseline))
        self.assertEqual(deploy.sha(self.target), deploy.sha(self.jar))
        self.assertFalse((self.root/'client').exists())
        rows = deploy.read(self.root/'manifests/server-extensions.lock.json')['files']
        self.assertEqual(rows[0], {'path':'unchanged','sha256':'keep'})
        self.assertFalse(rows[1]['client_required'])
        deploy.verified_record(self.root, self.root/deploy.CACHE/'build-record.json')

    def test_wrong_installed_fork_is_never_overwritten(self):
        self.target.write_bytes(b'other-fork')
        with self.assertRaisesRegex(ValueError, 'installed_numen_is_another_fork'): self.run_deploy(True)
        self.assertEqual(self.target.read_bytes(), b'other-fork')

    def test_changed_test_source_invalidates_build_evidence(self):
        (self.root/'world/numen-patches/tests/ExistingBodyRestoreTest.java').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'source_changed_after_build'): self.run_deploy()

    def test_changed_unrelated_entry_rejected_even_if_jar_hash_updated(self):
        with zipfile.ZipFile(self.jar) as old:
            values = {n:old.read(n) for n in old.namelist()}
        values['preserved/1.txt'] = b'changed'
        with zipfile.ZipFile(self.jar, 'w') as archive:
            for name, data in values.items(): archive.writestr(name, data)
        self.record['sha256'] = deploy.sha(self.jar); deploy.write(self.record_path, self.record)
        with self.assertRaisesRegex(ValueError, 'unrelated_entries_changed'): self.run_deploy()

    def test_existing_client_copy_requires_explicit_review(self):
        client = self.root/'client/mods'/deploy.FILENAME; client.parent.mkdir(parents=True); client.write_bytes(b'client')
        with self.assertRaisesRegex(ValueError, 'unexpected_client_numen'): self.run_deploy(True)


if __name__ == '__main__': unittest.main()
