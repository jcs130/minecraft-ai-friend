from copy import deepcopy
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
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
from engineering_workspace import EngineeringWorkspace, SourceReader, canonical, digest, write
from engineering_mcp import register_engineering_tools, TOOLS
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
        return self.service.status(capture_source=True)['sourceSha256']

    def receipt(self, request='request-0001', status='passed'):
        sha = self.service.status(capture_source=True)['sourceSha256']
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
        before = self.service.status(capture_source=True)
        with self.all_source_files_appear_executable():
            after = self.service.status(capture_source=True)
            self.assertEqual(after['sourceSha256'], before['sourceSha256'])
            self.assertFalse(after['dirty'])
            self.assertEqual(after['workingChanges'], [])
            self.assertEqual(after['changed'], [])

    def test_overview_and_diff_do_not_capture_or_read_all_source_bytes(self):
        self.source.write_text('VALUE = 2\n', newline='\n')
        (self.repo / 'world/new.py').write_text('NEW = 1\n', newline='\n')
        self.check.unlink()
        with patch.object(self.service, 'snapshot', side_effect=AssertionError('full snapshot during inspection')):
            with patch.object(Path, 'read_bytes', side_effect=AssertionError('Python source read during inspection')):
                status = self.service.status(paths=['world', 'tests'])
                diff = self.service.diff(paths=['world', 'tests'])
        wanted = ['tests/test_feature.py', 'world/feature.py', 'world/new.py']
        self.assertEqual(status['changed'], wanted)
        self.assertEqual(status['workingChanges'], wanted)
        self.assertTrue(status['dirty'])
        for result in (status, diff):
            self.assertEqual(result['changed'], wanted)
            self.assertIsNone(result['sourceSha256'])
            self.assertFalse(result['snapshotCaptured'])
            self.assertEqual(result['comparison'], 'git_worktree_paths')
            self.assertEqual(result['inspectionPaths'], ['tests', 'world'])
        self.assertEqual(diff['untracked'], ['world/new.py'])
        self.assertIn('+VALUE = 2', diff['text'])
        self.assertIn('deleted file', diff['text'])

    def test_overview_distinguishes_base_changes_from_uncommitted_changes(self):
        self.source.write_text('VALUE = 2\n', newline='\n')
        self.git('add', '.'); self.git('commit', '-qm', 'candidate')
        status = self.service.status(paths=['world/feature.py'])
        self.assertEqual(status['changed'], ['world/feature.py'])
        self.assertEqual(status['workingChanges'], [])
        self.assertFalse(status['dirty'])
        self.assertIn('+VALUE = 2', self.service.diff(paths=['world/feature.py'])['text'])

    def test_default_status_and_diff_never_scan_the_working_tree(self):
        self.source.write_text('VALUE = 2\n', newline='\n')
        self.git('add', '.'); self.git('commit', '-qm', 'candidate')
        head = self.git('rev-parse', 'HEAD').strip()
        with patch.object(self.service, 'git', wraps=self.service.git) as called:
            status = self.service.status()
            diff = self.service.diff()
        for call in called.call_args_list:
            args = call.args
            self.assertNotEqual(args[0], 'ls-files')
            if args[0] == 'diff':
                self.assertEqual(args[-3:], (self.base, head, '--'))
        self.assertIsNone(status['dirty'])
        self.assertIsNone(status['changed'])
        self.assertIsNone(status['workingChanges'])
        self.assertEqual(status['committedChanges'], ['world/feature.py'])
        self.assertTrue(diff['requiresPaths'])
        self.assertIsNone(diff['text'])
        self.assertIsNone(diff['truncated'])

    def test_path_inspection_reports_only_its_requested_scope(self):
        self.source.write_text('VALUE = 2\n', newline='\n')
        self.check.unlink()
        status = self.service.status(paths=['world/feature.py'])
        self.assertEqual(status['changed'], ['world/feature.py'])
        self.assertEqual(status['inspectionPaths'], ['world/feature.py'])
        self.assertEqual(self.service.diff(paths=['world/feature.py'])['changed'], ['world/feature.py'])
        for paths in ([], ['.'], ['../escape'], ['world/*.py'], ['world'] * 33):
            # Git metacharacters are literal paths, never expressions.
            if paths == ['world/*.py']:
                self.assertEqual(self.service.status(paths=paths)['changed'], [])
                continue
            with self.assertRaises(ValueError): self.service.status(paths=paths)
        with self.assertRaisesRegex(ValueError, 'full_snapshot_requires_all_paths'):
            self.service.status(capture_source=True, paths=['world/feature.py'])

    def test_committed_overview_is_bounded_and_can_be_narrowed_by_path(self):
        for number in range(55):
            (self.repo / 'world' / f'added-{number:02}.py').write_text('VALUE = 1\n')
        self.git('add', '.'); self.git('commit', '-qm', 'many committed files')
        status = self.service.status()
        self.assertEqual(status['committedChangeCount'], 55)
        self.assertEqual(len(status['committedChanges']), 50)
        self.assertTrue(status['committedChangesTruncated'])
        scoped = self.service.status(paths=['world/added-54.py'])
        self.assertEqual(scoped['committedChanges'], ['world/added-54.py'])
        self.assertEqual(scoped['committedChangeCount'], 1)
        self.assertFalse(scoped['committedChangesTruncated'])

    def test_same_size_same_mtime_edit_requires_fresh_snapshot_for_test_and_commit(self):
        self.modify(); sha = self.receipt()
        before = self.source.stat()
        self.source.write_bytes(b'VALUE = 3\n')
        os.utime(self.source, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertEqual(self.source.stat().st_size, before.st_size)
        self.assertEqual(self.source.stat().st_mtime_ns, before.st_mtime_ns)
        for action in (
                lambda: self.service.test('python-fixed', sha, 'request-0002'),
                lambda: self.service.commit('fix', sha, 'request-0001', 'commit-0001')):
            with self.assertRaisesRegex(ValueError, 'engineering_source_changed'):
                action()
        current = self.service.status(capture_source=True)
        self.assertTrue(current['snapshotCaptured'])
        self.assertEqual(current['comparison'], 'captured_bytes')
        self.assertNotEqual(current['sourceSha256'], sha)
        self.assertFalse((self.area / 'requests/request-0002.json').exists())
        self.assertFalse((self.area / 'state/commit-commit-0001.json').exists())

    def test_status_requires_explicit_boolean_to_capture_source(self):
        for invalid in ('false', 1, None):
            with self.assertRaisesRegex(ValueError, 'engineering_invalid_capture_source'):
                self.service.status(capture_source=invalid)

    def test_native_status_defaults_to_overview_and_exposes_explicit_snapshot(self):
        class App:
            def __init__(self): self.functions = {}
            def tool(self):
                def register(function):
                    self.functions[function.__name__] = function
                    return function
                return register
        app = App()
        self.assertEqual(register_engineering_tools(app, self.service), list(TOOLS))
        status = app.functions['engineering_status']
        with patch.object(self.service, 'status', return_value={'ok': True}) as called:
            status(); called.assert_called_with(capture_source=False, paths=None)
            status(capture_source=True); called.assert_called_with(capture_source=True, paths=None)
            status(paths=['world/feature.py']); called.assert_called_with(capture_source=False, paths=['world/feature.py'])

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
            self.assertFalse(self.service.status(capture_source=True)['dirty'])
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
            self.service.test('python-fixed', self.service.status(capture_source=True)['sourceSha256'], 'request-0001')
        self.check.write_bytes(self.git('show', 'HEAD:tests/test_feature.py').encode())
        (self.repo / 'production.yml').write_text('changed\n')
        with self.assertRaisesRegex(ValueError, 'not_covered'):
            self.service.test('python-fixed', self.service.status(capture_source=True)['sourceSha256'], 'request-0002')

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

    def test_progress_resumes_verified_job_without_claiming_current_source_pass(self):
        self.modify(); sha = self.receipt()
        self.source.write_text('VALUE = 3\n', newline='\n')
        with patch.object(self.service, 'snapshot', side_effect=AssertionError('progress scanned source')):
            progress = self.service.status()['progress']
        test = progress['recentTests'][0]
        self.assertEqual(test['jobId'], 'request-0001')
        self.assertEqual(test['sourceSha256'], sha)
        self.assertTrue(test['passedFixedPlan'])
        self.assertIsNone(test['currentSourceMatches'])
        self.assertFalse(progress['sourceVerified'])
        current = self.service.status(capture_source=True)['progress']['recentTests'][0]
        self.assertFalse(current['currentSourceMatches'])
        with self.assertRaisesRegex(ValueError, 'source_changed'):
            self.service.commit('must reject drift', sha, 'request-0001', 'commit-0001')

    def test_progress_exposes_committed_and_unknown_journals_without_replaying(self):
        self.modify(); sha = self.receipt()
        result = self.service.commit('candidate', sha, 'request-0001', 'commit-0001')
        write(self.area / 'state/commit-commit-0002.json', {'status': 'unknown', 'intent': {
            'sourceSha256': sha, 'testJobId': 'request-0001', 'message': 'unknown'}})
        progress = self.service.status()['progress']
        rows = {row['requestId']: row for row in progress['recentCommits']}
        self.assertTrue(rows['commit-0001']['isCurrentHead'])
        self.assertEqual(rows['commit-0001']['commit'], result['commit'])
        self.assertFalse(rows['commit-0001']['pushed'])
        self.assertEqual(rows['commit-0002']['status'], 'unknown')
        self.assertFalse(rows['commit-0002']['isCurrentHead'])

    def test_progress_refuses_mismatched_receipt_and_changed_fixed_plan(self):
        self.modify(); self.receipt()
        self.config['plans'][0]['image'] = 'sha256:' + '2' * 64
        write(self.area / 'config.json', self.config)
        progress = self.service.status()['progress']
        self.assertFalse(progress['recentTests'][0]['currentPlanMatches'])
        self.assertFalse(progress['recentTests'][0]['passedFixedPlan'])
        file = self.area / 'receipts/request-0001.json'
        row = json.loads(file.read_text()); row['sourceSha256'] = '3' * 64; write(file, row)
        progress = self.service.status()['progress']
        self.assertEqual(progress['recentTests'], [])
        self.assertEqual(progress['errors'][0]['code'], 'engineering_progress_record_unavailable')

    def test_progress_is_bounded_and_does_not_return_test_logs(self):
        self.modify(); self.receipt()
        template = json.loads((self.area / 'requests/request-0001.json').read_text())
        for number in range(10):
            row = {**template, 'jobId': f'request-{number+10:04d}'}
            write(self.area / 'requests' / (row['jobId'] + '.json'), row)
        progress = self.service.status()['progress']
        self.assertEqual(len(progress['recentTests']), 8)
        self.assertTrue(progress['testsTruncated'])
        self.assertTrue(all(row['status'] == 'queued' for row in progress['recentTests']))
        self.assertTrue(all('log' not in row for row in progress['recentTests']))


class SourceReaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'repo'; (self.root / 'nested').mkdir(parents=True)
        (self.root / 'nested/one').write_bytes(b'one')
        (self.root / 'nested/two').write_bytes(b'two')

    def test_missing_source_and_actual_byte_limit_are_preserved(self):
        with SourceReader(self.root) as reader:
            self.assertIsNone(reader.read('missing/file', 4))
            self.assertEqual(reader.read('nested/one', 3), b'one')
            with self.assertRaisesRegex(ValueError, 'source_byte_limit'):
                reader.read('nested/two', 2)

    @unittest.skipUnless(os.name == 'posix', 'production Linux descriptor traversal')
    def test_links_and_nonregular_sources_fail_closed(self):
        outside = Path(self.tmp.name) / 'outside'; outside.write_bytes(b'private')
        for kind in ('symlink', 'hardlink', 'directory', 'fifo'):
            with self.subTest(kind=kind):
                bad = self.root / 'nested/bad'
                if kind == 'symlink': bad.symlink_to(outside)
                elif kind == 'hardlink': os.link(outside, bad)
                elif kind == 'directory': bad.mkdir()
                else: os.mkfifo(bad)
                with self.assertRaisesRegex(ValueError, 'source_not_regular'):
                    with SourceReader(self.root) as reader: reader.read('nested/bad', 100)
                bad.rmdir() if bad.is_dir() else bad.unlink()

    @unittest.skipUnless(os.name == 'posix', 'production Linux descriptor traversal')
    def test_replacing_a_previously_opened_parent_does_not_follow_new_link(self):
        outside = Path(self.tmp.name) / 'outside'; outside.mkdir()
        (outside / 'two').write_bytes(b'private')
        with self.assertRaisesRegex(ValueError, 'source_directory_changed'):
            with SourceReader(self.root) as reader:
                self.assertEqual(reader.read('nested/one', 10), b'one')
                (self.root / 'nested').rename(self.root / 'original')
                (self.root / 'nested').symlink_to(outside, target_is_directory=True)
                self.assertEqual(reader.read('nested/two', 10), b'two')
        self.assertEqual(reader.directories, {})

    @unittest.skipUnless(os.name == 'posix', 'production Linux descriptor traversal')
    def test_replacing_root_directory_invalidates_capture(self):
        with self.assertRaisesRegex(ValueError, 'source_directory_changed'):
            with SourceReader(self.root) as reader:
                self.assertEqual(reader.read('nested/one', 3), b'one')
                self.root.rename(self.root.with_name('original'))
                self.root.mkdir()

    def test_each_capture_reads_same_size_same_mtime_changes(self):
        path = self.root / 'nested/one'; before = path.stat()
        with SourceReader(self.root) as reader: self.assertEqual(reader.read('nested/one', 3), b'one')
        path.write_bytes(b'new'); os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
        with SourceReader(self.root) as reader: self.assertEqual(reader.read('nested/one', 3), b'new')

    def test_parallel_reads_reserve_one_total_byte_budget_before_allocating(self):
        names = [f'nested/entry-{number}' for number in range(40)]
        for name in names: (self.root / name).write_bytes(b'x' * 1024)
        successes, failures = 0, 0
        with SourceReader(self.root, capture_limit=10240) as reader:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(reader.read, name, 10240) for name in names]
                for future in futures:
                    try:
                        self.assertEqual(len(future.result()), 1024); successes += 1
                    except ValueError as error:
                        self.assertEqual(str(error), 'engineering_source_byte_limit'); failures += 1
            self.assertEqual(reader.reserved_bytes, 10240)
        self.assertEqual((successes, failures), (10, 30))


if __name__ == '__main__': unittest.main()
