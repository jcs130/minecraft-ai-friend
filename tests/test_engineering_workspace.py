from copy import deepcopy
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from engineering_workspace import EngineeringWorkspace, canonical, digest, write
from native_role_capabilities import configure_native


@unittest.skipUnless(shutil.which('git'), 'Git fixture required')
class EngineeringTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.repo = self.root / 'repo'; self.repo.mkdir()
        self.git('init', '-q'); self.git('config', 'user.name', 'fixture'); self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'core.autocrlf', 'false')
        self.source = self.repo / 'world/feature.py'; self.source.parent.mkdir()
        self.source.write_text('VALUE = 1\n', newline='\n')
        self.check = self.repo / 'tests/test_feature.py'; self.check.parent.mkdir()
        self.check.write_text('import unittest\nclass Tests(unittest.TestCase):\n def test_value(self): self.assertEqual(2, 2)\n', newline='\n')
        self.git('add', '.'); self.git('commit', '-qm', 'base')
        self.base = self.git('rev-parse', 'HEAD').strip(); self.git('switch', '-qc', 'codex/ops-fixture')
        self.config = {'schema': 1, 'enabled': True, 'role': 'mc-god', 'repo': str(self.repo),
                       'baseCommit': self.base, 'branch': 'codex/ops-fixture', 'snapshotHostRoot': '/fixture/snapshots',
                       'plans': [{'id': 'python-fixed', 'image': 'sha256:' + '1' * 64,
                                  'argv': ['python', '-m', 'unittest', 'discover', '-s', 'tests'],
                                  'coverage': ['world/', 'tests/'],
                                  'checks': {'tests/test_feature.py': digest(self.check.read_bytes())}, 'timeoutSeconds': 30}]}
        self.area = self.root / 'engineering'; self.area.mkdir()
        write(self.area / 'config.json', self.config)
        self.service = EngineeringWorkspace(self.area / 'config.json', self.area)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL).decode()

    def modify(self):
        self.source.write_text('VALUE = 2\n', newline='\n')
        return self.service.status()['sourceSha256']

    def receipt(self, request='request-0001', status='passed'):
        sha = self.service.status()['sourceSha256']
        self.service.test('python-fixed', sha, request)
        row = json.loads((self.area / 'requests' / (request + '.json')).read_text())
        row.update(status=status, exitCode=0, imageId=self.config['plans'][0]['image'])
        write(self.area / 'receipts' / (request + '.json'), row)
        return sha

    @contextmanager
    def all_source_files_appear_executable(self):
        """Emulate Docker Desktop's 0755 source view, including on Windows."""
        original = Path.stat
        repo = self.repo
        def mounted_stat(path, *args, **kwargs):
            value = original(path, *args, **kwargs)
            if path.is_relative_to(repo) and '.git' not in path.relative_to(repo).parts and stat.S_ISREG(value.st_mode):
                fields = list(value)
                fields[0] = (value.st_mode & ~0o777) | 0o755
                return os.stat_result(fields)
            return value
        with patch.object(Path, 'stat', mounted_stat):
            yield

    def test_mount_execute_bits_do_not_change_snapshot_or_dirty_state(self):
        before = self.service.status()
        with self.all_source_files_appear_executable():
            after = self.service.status()
            self.assertEqual(after['sourceSha256'], before['sourceSha256'])
            self.assertFalse(after['dirty'])
            self.assertEqual(after['workingChanges'], [])
            self.assertEqual(after['changed'], [])

    def test_mounted_commit_preserves_tracked_executable_and_new_source_is_regular(self):
        executable = self.repo / 'world/existing.sh'
        executable.write_text('#!/bin/sh\nexit 0\n', newline='\n')
        self.git('add', 'world/existing.sh')
        self.git('update-index', '--chmod=+x', 'world/existing.sh')
        self.git('commit', '-qm', 'existing executable')
        old_head = self.git('rev-parse', 'HEAD').strip()
        self.config['baseCommit'] = old_head
        write(self.area / 'config.json', self.config)
        self.modify()
        (self.repo / 'world/new.py').write_text('NEW = 1\n', newline='\n')
        with self.all_source_files_appear_executable():
            snapshot, _ = self.service.snapshot()
            self.assertEqual(snapshot['workingChanges'], ['world/feature.py', 'world/new.py'])
            modes = {e['path']: e['mode'] for e in snapshot['entries']}
            self.assertEqual(modes, {'tests/test_feature.py': '100644',
                'world/existing.sh': '100755', 'world/feature.py': '100644', 'world/new.py': '100644'})
            sha = self.receipt()
            self.service.commit('only source changes', sha, 'request-0001', 'commit-0001')
            self.assertFalse(self.service.status()['dirty'])
        actual = {row.split('\t')[1]: row.split(' ')[0] for row in self.git('ls-tree', '-r', 'HEAD').splitlines()}
        self.assertEqual(actual, modes)
        self.assertEqual(self.git('diff', '--name-only', old_head, 'HEAD').splitlines(),
                         ['world/feature.py', 'world/new.py'])
        self.assertNotIn('mode change', self.git('diff', '--summary', old_head, 'HEAD'))

    def test_staged_chmod_cannot_override_managed_head_mode(self):
        self.git('update-index', '--chmod=+x', 'world/feature.py')
        snapshot, _ = self.service.snapshot()
        self.assertEqual(next(e['mode'] for e in snapshot['entries'] if e['path'] == 'world/feature.py'), '100644')
        self.assertEqual(snapshot['workingChanges'], [])

    def test_deleted_tracked_source_remains_an_actual_change(self):
        self.source.unlink()
        snapshot, _ = self.service.snapshot()
        self.assertEqual(snapshot['changed'], ['world/feature.py'])
        self.assertEqual(snapshot['workingChanges'], ['world/feature.py'])
        sha = self.receipt()
        self.service.commit('remove obsolete fixture', sha, 'request-0001', 'commit-0001')
        self.assertNotIn('world/feature.py', self.git('ls-tree', '-r', '--name-only', 'HEAD'))

    def test_special_git_index_modes_are_rejected_even_without_disk_links(self):
        blob = self.service.git('hash-object', '-w', '--stdin', input=b'outside').decode().strip()
        for mode, oid in (('120000', blob), ('160000', self.base)):
            with self.subTest(mode=mode):
                self.git('update-index', '--add', '--cacheinfo', mode + ',' + oid + ',world/special')
                with self.assertRaisesRegex(ValueError, 'index_mode_not_regular'):
                    self.service.snapshot()
                self.git('read-tree', 'HEAD')

    def test_special_head_modes_are_rejected_instead_of_becoming_regular_files(self):
        blob = self.service.git('hash-object', '-w', '--stdin', input=b'outside').decode().strip()
        self.git('update-index', '--add', '--cacheinfo', '120000,' + blob + ',world/link')
        self.git('commit', '-qm', 'external symlink change')
        with self.assertRaisesRegex(ValueError, 'source_mode_not_regular'):
            self.service.snapshot()

    def test_real_local_commit_binds_fixed_test_source_without_push(self):
        self.modify(); sha = self.receipt()
        result = self.service.commit('fix fixture', sha, 'request-0001', 'commit-0001')
        self.assertTrue(result['ok']); self.assertFalse(result['pushed'])
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), result['commit'])
        self.assertEqual(self.git('show', 'HEAD:world/feature.py'), 'VALUE = 2\n')
        self.assertEqual(self.git('rev-parse', 'HEAD^').strip(), self.base)
        self.assertEqual(self.service.commit('fix fixture', sha, 'request-0001', 'commit-0001'), result)

    def test_snapshot_is_immutable_and_request_is_idempotent(self):
        sha = self.modify(); self.service.test('python-fixed', sha, 'request-0001')
        self.source.write_text('VALUE = 3\n')
        self.assertEqual((self.area / 'snapshots' / sha / 'source/world/feature.py').read_text(), 'VALUE = 2\n')
        with self.assertRaisesRegex(ValueError, 'source_changed'): self.service.test('python-fixed', sha, 'request-0001')

    def test_edited_fixed_checks_and_uncovered_changes_cannot_buy_a_pass(self):
        self.check.write_text('raise SystemExit(0)\n')
        with self.assertRaisesRegex(ValueError, 'fixed_checks_changed'):
            self.service.test('python-fixed', self.service.status()['sourceSha256'], 'request-0001')
        self.check.write_bytes(self.git('show', 'HEAD:tests/test_feature.py').encode())
        (self.repo / 'production.yml').write_text('changed\n')
        with self.assertRaisesRegex(ValueError, 'not_covered'):
            self.service.test('python-fixed', self.service.status()['sourceSha256'], 'request-0002')

    def test_failed_or_changed_source_cannot_commit(self):
        self.modify(); sha = self.receipt(status='failed')
        with self.assertRaisesRegex(ValueError, 'passed_fixed_checks'): self.service.commit('fix', sha, 'request-0001', 'commit-0001')
        self.source.write_text('VALUE = 3\n')
        with self.assertRaisesRegex(ValueError, 'source_changed'): self.service.commit('fix', sha, 'request-0001', 'commit-0001')

    def test_unknown_commit_is_reported_without_repeating_git(self):
        self.modify(); sha = self.receipt()
        write(self.area / 'state/commit-commit-0001.json', {'status': 'unknown', 'intent': {
            'message': 'fix', 'sourceSha256': sha, 'testJobId': 'request-0001'}})
        with patch.object(self.service, 'git', side_effect=AssertionError('must not replay')):
            self.assertFalse(self.service.commit('fix', sha, 'request-0001', 'commit-0001')['ok'])

    def test_branch_change_and_linked_worktree_refused(self):
        self.git('switch', '-qc', 'unapproved')
        with self.assertRaisesRegex(ValueError, 'branch_changed'): self.service.status()
        with patch.object(Path, 'is_dir', return_value=False):
            with self.assertRaisesRegex(ValueError, 'independent_clone'): self.service.git('status')

    def test_git_hooks_and_filters_cannot_execute(self):
        marker = self.root / 'hook-ran'
        hook = self.repo / '.git/hooks/pre-commit'
        hook.write_text('#!/bin/sh\ntouch "' + marker.as_posix() + '"\n'); hook.chmod(0o755)
        self.modify(); sha = self.receipt(); self.service.commit('fix', sha, 'request-0001', 'commit-0001')
        self.assertFalse(marker.exists())
        self.git('config', 'filter.evil.clean', 'arbitrary command')
        with self.assertRaisesRegex(ValueError, 'executable_configuration'): self.service.status()

    def test_native_files_can_edit_source_but_not_git_or_engineering_records(self):
        agent = configure_native({'id': 'mc-god'}, 'mc-god')
        def blocked(name):
            return any('write_file' in row['tools'] and any(re.search(p, name) for p in row['patterns'])
                       for row in agent['security']['tool_guard']['custom_rules'])
        for name in ('engineering/repo/.git/config', 'engineering/repo/x/.git/hooks/run',
                     'ENGINEERING/REPO/.GIT/config', 'engineering/repo/.git. /config',
                     'engineering/state/commit.json', '/engineering/receipts/forged.json'):
            self.assertTrue(blocked(name), name)
        self.assertFalse(blocked('engineering/repo/world/feature.py'))


if __name__ == '__main__': unittest.main()
