"""An independent source checkout and durable requests, never a code executor.

Git is invoked with hooks, filters from global config, external diff and network
protocols disabled. Candidate Python/JS is executed only by the control runner.
"""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import time

HEX = re.compile(r'[0-9a-f]{64}')
COMMIT = re.compile(r'[0-9a-f]{40}')
IDENTITY = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{7,79}')
MAX_BYTES = 128 * 1024 * 1024
MAX_FILES = 20000
# The only project-specific bindings: which actor may own a request, and which
# branch names an approved plan may target. Both are constructor arguments.
ROLE = 'mc-god'
BRANCH = r'codex/ops-[A-Za-z0-9_-]{1,80}'


class EngineeringGitError(ValueError):
    """A failed Git process without its arguments, environment or stderr."""
    def __init__(self, exit_code):
        super().__init__('engineering_git_failed')
        self.exit_code = exit_code


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def unlinked(path):
    path = Path(path)
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('engineering_linked_path')
    return path


class SourceReader:
    """One capture's anchored directory handles, never a byte/mtime cache.

    Production runs on Linux: open each parent once with O_NOFOLLOW, then read
    every file through that handle. Revalidate directory names before accepting
    the capture, so replacement/renaming cannot turn an anchored old directory
    into an attestation of the current checkout. Other platforms retain full
    per-file path validation.
    """
    def __init__(self, root, capture_limit=None):
        self.root = unlinked(root)
        self.directories = {}
        self.lock = threading.RLock()
        self.capture_limit, self.reserved_bytes = capture_limit, 0
        self.anchored = (os.open in os.supports_dir_fd and os.stat in os.supports_dir_fd
                         and hasattr(os, 'O_NOFOLLOW') and hasattr(os, 'O_DIRECTORY'))

    def __enter__(self):
        if self.anchored:
            descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self.directories[()] = (descriptor, os.fstat(descriptor))
        return self

    def directory(self, parts):
        with self.lock:
            if parts not in self.directories:
                parent = self.directory(parts[:-1])
                descriptor = os.open(parts[-1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                self.directories[parts] = (descriptor, os.fstat(descriptor))
            return self.directories[parts][0]

    @staticmethod
    def identity(value):
        return value.st_dev, value.st_ino

    def read(self, name, remaining):
        parts = tuple(relative(name).split('/'))
        try:
            if self.anchored:
                descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                     dir_fd=self.directory(parts[:-1]))
                stream = os.fdopen(descriptor, 'rb')
            else:
                path = unlinked(self.root / name)
                path_before = path.stat()
                if not stat.S_ISREG(path_before.st_mode): raise ValueError('engineering_source_not_regular')
                stream = path.open('rb')
        except FileNotFoundError:
            return None
        except OSError as error:
            raise ValueError('engineering_source_not_regular') from error
        with stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise ValueError('engineering_source_not_regular')
            if not self.anchored and self.identity(path_before) != self.identity(before):
                raise ValueError('engineering_source_changed_during_capture')
            if before.st_size > remaining: raise ValueError('engineering_source_byte_limit')
            with self.lock:
                if self.capture_limit is not None:
                    if self.reserved_bytes + before.st_size > self.capture_limit:
                        raise ValueError('engineering_source_byte_limit')
                    self.reserved_bytes += before.st_size
            data = stream.read(before.st_size + 1)
            if len(data) > remaining: raise ValueError('engineering_source_byte_limit')
            after = os.fstat(stream.fileno())
            if (self.identity(before) != self.identity(after) or before.st_size != after.st_size
                    or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns
                    or after.st_nlink != 1 or len(data) != before.st_size):
                raise ValueError('engineering_source_changed_during_capture')
            current = (os.stat(parts[-1], dir_fd=self.directory(parts[:-1]), follow_symlinks=False)
                       if self.anchored else unlinked(self.root / name).stat())
            # Windows Python's fstat/stat expose different ctime semantics.
            # Compare path times to path times and handle times to handle times;
            # inode identity still binds the two views to the same file.
            path_reference = after if self.anchored else path_before
            if (self.identity(current) != self.identity(after) or not stat.S_ISREG(current.st_mode)
                    or current.st_nlink != 1 or current.st_size != after.st_size
                    or current.st_mtime_ns != path_reference.st_mtime_ns
                    or current.st_ctime_ns != path_reference.st_ctime_ns):
                raise ValueError('engineering_source_changed_during_capture')
            return data

    def __exit__(self, kind, value, traceback):
        try:
            if kind is None and self.anchored:
                unlinked(self.root)
                for parts, (_, observed) in self.directories.items():
                    current = (os.stat(parts[-1], dir_fd=self.directories[parts[:-1]][0], follow_symlinks=False)
                               if parts else os.stat(self.root, follow_symlinks=False))
                    if not stat.S_ISDIR(current.st_mode) or self.identity(current) != self.identity(observed):
                        raise ValueError('engineering_source_directory_changed')
        finally:
            for descriptor, _ in self.directories.values(): os.close(descriptor)
            self.directories.clear()


def relative(value):
    if (not isinstance(value, str) or not value or len(value.encode('utf8')) > 512
            or any(ord(c) < 32 or ord(c) == 127 for c in value) or '\\' in value
            or value.startswith('/') or ':' in value):
        raise ValueError('engineering_invalid_source_path')
    parts = value.split('/')
    if any(p in ('', '.', '..') or p.rstrip(' .').casefold() == '.git' for p in parts):
        raise ValueError('engineering_invalid_source_path')
    return value


def read(path, limit=262144):
    path = unlinked(path)
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError('engineering_record_unavailable')
    return json.loads(path.read_text(encoding='utf8'))


def write(path, value):
    path = unlinked(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + os.urandom(8).hex() + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(canonical(value)); stream.flush(); os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_config(value, role=ROLE, branch=BRANCH):
    if value.get('schema') != 1 or value.get('enabled') is not True or value.get('role') != role:
        raise ValueError('engineering_not_enabled')
    if not COMMIT.fullmatch(value.get('baseCommit', '')) or not re.fullmatch(branch, value.get('branch', '')):
        raise ValueError('engineering_invalid_binding')
    if not isinstance(value.get('repo'), str) or not Path(value['repo']).is_absolute():
        raise ValueError('engineering_invalid_repository')
    plans = value.get('plans')
    if not isinstance(plans, list) or not 1 <= len(plans) <= 12 or len({p['id'] for p in plans}) != len(plans):
        raise ValueError('engineering_invalid_plans')
    for plan in plans:
        if (not re.fullmatch(r'[a-z][a-z0-9-]{1,48}', plan.get('id', ''))
                or not re.fullmatch(r'sha256:[0-9a-f]{64}', plan.get('image', ''))
                or not isinstance(plan.get('argv'), list) or not 1 <= len(plan['argv']) <= 40
                or any(not isinstance(a, str) or not a or '\0' in a for a in plan['argv'])
                or type(plan.get('timeoutSeconds')) is not int or not 1 <= plan['timeoutSeconds'] <= 300):
            raise ValueError('engineering_invalid_plan')
        if not plan.get('coverage') or not plan.get('checks'):
            raise ValueError('engineering_fixed_checks_required')
        for prefix in plan['coverage']:
            relative(prefix.rstrip('/'))
        for name, sha in plan['checks'].items():
            relative(name)
            if not HEX.fullmatch(sha): raise ValueError('engineering_invalid_check_hash')
    return value


class EngineeringWorkspace:
    def __init__(self, config='/engineering/config.json', root='/engineering', git=None, role=ROLE, branch=BRANCH):
        self.config_path, self.root = Path(config), unlinked(root)
        self.role, self.branch_pattern = role, branch
        self.git_binary = git or shutil.which('git')
        if not self.git_binary: raise ValueError('engineering_git_missing')

    @property
    def config(self):
        return validate_config(read(self.config_path), self.role, self.branch_pattern)

    @contextmanager
    def locked(self):
        directory = unlinked(self.root / 'state'); directory.mkdir(parents=True, exist_ok=True)
        lock = directory / 'workspace.lock'
        try: stream = lock.open('x', encoding='ascii')
        except FileExistsError: raise ValueError('engineering_busy_or_interrupted') from None
        try:
            stream.write(str(os.getpid())); stream.flush()
            yield
        finally:
            stream.close(); lock.unlink()

    def git(self, *arguments, input=None):
        cfg = self.config
        repo = unlinked(cfg['repo'])
        # A linked worktree can write production's shared Git directory.
        if not unlinked(repo / '.git').is_dir(): raise ValueError('engineering_independent_clone_required')
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith('GIT_')}
        env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
                   GIT_TERMINAL_PROMPT='0', GIT_OPTIONAL_LOCKS='0')
        command = [self.git_binary, '--no-pager', '--literal-pathspecs',
            '-c', 'core.hooksPath=' + os.devnull, '-c', 'core.fsmonitor=false',
            '-c', 'core.pager=cat', '-c', 'diff.external=', '-c', 'core.autocrlf=false',
            '-c', 'core.fileMode=false',
            '-c', 'commit.gpgSign=false', '-c', 'protocol.allow=never',
            '-c', 'user.name=Qiandeng Operations', '-c', 'user.email=operations@qiandeng.invalid',
            '-C', str(repo), *arguments]
        done = subprocess.run(command, input=input, capture_output=True, timeout=25, env=env)
        if done.returncode: raise EngineeringGitError(done.returncode)
        if len(done.stdout) > MAX_BYTES: raise ValueError('engineering_git_output_limit')
        return done.stdout

    def binding(self):
        cfg = self.config
        if self.git('symbolic-ref', '--short', 'HEAD').decode().strip() != cfg['branch']:
            raise ValueError('engineering_branch_changed')
        repo = Path(cfg['repo']).resolve()
        if (Path(self.git('rev-parse', '--show-toplevel').decode().strip()).resolve() != repo
                or Path(self.git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip()).resolve() != repo / '.git'
                or (repo / '.git/commondir').exists() or (repo / '.git/objects/info/alternates').exists()):
            raise ValueError('engineering_independent_clone_required')
        self.git('merge-base', '--is-ancestor', cfg['baseCommit'], 'HEAD')
        # The independent clone's local config is administrator-owned. Reject
        # command-bearing filters even if introduced outside native tools.
        local = self.git('config', '--local', '--list', '--name-only').decode().splitlines()
        if any(k.startswith(('filter.', 'include.', 'includeif.')) for k in local):
            raise ValueError('engineering_git_executable_configuration')
        return self.git('rev-parse', 'HEAD').decode().strip()

    def source_tree(self, revision):
        """Read managed modes from Git, never Windows bind-mount execute bits."""
        result = {}
        for record in self.git('ls-tree', '-r', '-z', '--full-tree', revision).split(b'\0'):
            if not record: continue
            metadata, name = record.split(b'\t', 1)
            mode, kind, oid = metadata.decode('ascii').split(' ')
            name = relative(name.decode('utf8'))
            if mode not in ('100644', '100755') or kind != 'blob' or not COMMIT.fullmatch(oid):
                raise ValueError('engineering_source_mode_not_regular')
            result[name] = (mode, oid)
        if len(result) > MAX_FILES: raise ValueError('engineering_source_file_limit')
        return result

    def snapshot(self):
        head = self.binding(); repo = Path(self.config['repo'])
        head_tree = self.source_tree(head)
        base = self.config['baseCommit']
        base_tree = head_tree if base == head else self.source_tree(base)
        names = set(filter(None, self.git('ls-files', '-z', '--cached', '--others', '--exclude-standard').decode('utf8').split('\0')))
        # Native file tools do not manage the index, but reject a symlink,
        # submodule or unresolved merge introduced there by any other writer.
        for record in self.git('ls-files', '--stage', '-z').split(b'\0'):
            if not record: continue
            metadata, name = record.split(b'\t', 1)
            mode, oid, stage = metadata.decode('ascii').split(' ')
            relative(name.decode('utf8'))
            if mode not in ('100644', '100755') or stage != '0' or not COMMIT.fullmatch(oid):
                raise ValueError('engineering_index_mode_not_regular')
        names.update(head_tree)
        if len(names) > MAX_FILES: raise ValueError('engineering_source_file_limit')
        entries, blobs, captured_tree, size = [], {}, {}, 0
        ordered = sorted(names)
        # Four short-lived I/O workers overlap bind-mount round trips, not model
        # calls. At most 16 queued reads; SourceReader reserves the aggregate
        # byte budget before reading. All workers finish before handles close.
        with SourceReader(repo, capture_limit=MAX_BYTES) as source:
            with ThreadPoolExecutor(max_workers=4, thread_name_prefix='engineering-capture') as pool:
                for offset in range(0, len(ordered), 16):
                    batch = ordered[offset:offset + 16]
                    futures = [pool.submit(source.read, name, MAX_BYTES) for name in batch]
                    for name, future in zip(batch, futures):
                        data = future.result()
                        if data is None: continue
                        size += len(data)
                        mode = head_tree[name][0] if name in head_tree else '100644'
                        entries.append({'path': name, 'sha256': digest(data), 'mode': mode, 'size': len(data)})
                        blobs[name] = data
                        # Git blob identity binds raw captured bytes without
                        # invoking candidate filters or bind-mount file modes.
                        oid = hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()
                        captured_tree[name] = (mode, oid)
        source_sha = digest(canonical(entries))
        # Compare the same normalized modes/bytes that tests and commit use;
        # mount permission noise and staged chmod cannot manufacture changes.
        changed = {name for name in base_tree.keys() | captured_tree.keys()
                   if base_tree.get(name) != captured_tree.get(name)}
        working = {name for name in head_tree.keys() | captured_tree.keys()
                   if head_tree.get(name) != captured_tree.get(name)}
        return {'head': head, 'sourceSha256': source_sha, 'entries': entries, 'changed': sorted(changed),
                'workingChanges': sorted(working)}, blobs

    def overview(self, paths=None, *, include_working=True):
        """Git's live change summary, not an attestation of all source bytes.

        Ordinary inspection must not read/hash every file over a Windows bind
        mount. Only an explicit snapshot, test or commit captures those bytes.
        """
        if paths is not None:
            if not isinstance(paths, list) or not 1 <= len(paths) <= 32:
                raise ValueError('engineering_invalid_inspection_paths')
            paths = sorted({relative(name) for name in paths})
        head = self.binding(); cfg = self.config
        def names(*arguments):
            result = {relative(name) for name in self.git(*arguments).decode('utf8').split('\0') if name}
            if len(result) > MAX_FILES: raise ValueError('engineering_source_file_limit')
            return result
        arguments = ('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z')
        committed = sorted(set() if cfg['baseCommit'] == head else
                           names(*arguments, cfg['baseCommit'], head, '--', *(paths or [])))
        commit_summary = {'committedChanges': committed[:50], 'committedChangeCount': len(committed),
                          'committedChangesTruncated': len(committed) > 50}
        if paths is None:
            return {'head': head, 'sourceSha256': None, 'changed': None, 'workingChanges': None,
                    'untracked': None, 'inspectionPaths': [], **commit_summary}
        untracked = names('ls-files', '-z', '--others', '--exclude-standard', '--', *paths)
        changed = names(*arguments, cfg['baseCommit'], '--', *paths) | untracked
        working = (changed if head == cfg['baseCommit'] else
                   names(*arguments, head, '--', *paths) | untracked) if include_working else None
        return {'head': head, 'sourceSha256': None, 'changed': sorted(changed),
                'workingChanges': sorted(working) if working is not None else None,
                'untracked': sorted(untracked), 'inspectionPaths': paths, **commit_summary}

    def status(self, capture_source=False, paths=None):
        if type(capture_source) is not bool: raise ValueError('engineering_invalid_capture_source')
        if capture_source and paths is not None: raise ValueError('engineering_full_snapshot_requires_all_paths')
        snapshot = self.snapshot()[0] if capture_source else self.overview(paths)
        cfg = self.config
        return {'ok': True, 'role': self.role, 'repo': cfg['repo'], 'baseCommit': cfg['baseCommit'], 'branch': cfg['branch'],
                **{k: snapshot[k] for k in ('head', 'sourceSha256', 'changed', 'workingChanges')},
                'snapshotCaptured': capture_source,
                'comparison': 'captured_bytes' if capture_source else ('git_worktree_paths' if paths else 'git_commits'),
                'inspectionPaths': None if capture_source else snapshot['inspectionPaths'],
                **({} if capture_source else {k: snapshot[k] for k in
                   ('committedChanges', 'committedChangeCount', 'committedChangesTruncated')}),
                'dirty': bool(snapshot['workingChanges']) if snapshot['workingChanges'] is not None else None,
                'notice': ('Full current source bytes captured.' if capture_source else
                           'Working changes/dirty apply only to inspectionPaths; null means uninspected. Supply paths for current changes. Before testing, call engineering_status(capture_source=true) for a fresh full sourceSha256.'),
                'testPlans': [{'id': p['id'], 'coverage': p['coverage'], 'checks': list(p['checks'])} for p in cfg['plans']],
                'progress': self.progress(snapshot['head'], snapshot['sourceSha256'])}

    def progress(self, head, source_sha=None):
        """Small durable receipt index for resuming a shift; no source scans.

        File times order the index only. Reuse/acceptance still requires the
        actual request/receipt identities and a fresh byte capture at commit.
        """
        cfg = self.config
        def recent(folder, pattern, limit):
            folder = unlinked(self.root / folder)
            if not folder.exists(): return [], False
            paths = list(folder.glob(pattern))
            if len(paths) > MAX_FILES: raise ValueError('engineering_record_file_limit')
            paths.sort(key=lambda path: unlinked(path).stat().st_mtime_ns, reverse=True)
            return paths[:limit], len(paths) > limit
        tests, commits, errors = [], [], []
        paths, tests_truncated = recent('requests', '*.json', 8)
        for path in paths:
            try:
                request = read(path)
                if (request.get('schema') != 1 or request.get('role') != self.role
                        or request.get('baseCommit') != cfg['baseCommit'] or request.get('branch') != cfg['branch']
                        or request.get('jobId') != path.stem or not IDENTITY.fullmatch(path.stem)):
                    raise ValueError('engineering_request_binding_mismatch')
                receipt = self.test_status(path.stem)
                plan = next((p for p in cfg['plans'] if p['id'] == request['planId']), None)
                plan_current = plan is not None and digest(canonical(plan)) == request['planSha256']
                passed = (receipt.get('status') == 'passed' and receipt.get('exitCode') == 0
                          and plan_current and receipt.get('imageId') == plan['image'])
                tests.append({'jobId': path.stem, 'planId': request['planId'],
                    'status': receipt['status'], 'sourceSha256': request['sourceSha256'],
                    'headAtTest': request['head'], 'currentPlanMatches': plan_current,
                    'passedFixedPlan': passed,
                    'currentSourceMatches': source_sha == request['sourceSha256'] if source_sha is not None else None})
            except (ValueError, KeyError, OSError, TypeError):
                errors.append({'record': path.name, 'code': 'engineering_progress_record_unavailable'})
        paths, commits_truncated = recent('state', 'commit-*.json', 4)
        for path in paths:
            try:
                row = read(path); intent = row['intent']
                if not HEX.fullmatch(intent.get('sourceSha256', '')):
                    raise ValueError('engineering_invalid_commit_record')
                commits.append({'requestId': path.stem.removeprefix('commit-'), 'status': row['status'],
                    'commit': row.get('commit'), 'sourceSha256': intent['sourceSha256'],
                    'testJobId': intent['testJobId'], 'isCurrentHead': row.get('commit') == head,
                    'pushed': row.get('pushed'),
                    **({'failure': row['failure']} if 'failure' in row else {})})
            except (ValueError, KeyError, OSError, TypeError):
                errors.append({'record': path.name, 'code': 'engineering_progress_record_unavailable'})
        return {'recentTests': tests, 'testsTruncated': tests_truncated,
                'recentCommits': commits, 'commitsTruncated': commits_truncated, 'errors': errors,
                'sourceVerified': source_sha is not None,
                'notice': 'Read this durable progress before restarting old work. A historical pass is not current-source acceptance. '
                          'For an existing passed job, engineering_commit with its sourceSha256 performs its own fresh byte check; '
                          'no preliminary full capture is needed. If source changed, capture once after edits and queue a new test. '
                          'For a queued/running job, query the same job next shift. A local commit still needs separate deployment review.'}

    def diff(self, max_chars=24000, paths=None):
        if type(max_chars) is not int or not 1000 <= max_chars <= 24000: raise ValueError('engineering_invalid_diff_limit')
        snapshot = self.overview(paths, include_working=False)
        body = (self.git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', self.config['baseCommit'], '--',
                         *snapshot['inspectionPaths']).decode('utf8', 'replace') if paths else None)
        return {'ok': True, 'head': snapshot['head'], 'sourceSha256': None, 'snapshotCaptured': False,
                'comparison': 'git_worktree_paths' if paths else 'git_commits',
                'requiresPaths': paths is None, 'inspectionPaths': snapshot['inspectionPaths'],
                **{k: snapshot[k] for k in ('committedChanges', 'committedChangeCount', 'committedChangesTruncated')},
                'changed': snapshot['changed'], 'untracked': snapshot['untracked'],
                'text': body[:max_chars] if body is not None else None,
                'truncated': len(body) > max_chars if body is not None else None,
                'notice': ('Supply paths (1-32 relative source files/directories) to inspect the working tree; it has not been scanned.' if paths is None else
                           'Git diff only for inspectionPaths; no source snapshot. Untracked files appear in changed; read their source with native read_file.')}

    def plan(self, plan_id, snapshot):
        plan = next((p for p in self.config['plans'] if p['id'] == plan_id), None)
        if not plan: raise ValueError('engineering_unknown_test_plan')
        entries = {e['path']: e for e in snapshot['entries']}
        if any(entries.get(name, {}).get('sha256') != sha for name, sha in plan['checks'].items()):
            raise ValueError('engineering_fixed_checks_changed')
        if any(not any(name == prefix or prefix.endswith('/') and name.startswith(prefix) for prefix in plan['coverage'])
               for name in snapshot['changed']):
            raise ValueError('engineering_changes_not_covered_by_plan')
        return plan

    def test(self, plan_id, expected_source_sha256, request_id):
        if not IDENTITY.fullmatch(request_id) or not HEX.fullmatch(expected_source_sha256):
            raise ValueError('engineering_invalid_test_request')
        with self.locked():
            snapshot, blobs = self.snapshot()
            if snapshot['sourceSha256'] != expected_source_sha256: raise ValueError('engineering_source_changed')
            plan = self.plan(plan_id, snapshot)
            request = {'schema': 1, 'jobId': request_id, 'role': self.role, 'planId': plan_id,
                       'sourceSha256': expected_source_sha256, 'planSha256': digest(canonical(plan)),
                       'baseCommit': self.config['baseCommit'], 'branch': self.config['branch'], 'head': snapshot['head']}
            dest = self.root / 'requests' / (request_id + '.json')
            if dest.exists():
                if read(dest) != request: raise ValueError('engineering_request_conflict')
                return self.test_status(request_id)
            folder = unlinked(self.root / 'snapshots' / expected_source_sha256)
            if not folder.exists():
                temporary = folder.with_name(expected_source_sha256 + '.' + os.urandom(8).hex() + '.tmp')
                temporary.mkdir(parents=True)
                for entry in snapshot['entries']:
                    path = temporary / 'source' / entry['path']; path.parent.mkdir(parents=True, exist_ok=True)
                    with path.open('xb') as stream: stream.write(blobs[entry['path']])
                    path.chmod(0o755 if entry['mode'] == '100755' else 0o644)
                write(temporary / 'manifest.json', snapshot)
                temporary.rename(folder)
            elif read(folder / 'manifest.json', MAX_BYTES)['entries'] != snapshot['entries']:
                raise ValueError('engineering_snapshot_conflict')
            write(dest, request)
            return {'ok': True, 'jobId': request_id, 'status': 'queued', 'sourceSha256': expected_source_sha256}

    def test_status(self, job_id):
        if not IDENTITY.fullmatch(job_id): raise ValueError('engineering_invalid_job_id')
        request = read(self.root / 'requests' / (job_id + '.json'))
        file = self.root / 'receipts' / (job_id + '.json')
        if not file.exists(): return {'ok': True, 'jobId': job_id, 'status': 'queued', 'sourceSha256': request['sourceSha256']}
        receipt = read(file)
        if any(receipt.get(k) != request[k] for k in ('jobId', 'sourceSha256', 'planSha256')):
            raise ValueError('engineering_receipt_mismatch')
        return {'ok': True, **receipt}

    def commit(self, message, expected_source_sha256, test_job_id, request_id):
        if (not IDENTITY.fullmatch(request_id) or not HEX.fullmatch(expected_source_sha256)
                or not isinstance(message, str) or not 1 <= len(message.strip()) <= 300
                or any(ord(c) < 32 for c in message)):
            raise ValueError('engineering_invalid_commit_request')
        with self.locked():
            journal = self.root / 'state' / ('commit-' + request_id + '.json')
            intent = {'message': message, 'sourceSha256': expected_source_sha256, 'testJobId': test_job_id}
            if journal.exists():
                previous = read(journal)
                if previous['intent'] != intent: raise ValueError('engineering_request_conflict')
                return {'ok': previous['status'] == 'committed', **previous}
            snapshot, blobs = self.snapshot()
            if snapshot['sourceSha256'] != expected_source_sha256: raise ValueError('engineering_source_changed')
            if not snapshot['workingChanges']: raise ValueError('engineering_no_source_changes')
            receipt = self.test_status(test_job_id)
            plan = self.plan(receipt.get('planId'), snapshot)
            if (receipt.get('status') != 'passed' or receipt.get('exitCode') != 0
                    or receipt.get('sourceSha256') != expected_source_sha256
                    or receipt.get('planSha256') != digest(canonical(plan)) or receipt.get('imageId') != plan['image']):
                raise ValueError('engineering_passed_fixed_checks_required')
            pending = {'status': 'unknown', 'intent': intent, 'previousHead': snapshot['head']}
            write(journal, pending)
            # Plumbing consumes captured bytes, never applies a repository filter
            # or a command from candidate files. A later edit is left unstaged.
            step = 'read-tree'
            try:
                self.git('read-tree', '--empty')
                step = 'prepare-blobs'
                with tempfile.TemporaryDirectory(prefix='objects-', dir=self.root / 'state') as directory:
                    paths = []
                    for number, entry in enumerate(snapshot['entries']):
                        path = Path(directory) / str(number)
                        path.write_bytes(blobs[entry['path']]); paths.append(path.as_posix())
                    step = 'hash-object'
                    ids = self.git('hash-object', '-w', '--no-filters', '--stdin-paths',
                        input=('\n'.join(paths) + '\n').encode()).decode().splitlines()
                    if len(ids) != len(paths) or any(not COMMIT.fullmatch(oid) for oid in ids):
                        raise ValueError('engineering_blob_write_unknown')
                    updates = b''.join((entry['mode'] + ' ' + oid + '\t' + entry['path'] + '\0').encode('utf8')
                                       for entry, oid in zip(snapshot['entries'], ids))
                    step = 'update-index'
                    self.git('update-index', '-z', '--index-info', input=updates)
                    step = 'cleanup-blobs'
                step = 'write-tree'
                tree = self.git('write-tree').decode().strip()
                step = 'commit-tree'
                commit = self.git('commit-tree', tree, '-p', snapshot['head'], '-m', message).decode().strip()
                step = 'update-ref'
                self.git('update-ref', 'refs/heads/' + self.config['branch'], commit, snapshot['head'])
                result = {'status': 'committed', 'intent': intent, 'previousHead': snapshot['head'],
                          'commit': commit, 'tree': tree, 'branch': self.config['branch'], 'pushed': False}
                step = 'persist-result'
                write(journal, result)
                return {'ok': True, **result}
            except Exception as error:
                error_type = next((name for kind, name in (
                    (EngineeringGitError, 'EngineeringGitError'), (subprocess.TimeoutExpired, 'TimeoutExpired'),
                    (OSError, 'OSError'), (ValueError, 'ValueError')) if isinstance(error, kind)), 'Exception')
                failure = {'step': step, 'errorType': error_type,
                           'exitCode': error.exit_code if isinstance(error, EngineeringGitError) else None}
                # Diagnostics do not resolve uncertainty: update-ref may have
                # succeeded before an error. Never retry or roll it back here,
                # and never replace a result that was already durably written.
                try:
                    if read(journal) == pending: write(journal, {**pending, 'failure': failure})
                except (OSError, ValueError):
                    pass  # The original unknown journal remains authoritative.
                raise
