from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
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
