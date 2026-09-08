"""An independent source checkout and durable requests, never a code executor.

Git is invoked with hooks, filters from global config, external diff and network
protocols disabled. Candidate Python/JS is executed only by the control runner.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import time

HEX = re.compile(r'[0-9a-f]{64}')
COMMIT = re.compile(r'[0-9a-f]{40}')
IDENTITY = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{7,79}')
MAX_BYTES = 128 * 1024 * 1024
MAX_FILES = 20000
ROLE = 'mc-god'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def unlinked(path):
    path = Path(path)
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('engineering_linked_path')
    return path


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


def validate_config(value):
    if value.get('schema') != 1 or value.get('enabled') is not True or value.get('role') != ROLE:
        raise ValueError('engineering_not_enabled')
    if not COMMIT.fullmatch(value.get('baseCommit', '')) or not re.fullmatch(r'codex/ops-[A-Za-z0-9_-]{1,80}', value.get('branch', '')):
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
    def __init__(self, config='/engineering/config.json', root='/engineering', git=None):
        self.config_path, self.root = Path(config), unlinked(root)
        self.git_binary = git or shutil.which('git')
        if not self.git_binary: raise ValueError('engineering_git_missing')

    @property
    def config(self):
        return validate_config(read(self.config_path))

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
        if done.returncode: raise ValueError('engineering_git_failed')
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
        for name in sorted(names):
            relative(name); path = unlinked(repo / name)
            if not path.exists(): continue
            if not path.is_file() or path.stat().st_nlink > 1:
                raise ValueError('engineering_source_not_regular')
            size += path.stat().st_size
            if size > MAX_BYTES: raise ValueError('engineering_source_byte_limit')
            data = path.read_bytes()
            mode = head_tree[name][0] if name in head_tree else '100644'
            entries.append({'path': name, 'sha256': digest(data), 'mode': mode, 'size': len(data)})
            blobs[name] = data
            # Git's blob identity binds raw captured bytes without invoking
            # candidate filters. This checkout contract uses 40-digit Git IDs.
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

    def status(self):
        snapshot, _ = self.snapshot(); cfg = self.config
        return {'ok': True, 'role': ROLE, 'repo': cfg['repo'], 'baseCommit': cfg['baseCommit'], 'branch': cfg['branch'],
                **{k: snapshot[k] for k in ('head', 'sourceSha256', 'changed', 'workingChanges')},
                'dirty': bool(snapshot['workingChanges']),
                'testPlans': [{'id': p['id'], 'coverage': p['coverage'], 'checks': list(p['checks'])} for p in cfg['plans']]}

    def diff(self, max_chars=24000):
        if type(max_chars) is not int or not 1000 <= max_chars <= 24000: raise ValueError('engineering_invalid_diff_limit')
        snapshot, _ = self.snapshot()
        body = self.git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', self.config['baseCommit'], '--').decode('utf8', 'replace')
        return {'ok': True, 'sourceSha256': snapshot['sourceSha256'], 'changed': snapshot['changed'],
                'text': body[:max_chars], 'truncated': len(body) > max_chars,
                'notice': 'Untracked files appear in changed; read their source with native read_file.'}

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
            request = {'schema': 1, 'jobId': request_id, 'role': ROLE, 'planId': plan_id,
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
            write(journal, {'status': 'unknown', 'intent': intent, 'previousHead': snapshot['head']})
            # Plumbing consumes captured bytes, never applies a repository filter
            # or a command from candidate files. A later edit is left unstaged.
            self.git('read-tree', '--empty')
            with tempfile.TemporaryDirectory(prefix='objects-', dir=self.root / 'state') as directory:
                paths = []
                for number, entry in enumerate(snapshot['entries']):
                    path = Path(directory) / str(number)
                    path.write_bytes(blobs[entry['path']]); paths.append(path.as_posix())
                ids = self.git('hash-object', '-w', '--no-filters', '--stdin-paths',
                    input=('\n'.join(paths) + '\n').encode()).decode().splitlines()
                if len(ids) != len(paths) or any(not COMMIT.fullmatch(oid) for oid in ids):
                    raise ValueError('engineering_blob_write_unknown')
                updates = b''.join((entry['mode'] + ' ' + oid + '\t' + entry['path'] + '\0').encode('utf8')
                                   for entry, oid in zip(snapshot['entries'], ids))
                self.git('update-index', '-z', '--index-info', input=updates)
            tree = self.git('write-tree').decode().strip()
            commit = self.git('commit-tree', tree, '-p', snapshot['head'], '-m', message).decode().strip()
            self.git('update-ref', 'refs/heads/' + self.config['branch'], commit, snapshot['head'])
            result = {'status': 'committed', 'intent': intent, 'previousHead': snapshot['head'],
                      'commit': commit, 'tree': tree, 'branch': self.config['branch'], 'pushed': False}
            write(journal, result)
            return {'ok': True, **result}
