"""Synthetic archive/deployment fixtures; never touch Minecraft or production artifacts."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import deploy_numen_autonomous as deploy


class AutonomousDeployTests(unittest.TestCase):
    def put(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value if isinstance(value, bytes) else (json.dumps(value) + '\n').encode())
        return path

    def archive(self, relative, entries):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, 'w') as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        return path

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.entry = 'com/dwinovo/numen/core/NumenCoreNeoForge.class'
        self.api = 'META-INF/jarjar/numen_api-fixture.jar'
        self.old_entries = {self.entry: b'original-entry-with-restore', self.api: b'original-native-api',
            'com/dwinovo/numen/core/entity/ExistingBodyRestore.class': b'original-restore'}
        self.old_entries.update({f'data/fixture/{i}.json': str(i).encode() for i in range(494)})
        self.new_entries = self.old_entries | {self.entry: b'entry-with-native-pad-refresh',
            'com/dwinovo/numen/core/entity/AutonomousBodyTick.class': b'fixture-policy',
            'com/dwinovo/numen/core/entity/AutonomousBodyTick$AllowedBody.class': b'fixture-identity-record'}
        self.baseline = self.archive('runtime/candidate/baseline-numen.jar', self.old_entries)
        self.candidate = self.archive('runtime/candidate/numen.jar', self.new_entries)
        self.target = self.put('server/mc/mods/' + deploy.FILENAME, self.baseline.read_bytes())
        actuator = self.put('server/mc/mods/numen_act-neoforge-1.21.1-0.1.1.jar', b'fixture-actuator')
        self.manifest = {'capability': 'autonomous_body_tick_v1', 'baselineJarSha256': deploy.sha(self.baseline),
            'sourceCommit': 'isolated-fixture', 'preservedCapabilities': ['existing_body_restore_v1', 'walk_only_v1'],
            'actuatorJarSha256': deploy.sha(actuator),
            'classFamilies': ['com/dwinovo/numen/core/NumenCoreNeoForge', 'com/dwinovo/numen/core/entity/AutonomousBodyTick'],
            'embeddedApiHashes': {self.api: deploy.bytes_sha(self.old_entries[self.api])},
            'configSource': 'config/numen-autonomous-bodies.json',
            'configPath': 'server/mc/config/numen-autonomous-bodies.json'}
        for relative in deploy.SOURCES:
            self.put(relative, b'isolated source fixture')
        self.binding = {'bodyUuid': '00000000-0000-0000-0000-000000000001',
                        'ownerUuid': '00000000-0000-0000-0000-000000000002', 'bodyName': 'Fixture'}
        self.put('server/survival-agent-state/survival/settings.json', self.binding)
        self.put(self.manifest['configSource'], {'schema': 1, 'enabled': True, 'bodies': [self.binding]})
        self.put(deploy.MANIFEST, self.manifest)
        original_hashes = {key: deploy.bytes_sha(value) for key, value in self.old_entries.items()}
        preserved = {key: value for key, value in original_hashes.items() if key != self.entry}
        self.record = {'ok': True, 'capability': self.manifest['capability'],
            'baselineJarSha256': self.manifest['baselineJarSha256'], 'sourceCommit': 'isolated-fixture',
            'preservedCapabilities': self.manifest['preservedCapabilities'],
            'tests': {'ok': True, 'assertions': 34, 'scope': 'synthetic validator fixture'},
            'sourceFiles': {relative: deploy.sha(self.root / relative) for relative in deploy.SOURCES},
            'jar': str(self.candidate), 'baselineJar': str(self.baseline), 'sha256': deploy.sha(self.candidate),
            'originalEntryHashes': original_hashes, 'preservedEntryHashes': preserved, 'preservedEntries': 496,
            'embeddedApiHashes': self.manifest['embeddedApiHashes']}
        self.record_path = self.put('runtime/candidate/build-record.json', self.record)
        self.put(deploy.CACHE + '/' + deploy.FILENAME, b'original-cache')
        self.put(deploy.CACHE + '/baseline-numen.jar', b'old-restore-baseline-retain')
        self.put(deploy.CACHE + '/build-record.json', {'oldRecord': True})
        self.put(deploy.LOCK, {'capability': 'existing_body_restore_v1', 'customField': 'preserve',
            'sha256': deploy.sha(self.target), 'cache_path': deploy.CACHE + '/' + deploy.FILENAME})
        self.extensions = {'files': [{'path': 'server/mc/mods/' + deploy.FILENAME, 'sha256': deploy.sha(self.target)},
            {'path': 'server/mc/mods/GodVoice.jar', 'sha256': 'godvoice-unchanged'},
            {'path': 'server/mc/mods/maid.jar', 'sha256': 'maid-unchanged'}], 'customField': 'preserve'}
        self.put('manifests/server-extensions.lock.json', self.extensions)
        self.put('server/mc/world/playerdata/original.dat', b'unchanged-body-and-inventory')

    def run_deploy(self, **kwargs):
        return deploy.deploy(self.record_path, root=self.root, is_running=lambda: False, **kwargs)

    def production_snapshot(self):
        return {path.relative_to(self.root).as_posix(): path.read_bytes() for folder in ('server', 'vendor', 'manifests')
                for path in (self.root / folder).rglob('*') if path.is_file()}

    def test_read_only_check_and_running_server_gate_leave_everything_unchanged(self):
        before = self.production_snapshot()
        self.assertTrue(self.run_deploy()['ok'])
        self.assertEqual(self.production_snapshot(), before)
        with self.assertRaisesRegex(ValueError, 'stop_exact_project_mc_first'):
            deploy.deploy(self.record_path, apply=True, root=self.root, is_running=lambda: True)
        self.assertEqual(self.production_snapshot(), before)

    def test_success_preserves_old_baseline_other_mods_identity_and_world(self):
        before = self.production_snapshot()
        result = self.run_deploy(apply=True)
        self.assertTrue(result['ok'])
        self.assertEqual(self.target.read_bytes(), self.candidate.read_bytes())
        self.assertEqual((self.root / deploy.CACHE / deploy.FILENAME).read_bytes(), self.candidate.read_bytes())
        self.assertEqual((self.root / deploy.CACHE / 'baseline-autonomous-numen.jar').read_bytes(), self.baseline.read_bytes())
        self.assertEqual((self.root / deploy.CACHE / 'baseline-numen.jar').read_bytes(), b'old-restore-baseline-retain')
        lock = deploy.read(self.root / deploy.LOCK)
        self.assertEqual(lock['capability'], 'existing_body_restore_v1')
        self.assertEqual(lock['customField'], 'preserve')
        self.assertIn('autonomous_body_tick_v1', lock['capabilities'])
        self.assertEqual(lock['source_build'], 'tools/build_numen_autonomous.py')
        current = deploy.read(self.root / 'manifests/server-extensions.lock.json')
        self.assertEqual(current['files'][:-1], self.extensions['files'][1:])
        self.assertEqual(current['customField'], 'preserve')
        for relative in ('server/survival-agent-state/survival/settings.json', 'server/mc/world/playerdata/original.dat'):
            self.assertEqual((self.root / relative).read_bytes(), before[relative])
        self.assertFalse(result['worldChanged']); self.assertFalse(result['bodyCreated'])
        self.assertEqual(result['modelCalls'], 0)
        deploy.verified_record(self.root, self.root / deploy.CACHE / 'build-record.json')
        backup = Path(result['backup'])
        self.assertEqual((backup / 'server/mc/mods' / deploy.FILENAME).read_bytes(), before['server/mc/mods/' + deploy.FILENAME])

    def test_same_name_other_fork_and_source_change_are_rejected_before_writing(self):
        self.target.write_bytes(b'another-numen-fork')
        with self.assertRaisesRegex(ValueError, 'another_fork'):
            self.run_deploy(apply=True)
        self.target.write_bytes(self.baseline.read_bytes())
        self.put('tools/build_numen_autonomous.py', b'changed after build')
        with self.assertRaisesRegex(ValueError, 'build_sources_changed'):
            self.run_deploy(apply=True)
        self.assertEqual(self.target.read_bytes(), self.baseline.read_bytes())

    def test_embedded_api_tamper_with_updated_whole_jar_hash_is_still_rejected(self):
        self.archive('runtime/candidate/numen.jar', self.new_entries | {self.api: b'changed native API'})
        self.record['sha256'] = deploy.sha(self.candidate)
        self.put('runtime/candidate/build-record.json', self.record)
        with self.assertRaisesRegex(ValueError, 'unrelated_entries_changed|native_api_changed'):
            self.run_deploy(apply=True)
        self.assertEqual(self.target.read_bytes(), self.baseline.read_bytes())

    def test_owner_drift_or_existing_different_policy_requires_review(self):
        self.put('server/survival-agent-state/survival/settings.json', self.binding | {'ownerUuid': 'changed'})
        with self.assertRaisesRegex(ValueError, 'autonomous_body_binding_changed'):
            self.run_deploy(apply=True)
        self.put('server/survival-agent-state/survival/settings.json', self.binding)
        self.put(self.manifest['configPath'], {'schema': 1, 'enabled': False, 'bodies': []})
        with self.assertRaisesRegex(ValueError, 'existing_autonomous_policy_differs'):
            self.run_deploy(apply=True)

    def test_service_started_during_backup_aborts_before_any_replacement(self):
        before = self.production_snapshot()
        calls = iter((False, True))
        with self.assertRaisesRegex(ValueError, 'deployment_changed_during_backup'):
            deploy.deploy(self.record_path, apply=True, root=self.root, is_running=lambda: next(calls))
        self.assertEqual(self.production_snapshot(), before)

    def test_failure_after_jar_cache_policy_writes_rolls_back_all_targets(self):
        before = self.production_snapshot()
        original_write = deploy.write
        def fail_at_lock(path, value):
            if path == self.root / deploy.LOCK:
                raise OSError('isolated deployment interruption')
            return original_write(path, value)
        with patch.object(deploy, 'write', side_effect=fail_at_lock):
            with self.assertRaisesRegex(OSError, 'isolated deployment interruption'):
                self.run_deploy(apply=True)
        self.assertEqual(self.production_snapshot(), before)
        self.assertFalse((self.root / self.manifest['configPath']).exists())
        self.assertFalse((self.root / deploy.CACHE / 'baseline-autonomous-numen.jar').exists())


if __name__ == '__main__':
    unittest.main()
