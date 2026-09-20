"""Reviewable recovery of the existing engineering checkout, never a baseline reset.

Prepare and test only write an isolated runtime directory. Apply requires every
engineer Cron paused, the native role idle, unchanged original/candidate bytes,
and a completed receipt from the fixed isolated command below. Legacy recovery
may restore a failing testable candidate; baseline upgrades require every fixed
plan to pass and an explicit native quiesce receipt. Neither deploys business code.
"""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
REPO = Path('server/agents/work/workspaces/qd-engineer/engineering/repo')
CONFIG = Path('server/engineering/config.json')
IMAGE = 'sha256:45dc7f061c09489b7d36d5b1499b830a3b14176835c0bc9afaa233d60df2299f'
ARGV = ['python', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_world_*.py', '-v']
COVERAGE = ['world/ops/world_team.py', 'world/ops/world_team_mcp.py',
    'world/ops/world_team_schedule.py', 'world/ops/world_team_profiles.py',
    'world/ops/world_content_tools.py', 'world/sidecar/world_content.py',
    'world/sidecar/mc_guild.py', 'world/sidecar/world_admin_consumer.py', 'docs/', 'tests/']
SPLITS = {'tests/test_world_team.py': 'tests/test_world_team_candidate_regressions.py',
          'tests/test_world_content.py': 'tests/test_world_content_candidate_regressions.py'}
CHECK_RUNNER = 'tools/run_embodied_engineering_checks.py'
EMBODIED_COVERAGE = COVERAGE + [CHECK_RUNNER, 'world/survival/AGENT.md', *('world/survival/' + name + '.py' for name in (
    'controller', 'embodiment', 'sensors', 'dialogue', 'behavior_context', 'practice',
    'fast_execution', 'native_tools', 'service', 'numen_gateway', 'world_adapter', 'mcp_server', 'execution_evidence'))]


def require(value, reason):
    if not value: raise ValueError(reason)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def canonical(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    with tmp.open('wb') as out:
        out.write(canonical(value)); out.flush(); os.fsync(out.fileno())
    tmp.replace(path)


def safe(path, root=None):
    root = ROOT if root is None else root
    path = Path(path)
    require(not any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)), 'linked_path')
    path = path.resolve()
    require(path.is_relative_to(Path(root).resolve()), 'path_outside_project')
    return path


def run(args, timeout=120, **kwargs):
    out = subprocess.run(args, capture_output=True, timeout=timeout, **kwargs)
    if out.returncode: raise ValueError('command_failed: ' + out.stderr.decode('utf8', 'replace')[-2000:])
    return out.stdout


def git(repo, *args, input=None):
    env = {k:v for k,v in os.environ.items() if not k.upper().startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull, GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    return run(['git', '--no-pager', '--literal-pathspecs', '-c', 'core.hooksPath='+os.devnull,
        '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'core.fileMode=false',
        '-c', 'protocol.allow=never', '-c', 'user.name=Qiandeng Maintenance',
        '-c', 'user.email=maintenance@qiandeng.invalid', '-C', str(repo), *args], input=input, env=env)


def tree(repo, ref):
    result = {}
    for entry in git(repo, 'ls-tree', '-rz', '--full-tree', ref).split(b'\0'):
        if not entry: continue
        meta, raw = entry.split(b'\t', 1); mode, kind, oid = meta.decode().split()
        name = raw.decode('utf8')
        require(mode in ('100644', '100755') and kind == 'blob', 'non_regular_git_tree')
        result[name] = (mode, oid)
    return result


def references(repo):
    return dict(line.split(' ', 1) for line in git(repo, 'for-each-ref',
        '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/tags/').decode().splitlines())


def clone_preserving_refs(original, stage, refs, *, checkout=True):
    run(['git', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath='+os.devnull,
         'clone', '--no-local', '--no-hardlinks', *([] if checkout else ['--no-checkout']), str(original), str(stage)])
    # A normal clone turns other local heads into origin/* refs. Copy them
    # explicitly before removing that remote; retain every original tag too.
    for ref, oid in refs.items():
        git(stage, 'update-ref', ref, oid)
    git(stage, 'remote', 'remove', 'origin')
    git(stage, 'config', 'core.autocrlf', 'false'); git(stage, 'config', 'core.fileMode', 'false')
    require(references(stage) == refs, 'original_refs_not_preserved')


def capture(repo):
    head = git(repo, 'rev-parse', 'HEAD').decode().strip()
    branch = git(repo, 'symbolic-ref', '--short', 'HEAD').decode().strip()
    refs = references(repo)
    index = git(repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0')
    require(len(index) <= 20001, 'candidate_file_limit')
    blobs, manifest = {}, []
    for name in sorted(set(index) - {''}):
        path = safe(repo / name, repo)
        if not path.exists():
            manifest.append({'path': name, 'missing': True}); continue
        require(path.is_file() and path.stat().st_nlink == 1, 'non_regular_candidate')
        data = path.read_bytes(); blobs[name] = data
        require(sum(len(v) for v in blobs.values()) <= 128*1024*1024, 'candidate_byte_limit')
        manifest.append({'path': name, 'sha256': sha(data), 'size': len(data)})
    captured = {'head': head, 'branch': branch, 'refs': refs, 'files': manifest,
                'indexSha256': sha(git(repo, 'ls-files', '--stage', '-z'))}
    return captured | {'sha256': sha(canonical(captured))}, blobs


def split_additive_tests(base_raw, candidate_raw, module):
    """Preserve added test classes/methods; reject any changed existing assertion.

    This deliberately supports only additive changes. Existing module setup and
    existing methods must remain semantically identical to approved source.
    """
    baseline, candidate = base_raw.decode('utf8'), candidate_raw.decode('utf8')
    base, current = ast.parse(baseline), ast.parse(candidate)
    dump = lambda node: ast.dump(node, include_attributes=False)
    def segment(node):
        first = min([node.lineno, *(d.lineno for d in getattr(node, 'decorator_list', []))])
        return textwrap.dedent('\n'.join(candidate.splitlines()[first-1:node.end_lineno]))
    current_classes = {n.name:n for n in current.body if isinstance(n, ast.ClassDef)}
    base_classes = {n.name:n for n in base.body if isinstance(n, ast.ClassDef)}
    base_other = [dump(n) for n in base.body if not isinstance(n, (ast.ClassDef, ast.Import, ast.ImportFrom))]
    current_other = [dump(n) for n in current.body if not isinstance(n, (ast.ClassDef, ast.Import, ast.ImportFrom))]
    require(base_other == current_other, 'non_additive_test_module_change')
    current_imports = {dump(n) for n in current.body if isinstance(n, (ast.Import, ast.ImportFrom))}
    require(all(dump(n) in current_imports for n in base.body if isinstance(n, (ast.Import, ast.ImportFrom))), 'test_import_removed')
    require(set(base_classes) <= set(current_classes), 'test_class_removed')
    additions, method_count = [], 0
    for name, old in base_classes.items():
        new = current_classes[name]
        require(dump(ast.ClassDef(name=name, bases=old.bases, keywords=old.keywords, body=[], decorator_list=old.decorator_list))
                == dump(ast.ClassDef(name=name, bases=new.bases, keywords=new.keywords, body=[], decorator_list=new.decorator_list)),
                'test_class_contract_changed')
        old_methods = {n.name:n for n in old.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        new_methods = {n.name:n for n in new.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        require(all(name in new_methods and dump(node) == dump(new_methods[name]) for name,node in old_methods.items()), 'existing_test_method_changed')
        require([dump(n) for n in old.body if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
                == [dump(n) for n in new.body if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))], 'test_class_setup_changed')
        extra = [n for n in new.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name not in old_methods]
        require(all(n.name.startswith('test_') for n in extra), 'new_helper_in_existing_test_class_requires_review')
        if extra:
            chunks = [textwrap.indent(segment(n), '    ') for n in extra]
            additions.append('class Candidate'+name+'(_baseline.'+name+'):\n'+'\n\n'.join(chunks))
            method_count += len(extra)
    for name, node in current_classes.items():
        if name not in base_classes: additions.append(segment(node))
    require(additions, 'no_additive_tests_found')
    # Reuse exactly the candidate module's imports/constants before its first class.
    first_class = min(n.lineno for n in current_classes.values())
    header = '\n'.join(candidate.splitlines()[:first_class-1]).rstrip()
    generated = (header+'\nimport '+module+' as _baseline\n\n\n'+'\n\n\n'.join(additions)+'\n').encode('utf8')
    ast.parse(generated)
    return generated, {'newClasses': len(set(current_classes)-set(base_classes)), 'addedMethods': method_count}


def proposed_config(cfg):
    checks = {}
    for plan in cfg['plans']:
        for name, digest in plan['checks'].items():
            require(checks.get(name, digest) == digest, 'conflicting_approved_checks')
            checks[name] = digest
    return cfg | {'plans': [{'id': 'team-guild-admin-python', 'image': IMAGE, 'argv': ARGV,
        'coverage': COVERAGE, 'checks': checks, 'timeoutSeconds': 180}]}


def verify_snapshot_contract(report):
    expected = [{'path': row['path'], 'sha256': row['sha256']}
                for row in report['preparedSource']['files'] if not row.get('missing')]
    require(report['snapshotManifest'] == expected, 'snapshot_not_prepared_candidate')
    hashes = {row['path']: row['sha256'] for row in expected}
    for plan in report['proposedConfig']['plans']:
        require(all(hashes.get(name) == digest for name,digest in plan['checks'].items()), 'approved_check_bytes_changed')


def completed_test_receipt(report, receipt, output):
    if report.get('mode') == 'upgrade':
        plans = report['proposedConfig']['plans']
        require(receipt.get('schema') == 2 and receipt.get('snapshotSha256') == report['snapshotSha256']
                and receipt.get('outputSha256') == sha(output) and len(receipt.get('plans', [])) == len(plans),
                'completed_candidate_test_required')
        offset = 0
        for plan, result in zip(plans, receipt['plans']):
            size = result.get('outputSize')
            require(type(size) is int and size >= 0 and result.get('outputOffset') == offset,
                    'candidate_test_output_mismatch')
            part = output[offset:offset+size]; offset += size
            require(result.get('planId') == plan['id'] and result.get('planSha256') == sha(canonical(plan))
                    and result.get('image') == plan['image'] and result.get('argv') == plan['argv']
                    and type(result.get('exitCode')) is int and result['exitCode'] in (0,1)
                    and result.get('status') == ('passed' if result['exitCode'] == 0 else 'failed')
                    and result.get('outputSha256') == sha(part), 'completed_candidate_test_required')
        require(offset == len(output), 'candidate_test_output_mismatch')
        status = 'passed' if all(row['exitCode'] == 0 for row in receipt['plans']) else 'failed'
        require(receipt.get('status') == status, 'completed_candidate_test_required')
        return status
    code = receipt.get('exitCode')
    require(type(code) is int and code in (0, 1), 'candidate_test_did_not_complete')
    require(receipt.get('status') == ('passed' if code == 0 else 'failed')
        and receipt.get('image') == IMAGE and receipt.get('argv') == ARGV
        and receipt.get('snapshotSha256') == report['snapshotSha256']
        and receipt.get('outputSha256') == sha(output), 'completed_candidate_test_required')
    return receipt['status']


def prepare(unknown_review=None):
    original = safe(ROOT / REPO); cfg_raw = (ROOT / CONFIG).read_bytes(); cfg = json.loads(cfg_raw)
    before, blobs = capture(original)
    require(before['branch'] == cfg['branch'], 'original_branch_changed')
    base_tree, head_tree = tree(original, cfg['baseCommit']), tree(original, before['head'])
    checks = {}
    for plan in cfg['plans']:
        for name, digest in plan['checks'].items():
            require(checks.get(name, digest) == digest, 'conflicting_approved_checks')
            checks[name] = digest
            require(sha(git(original, 'show', cfg['baseCommit']+':'+name)) == digest, 'approved_check_not_committed_base')
    require(run(['docker', 'image', 'inspect', IMAGE, '--format', '{{.Id}}']).decode().strip() == IMAGE, 'fixed_test_image_unavailable')
    ident = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]
    folder = safe(ROOT / 'runtime' / ('engineering-recovery-'+ident)); folder.mkdir()
    stage = folder / 'repo'
    # Local clone transports only the original Git history. It never executes candidates.
    clone_preserving_refs(original, stage, before['refs'])
    mode_fixes = [name for name,(mode,oid) in head_tree.items() if name in base_tree
                  and base_tree[name][1] == oid and base_tree[name][0] != mode]
    if mode_fixes:
        git(stage, 'update-index', '-z', '--index-info', input=b''.join(
            (base_tree[name][0]+' '+head_tree[name][1]+'\t'+name).encode('utf8')+b'\0' for name in mode_fixes))
    migration_head = before['head']
    if mode_fixes:
        normalized_tree = git(stage, 'write-tree').decode().strip()
        migration_head = git(stage, 'commit-tree', normalized_tree, '-p', before['head'], '-m',
            'Normalize inherited bind-mount file modes; preserve original candidate history').decode().strip()
        git(stage, 'update-ref', 'refs/heads/'+cfg['branch'], migration_head)
        git(stage, 'read-tree', migration_head)
    for entry in before['files']:
        dest = safe(stage / entry['path'], stage)
        if entry.get('missing'):
            dest.unlink(missing_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(blobs[entry['path']])
    splits = []
    for name, expected in checks.items():
        require(name in blobs, 'approved_test_deleted')
        if sha(blobs[name]) == expected: continue
        require(name in SPLITS, 'changed_fixed_test_requires_manual_review')
        new_name = SPLITS[name]; require(not (stage / new_name).exists(), 'regression_destination_exists')
        base = git(original, 'show', cfg['baseCommit']+':'+name)
        generated, details = split_additive_tests(base, blobs[name], Path(name).stem)
        (stage / new_name).write_bytes(generated); (stage / name).write_bytes(base)
        splits.append({'source': name, 'destination': new_name, 'originalSha256': sha(blobs[name]),
                       'approvedSha256': expected, 'regressionSha256': sha(generated), **details})
    after_original, _ = capture(original)
    require(after_original == before and (ROOT / CONFIG).read_bytes() == cfg_raw, 'original_changed_during_prepare')
    prepared, captured = capture(stage)
    require(prepared['branch'] == cfg['branch'] and prepared['refs'] ==
            before['refs'] | {'refs/heads/'+cfg['branch']:migration_head}, 'migration_changed_unrelated_refs')
    normalized = tree(stage, 'HEAD')
    changed = []
    for name in base_tree.keys() | captured.keys():
        if name not in captured: changed.append(name); continue
        mode = normalized[name][0] if name in normalized else '100644'
        oid = hashlib.sha1(b'blob '+str(len(captured[name])).encode()+b'\0'+captured[name]).hexdigest()
        if base_tree.get(name) != (mode,oid): changed.append(name)
    require(all(any(name==p or p.endswith('/') and name.startswith(p) for p in COVERAGE) for name in changed), 'unreviewed_source_outside_migration_plan')
    proposed = proposed_config(cfg)
    snapshot = folder / 'snapshot' / 'source'; snapshot.mkdir(parents=True)
    for name, data in captured.items():
        dest = safe(snapshot / name, snapshot); dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
    snapshot_manifest = [{'path': name, 'sha256': sha(data)} for name,data in sorted(captured.items())]
    report = {'schema': 1, 'id': ident, 'prepared': True, 'applied': False, 'source': before,
        'originalConfigSha256': sha(cfg_raw), 'originalConfig': cfg, 'proposedConfig': proposed,
        'preparedSource': prepared, 'snapshotManifest': snapshot_manifest, 'snapshotSha256': sha(canonical(snapshot_manifest)),
        'originalHead': before['head'], 'migrationHead': migration_head, 'modeFixes': mode_fixes,
        'splits': splits, 'changedPaths': sorted(changed), 'image': IMAGE,
        'historyRewritten': False, 'approvedChecksChanged': False, 'productionMutations': 0}
    verify_snapshot_contract(report)
    if unknown_review is not None:
        entries, record_bytes = engineering_records()
        review_raw = Path(unknown_review).read_bytes()
        review_unknown(entries, record_bytes, json.loads(review_raw))
        (folder/'unknown-review.json').write_bytes(review_raw)
        report.update(engineeringRecords=entries, unknownReviewSha256=sha(review_raw))
    save(folder / 'proposal.json', report)
    return {'ok': True, 'folder': str(folder), 'modeFixes': len(mode_fixes), 'splits': splits,
            'changedPaths': sorted(changed), 'productionMutations': 0}


def committed_files(repo, ref):
    """Read blobs without checking out attributes, filters, hooks or candidate code."""
    entries = tree(repo, ref)
    objects = list(dict.fromkeys(oid for mode, oid in entries.values()))
    raw = git(repo, 'cat-file', '--batch', input=('\n'.join(objects) + '\n').encode()) if objects else b''
    contents, offset = {}, 0
    require(len(raw) <= 130 * 1024 * 1024, 'candidate_byte_limit')
    for oid in objects:
        end = raw.index(b'\n', offset)
        header = raw[offset:end].decode().split()
        require(header[:2] == [oid, 'blob'], 'invalid_source_blob')
        size = int(header[2]); offset = end + 1
        contents[oid] = raw[offset:offset+size]; offset += size + 1
    for name in entries:
        require('\\' not in name and ':' not in name and not name.startswith('/')
                and all(part not in ('', '.', '..', '.git') for part in name.split('/')), 'invalid_source_path')
    return {name: (mode, contents[oid]) for name, (mode, oid) in entries.items()}


def merge_files(base, ours, incoming, folder):
    """Conservative three-way merge. No rename guessing or custom merge drivers."""
    merged, conflicts = {}, []
    for name in sorted(base.keys() | ours.keys() | incoming.keys()):
        old, local, new = base.get(name), ours.get(name), incoming.get(name)
        if local == old: value = new
        elif new == old or local == new: value = local
        elif old is None or local is None or new is None:
            conflicts.append(name); continue
        else:
            if any(b'\0' in item[1] for item in (old, local, new)):
                conflicts.append(name); continue
            mode = new[0] if local[0] == old[0] else local[0]
            with tempfile.TemporaryDirectory(prefix='merge-', dir=folder) as temporary:
                paths = [Path(temporary) / value for value in ('local', 'base', 'incoming')]
                for path, data in zip(paths, (local[1], old[1], new[1])): path.write_bytes(data)
                result = subprocess.run(['git', '-c', 'core.attributesFile='+os.devnull,
                    'merge-file', '--stdout', *map(str, paths)], capture_output=True, timeout=30)
            if result.returncode != 0:
                conflicts.append(name); continue
            value = mode, result.stdout
        if value is not None: merged[name] = value
    for name in merged:
        parents = name.split('/')[:-1]
        for index in range(1, len(parents)+1):
            parent = '/'.join(parents[:index])
            if parent in merged: conflicts.extend((parent, name))
    return merged, sorted(set(conflicts))


def create_integration_commit(stage, baseline, merged, previous, new_base):
    git(stage, 'read-tree', new_base)
    updates = []
    for name in sorted(baseline.keys() | merged.keys()):
        if baseline.get(name) == merged.get(name): continue
        if name not in merged: updates.append(('0 ' + '0'*40 + '\t' + name + '\0').encode()); continue
        mode, data = merged[name]
        oid = git(stage, 'hash-object', '-w', '--stdin', input=data).decode().strip()
        updates.append((mode+' '+oid+'\t'+name+'\0').encode())
    if updates: git(stage, 'update-index', '-z', '--index-info', input=b''.join(updates))
    tree_id = git(stage, 'write-tree').decode().strip()
    parents = ['-p', previous] + ([] if previous == new_base else ['-p', new_base])
    return git(stage, '-c', 'commit.gpgSign=false', 'commit-tree', tree_id, *parents,
               '-m', 'Integrate reviewed engineering baseline; retain prior candidate history').decode().strip()


def upgrade_config(cfg, stage, commit):
    from run_embodied_engineering_checks import TEAM_PREFIXES, EMBODIED_MODULES, FIXTURES
    files = committed_files(stage, commit)
    old_checks = {name for plan in cfg['plans'] for name in plan['checks']}
    team_names = {name for name in files if name.startswith('tests/') and name.endswith('.py')
                  and Path(name).stem.startswith(TEAM_PREFIXES)}
    team_names |= old_checks | {CHECK_RUNNER}
    embodied_names = team_names | {'tests/'+name+'.py' for name in (*EMBODIED_MODULES, *FIXTURES)}
    require(embodied_names <= files.keys(), 'upgrade_required_check_missing')
    def helpers(names):
        pending, found = list(names), set(names)
        while pending:
            name = pending.pop()
            if not name.endswith('.py'): continue
            for node in ast.walk(ast.parse(files[name][1])):
                imports = ([alias.name for alias in node.names] if isinstance(node,ast.Import)
                           else [node.module or ''] if isinstance(node,ast.ImportFrom) else [])
                for module in imports:
                    dependency = 'tests/'+module.removeprefix('tests.').split('.')[0]+'.py'
                    if dependency in files and dependency not in found:
                        found.add(dependency); pending.append(dependency)
        return found
    team_names, embodied_names = helpers(team_names), helpers(embodied_names)
    def plan(ident, names, coverage, args):
        return {'id':ident, 'image':IMAGE, 'argv':['python', '-B', CHECK_RUNNER, *args],
                'coverage':coverage, 'checks':{name:sha(files[name][1]) for name in sorted(names)},
                'timeoutSeconds':180}
    return cfg | {'baseCommit':commit, 'plans':[
        plan('team-guild-admin-python', team_names, COVERAGE, ['--suite', 'team']),
        plan('embodied-team-python', embodied_names, EMBODIED_COVERAGE, [])]}


def engineering_records():
    root = safe(ROOT / 'server/engineering')
    entries, blobs = [], {}
    for section in ('requests', 'receipts', 'state'):
        folder = safe(root / section)
        for path in sorted(folder.rglob('*')):
            safe(path)
            if not path.is_file(): continue
            name = path.relative_to(root).as_posix()
            if name in ('state/workspace.lock', 'receipts/_runner.json'): continue
            raw = path.read_bytes()
            require(len(raw) <= 16*1024*1024, 'engineering_record_too_large')
            entries.append({'path':name, 'sha256':sha(raw), 'size':len(raw)}); blobs[name] = raw
    return entries, blobs


def review_unknown(entries, blobs, review):
    unknown = []
    for item in entries:
        name = item['path']
        if name.startswith('state/commit-') and name.endswith('.json'):
            value = json.loads(blobs[name])
            if value.get('status') == 'unknown':
                unknown.append({'path':name, 'sha256':item['sha256'],
                                'resolution':'archived_unresolved_no_replay'})
    expected = {'schema':1, 'entries':unknown}
    require(isinstance(review,dict) and set(review) == {'schema','entries'} and review.get('schema') == 1
            and isinstance(review.get('entries'),list)
            and sorted(review['entries'],key=lambda item:item.get('path','')) == unknown,
            'unknown_commit_review_required_or_changed')
    return expected


def engineering_idle():
    root = safe(ROOT / 'server/engineering')
    runner = json.loads(safe(root/'receipts/_runner.json').read_bytes())
    require(runner.get('enabled') is True and runner.get('busy') is False and runner.get('error') is None
            and type(runner.get('updatedAt')) in (int,float)
            and -5 <= time.time() - runner['updatedAt']/1000 <= 120, 'engineering_runner_not_idle')
    entries, blobs = engineering_records()
    for name, raw in blobs.items():
        if name.startswith('receipts/'):
            require(json.loads(raw).get('status') in ('passed','failed','rejected','cancelled'),
                    'engineering_test_unresolved')
        elif name.startswith('requests/'):
            receipt_name = 'receipts/' + name.removeprefix('requests/')
            require(receipt_name in blobs, 'engineering_test_queued')
            request, receipt = json.loads(raw), json.loads(blobs[receipt_name])
            require(request.get('jobId') == Path(name).stem and all(
                receipt.get(key) == request.get(key) for key in ('jobId','sourceSha256','planSha256')),
                'engineering_receipt_mismatch')
    return entries, blobs


def prepare_upgrade(source_repo, source_ref, unknown_review=None):
    source_repo = safe(Path(source_repo), Path(source_repo).resolve())
    require(Path(git(source_repo, 'rev-parse', '--show-toplevel').decode().strip()).resolve() == source_repo,
            'upgrade_source_root_required')
    require(isinstance(source_ref,str) and source_ref and not source_ref.startswith('-'), 'upgrade_ref_required')
    new_base = git(source_repo, 'rev-parse', '--verify', '--end-of-options', source_ref+'^{commit}').decode().strip()
    original = safe(ROOT / REPO); cfg_raw = safe(ROOT / CONFIG).read_bytes(); cfg = json.loads(cfg_raw)
    before, working = capture(original)
    require(before['branch'] == cfg['branch'], 'original_branch_changed')
    old_base = committed_files(original, cfg['baseCommit'])
    old_head = committed_files(original, before['head'])
    for plan in cfg['plans']:
        for name, digest in plan['checks'].items():
            require(name in old_base and sha(old_base[name][1]) == digest, 'approved_check_not_committed_base')
    entries, record_bytes = engineering_records()
    review_raw = Path(unknown_review).read_bytes() if unknown_review else canonical({'schema':1,'entries':[]})
    review = review_unknown(entries, record_bytes, json.loads(review_raw))
    ident = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]
    folder = safe(ROOT/'runtime'/('engineering-recovery-'+ident)); folder.mkdir(parents=True)
    stage = folder/'repo'
    clone_preserving_refs(original, stage, before['refs'], checkout=False)
    git(stage, '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', '--no-write-fetch-head',
        str(source_repo), new_base)
    git(stage, 'merge-base', '--is-ancestor', cfg['baseCommit'], new_base)
    git(stage, 'merge-base', '--is-ancestor', cfg['baseCommit'], before['head'])
    # The approved baseline governs fixed checks, not branch ancestry. Engineer
    # commits may already have been merged and corrected in the trusted target;
    # replaying them from that older baseline would conflict or revive old code.
    merge_bases = git(stage, 'merge-base', '--all', before['head'], new_base).decode().splitlines()
    require(len(merge_bases) == 1, 'upgrade_ambiguous_merge_base')
    common = committed_files(stage, merge_bases[0])
    incoming = committed_files(stage, new_base)
    committed, conflicts = merge_files(common, old_head, incoming, folder)
    phase = 'committed'
    combined = {}
    if not conflicts:
        dirty = {name:(old_head.get(name, ('100644',))[0],data) for name,data in working.items()}
        combined, conflicts = merge_files(old_head, dirty, committed, folder); phase = 'working_tree'
    if conflicts:
        report = {'schema':1,'mode':'upgrade','prepared':False,'applied':False,'conflicts':conflicts,
                  'conflictPhase':phase,'source':before,'targetCommit':new_base,'productionMutations':0}
        save(folder/'conflicts.json', report)
        return {'ok':False,'folder':str(folder),**report}
    proposed = upgrade_config(cfg, stage, new_base)
    migration_head = create_integration_commit(stage, incoming, committed, before['head'], new_base)
    git(stage, 'update-ref', 'refs/heads/'+cfg['branch'], migration_head, before['head'])
    for name, (mode,data) in combined.items():
        path = safe(stage/name, stage); path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
        path.chmod(0o755 if mode == '100755' else 0o644)
    prepared, captured = capture(stage)
    require(set(captured) == set(combined), 'upgrade_new_ignore_hides_original_files')
    require(all(captured[name] == data for name,(mode,data) in combined.items()), 'upgrade_working_bytes_changed')
    require(capture(original)[0] == before and safe(ROOT/CONFIG).read_bytes() == cfg_raw
            and engineering_records()[0] == entries, 'original_changed_during_prepare')
    changed = sorted(name for name in incoming.keys() | combined.keys() if incoming.get(name) != combined.get(name))
    require(all(any(name == prefix or prefix.endswith('/') and name.startswith(prefix)
                    for prefix in EMBODIED_COVERAGE) for name in changed), 'unreviewed_source_outside_migration_plan')
    snapshot = folder/'snapshot/source'; snapshot.mkdir(parents=True)
    for name,data in captured.items():
        path = safe(snapshot/name,snapshot); path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
    manifest = [{'path':name,'sha256':sha(data)} for name,data in sorted(captured.items())]
    (folder/'unknown-review.json').write_bytes(review_raw)
    report = {'schema':2,'mode':'upgrade','id':ident,'prepared':True,'applied':False,
        'source':before,'preparedSource':prepared,'originalConfig':cfg,'originalConfigSha256':sha(cfg_raw),
        'proposedConfig':proposed,'originalHead':before['head'],'migrationHead':migration_head,
        'targetCommit':new_base,'sourceRepository':str(source_repo),'requestedRef':source_ref,
        'snapshotManifest':manifest,'snapshotSha256':sha(canonical(manifest)), 'changedPaths':changed,
        'image':IMAGE,'historyRewritten':False,'approvedChecksChanged':True,'productionMutations':0,
        'fixedChecksRebasedFromTrustedCommit':True,'engineeringRecords':entries,'unknownReviewSha256':sha(review_raw)}
    verify_snapshot_contract(report)
    save(folder/'proposal.json',report)
    return {'ok':True,'folder':str(folder),'targetCommit':new_base,'changedPaths':changed,
            'reviewedUnknownCommits':len(review['entries']),'productionMutations':0}


def load(folder):
    folder = safe(folder); require(folder.parent == ROOT / 'runtime' and folder.name.startswith('engineering-recovery-'), 'wrong_migration_folder')
    report = json.loads((folder / 'proposal.json').read_text('utf8'))
    upgrade = report.get('mode') == 'upgrade'
    expected_config = (upgrade_config(report['originalConfig'], folder/'repo', report['targetCommit'])
                       if upgrade else proposed_config(report['originalConfig']))
    require(report['schema'] == (2 if upgrade else 1) and report['image'] == IMAGE
            and report['proposedConfig'] == expected_config,
            'migration_contract_changed')
    require(report['source']['branch'] == report['originalConfig']['branch']
        and report['preparedSource']['branch'] == report['originalConfig']['branch']
        and report['preparedSource']['refs'] == report['source']['refs'] |
            {'refs/heads/'+report['originalConfig']['branch']:report['migrationHead']}, 'migration_refs_changed')
    require(capture(folder / 'repo')[0] == report['preparedSource'], 'prepared_checkout_changed')
    verify_snapshot_contract(report)
    for plan in report['proposedConfig']['plans']:
        for name, digest in plan['checks'].items():
            require(sha(git(folder/'repo', 'show', report['proposedConfig']['baseCommit']+':'+name)) == digest,
                    'approved_check_not_committed_base')
    if upgrade:
        require(sha((folder/'unknown-review.json').read_bytes()) == report['unknownReviewSha256'], 'unknown_review_changed')
        git(folder/'repo', 'merge-base', '--is-ancestor', report['originalHead'], report['migrationHead'])
        git(folder/'repo', 'merge-base', '--is-ancestor', report['targetCommit'], report['migrationHead'])
    snapshot_root = safe(folder / 'snapshot/source')
    require(sorted(p.relative_to(snapshot_root).as_posix() for p in snapshot_root.rglob('*') if p.is_file())
            == sorted(row['path'] for row in report['snapshotManifest']), 'snapshot_file_set_changed')
    require(sha(canonical(report['snapshotManifest'])) == report['snapshotSha256'], 'snapshot_manifest_changed')
    for entry in report['snapshotManifest']:
        require(sha(safe(folder / 'snapshot/source' / entry['path'], folder / 'snapshot/source').read_bytes()) == entry['sha256'], 'snapshot_changed')
    return folder, report


def test(folder):
    folder, proposal = load(folder)
    if proposal.get('mode') == 'upgrade':
        outputs, receipts, offset = [], [], 0
        for index, plan in enumerate(proposal['proposedConfig']['plans']):
            output, code = run_test_plan(folder, proposal, plan, index)
            receipts.append({'planId':plan['id'],'planSha256':sha(canonical(plan)),
                'image':plan['image'],'argv':plan['argv'],'exitCode':code,
                'status':'passed' if code == 0 else 'failed', 'outputOffset':offset,
                'outputSize':len(output),'outputSha256':sha(output)})
            outputs.append(output); offset += len(output)
        output = b''.join(outputs)
        (folder/'test-output.txt').write_bytes(output)
        receipt = {'schema':2,'plans':receipts,'snapshotSha256':proposal['snapshotSha256'],
                   'outputSha256':sha(output),'status':'passed' if all(row['exitCode'] == 0 for row in receipts) else 'failed',
                   'productionMutations':0}
        save(folder/'test-result.json',receipt)
        return receipt | {'output':str(folder/'test-output.txt')}
    name = 'qd-engineering-review-'+proposal['id'].lower()
    require(run(['docker', 'image', 'inspect', IMAGE, '--format', '{{.Id}}']).decode().strip() == IMAGE, 'fixed_test_image_unavailable')
    args = ['docker', 'run', '--rm', '--name', name, '--label', 'qd.engineering-migration='+proposal['id'],
        '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '128', '--memory', '2g', '--cpus', '2', '--user', '65534:65534',
        '--tmpfs', '/tmp:rw,size=1g,mode=1777', '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'HOME=/tmp',
        '--mount', 'type=bind,source='+str(folder/'snapshot/source')+',target=/source,readonly',
        '--workdir', '/source', '--entrypoint', ARGV[0], IMAGE, *ARGV[1:]]
    try:
        result = subprocess.run(args, capture_output=True, timeout=210)
        exit_code, output = result.returncode, result.stdout+result.stderr
    except subprocess.TimeoutExpired as error:
        exit_code, output = None, (error.stdout or b'')+(error.stderr or b'')
        # Only the exact named/labeled isolated runner may be terminated.
        info = subprocess.run(['docker', 'inspect', name], capture_output=True)
        if info.returncode == 0:
            item = json.loads(info.stdout)[0]
            require(item['Config']['Labels'].get('qd.engineering-migration') == proposal['id'], 'runner_identity_changed')
            run(['docker', 'rm', '-f', item['Id']])
    (folder/'test-output.txt').write_bytes(output)
    receipt = {'schema': 1, 'status': 'passed' if exit_code == 0 else 'failed', 'exitCode': exit_code,
        'image': IMAGE, 'argv': ARGV, 'snapshotSha256': proposal['snapshotSha256'],
        'outputSha256': sha(output), 'productionMutations': 0}
    save(folder/'test-result.json', receipt)
    return receipt | {'output': str(folder/'test-output.txt')}


def run_test_plan(folder, proposal, plan, index):
    name = 'qd-engineering-review-'+proposal['id'].lower()+'-'+str(index)
    require(run(['docker','image','inspect',IMAGE,'--format','{{.Id}}']).decode().strip() == IMAGE,
            'fixed_test_image_unavailable')
    args = ['docker','run','--rm','--name',name,'--label','qd.engineering-migration='+proposal['id'],
        '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
        '--pids-limit','64','--memory','512m','--memory-swap','512m','--cpus','1','--user','65534:65534',
        '--init','--ulimit','nofile=256:256','--log-opt','max-size=1m','--log-opt','max-file=1',
        '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
        '--env','PYTHONDONTWRITEBYTECODE=1','--env','HOME=/tmp','--env','TMPDIR=/tmp',
        '--env','PYTHONNOUSERSITE=1','--env','PYTHONPATH=','--env','NODE_OPTIONS=',
        '--mount','type=bind,source='+str(folder/'snapshot/source')+',target=/workspace,readonly',
        '--workdir','/workspace','--entrypoint',plan['argv'][0],plan['image'],*plan['argv'][1:]]
    try:
        result = subprocess.run(args,capture_output=True,timeout=plan['timeoutSeconds'])
        return result.stdout+result.stderr, result.returncode
    except subprocess.TimeoutExpired as error:
        info = subprocess.run(['docker','inspect',name],capture_output=True)
        if info.returncode == 0:
            item = json.loads(info.stdout)[0]
            require(item['Config']['Labels'].get('qd.engineering-migration') == proposal['id'], 'runner_identity_changed')
            run(['docker','rm','-f',item['Id']])
        return (error.stdout or b'')+(error.stderr or b''), None


def native_request(route, method='GET', payload=None):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): raise ValueError('native_redirect_refused')
    request = urllib.request.Request('http://127.0.0.1:18089/api'+route, method=method,
        headers={'X-Agent-Id':'qd-engineer','Content-Type':'application/json'},
        data=None if payload is None else canonical(payload))
    with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=30) as response:
        return json.load(response)


def native_idle():
    jobs = native_request('/cron/jobs'); require(isinstance(jobs,list) and jobs, 'native_jobs_unavailable')
    require(all(j.get('enabled') is False for j in jobs), 'engineer_crons_must_be_paused')
    states = [native_request('/cron/jobs/'+j['id']+'/state') for j in jobs]
    require(all(s.get('last_status') != 'running' for s in states), 'native_cron_running')
    active = native_request('/agents/qd-engineer/agent-status')
    require(active.get('status') == 'idle' and active.get('running_task_count') == 0, 'engineer_not_idle')
    return {'jobs': [{'id':j['id'],'enabled':j['enabled']} for j in jobs], 'active': active}


def paused_jobs():
    path = safe(ROOT/'server/agents/work/workspaces/qd-engineer/jobs.json')
    raw = path.read_bytes(); value = json.loads(raw)
    jobs = value.get('jobs')
    require(isinstance(jobs,list) and jobs and all(row.get('enabled') is False for row in jobs),
            'engineer_crons_must_be_paused')
    return sha(raw), [{'id':row['id'],'enabled':False} for row in jobs]


def native_quiescent(folder):
    proof = json.loads(safe(folder/'quiesce.json').read_bytes())
    require(proof.get('status') == 'quiesced'
            and proof.get('proposalSha256') == sha((folder/'proposal.json').read_bytes())
            and proof.get('jobsSha256') == paused_jobs()[0]
            and proof.get('toggleReceipt') == {'success':True,'agent_id':'qd-engineer','enabled':False},
            'engineering_quiesce_proof_required')
    # Native disabled status alone bypasses task tracking. The successful toggle
    # receipt above certifies await stop_agent(), after the earlier idle check.
    current = native_request('/agents/qd-engineer/agent-status')
    require(current.get('status') == 'disabled' and current.get('running_task_count') == 0,
            'engineer_admission_must_be_disabled')
    return proof


def quiesce(folder):
    folder, report = load(folder)
    require(report.get('mode') == 'upgrade', 'quiesce_requires_upgrade')
    path = safe(folder/'quiesce.json')
    if path.exists(): return native_quiescent(folder)  # Unknown attempts are never retried.
    checkpoint = native_idle()
    jobs_sha, jobs = paused_jobs()
    require(sorted(jobs,key=lambda row:row['id']) == sorted(checkpoint['jobs'],key=lambda row:row['id']),
            'native_job_file_mismatch')
    proof = {'schema':1,'status':'unknown','proposalSha256':sha((folder/'proposal.json').read_bytes()),
             'jobsSha256':jobs_sha,'before':checkpoint,'startedAt':time.time(),'automaticRetry':False}
    save(path,proof)
    receipt = native_request('/agents/qd-engineer/toggle','PATCH',{'enabled':False})
    require(receipt == {'success':True,'agent_id':'qd-engineer','enabled':False}, 'native_toggle_unverified')
    proof.update(status='quiesced',toggleReceipt=receipt,finishedAt=time.time())
    save(path,proof)
    return native_quiescent(folder)


def apply(folder):
    folder, proposal = load(folder)
    receipt = json.loads((folder/'test-result.json').read_text('utf8'))
    acceptance = completed_test_receipt(proposal, receipt, (folder/'test-output.txt').read_bytes())
    upgrade = proposal.get('mode') == 'upgrade'
    if upgrade: require(acceptance == 'passed', 'upgrade_fixed_checks_not_passed')
    original = safe(ROOT / REPO); config = safe(ROOT / CONFIG)
    require(capture(original)[0] == proposal['source'] and sha(config.read_bytes()) == proposal['originalConfigSha256']
            and json.loads(config.read_bytes()) == proposal['originalConfig'], 'production_candidate_changed')
    checkpoint = native_quiescent(folder) if upgrade else native_idle()
    records, record_bytes = engineering_idle()
    review_raw = ((folder/'unknown-review.json').read_bytes() if 'unknownReviewSha256' in proposal
                  else canonical({'schema':1,'entries':[]}))
    if 'unknownReviewSha256' in proposal:
        require(sha(review_raw) == proposal['unknownReviewSha256'], 'unknown_review_changed')
        require(records == proposal['engineeringRecords'], 'engineering_records_changed')
    review_unknown(records,record_bytes,json.loads(review_raw))
    lock = safe(ROOT/'server/engineering/state/workspace.lock')
    with lock.open('x', encoding='ascii') as stream:
        stream.write('maintenance:'+proposal['id']); stream.flush(); os.fsync(stream.fileno())
    # No auto-resume and no uncertain retry. A partial rename remains reviewable in this journal.
    audit = {'schema':1, 'migration':proposal['id'], 'phase':'verified', 'native':checkpoint, 'applied':False,
             'candidateAcceptance':acceptance, 'businessCodeDeployed':False,
             'businessAcceptanceGatesChanged':False}
    backup = safe(ROOT/'server/engineering/migrations'/proposal['id'])
    try:
        require(not backup.exists(), 'migration_already_started')
        backup.mkdir(parents=True); (backup/'config-before.json').write_bytes(config.read_bytes())
        save(backup/'proposal.json', proposal); save(backup/'apply.json', audit)
        for name in ('test-result.json', 'test-output.txt'):
            (backup/name).write_bytes((folder/name).read_bytes())
        (backup/'unknown-review.json').write_bytes(review_raw)
        for name, raw in record_bytes.items():
            dest = safe(backup/'records'/name); dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(raw)
        require(capture(original)[0] == proposal['source'], 'candidate_changed_at_apply')
        require(sha(config.read_bytes()) == proposal['originalConfigSha256']
                and capture(folder/'repo')[0] == proposal['preparedSource'], 'candidate_changed_at_apply')
        if upgrade: native_quiescent(folder)
        else: native_idle()
        require(engineering_idle()[0] == records, 'engineering_records_changed')
        original.rename(safe(backup/'original-repo'))
        audit['phase']='original_archived'; save(backup/'apply.json',audit)
        safe(folder/'repo').rename(original)
        audit['phase']='candidate_installed'; save(backup/'apply.json',audit)
        save(config, proposal['proposedConfig'])
        require(capture(original)[0] == proposal['preparedSource'], 'installed_candidate_mismatch')
        audit.update(phase='complete',applied=True,historyRewritten=False,approvedChecksChanged=upgrade,
                     fixedChecksRebasedFromTrustedCommit=upgrade,
                     oldReceiptsPreserved=True,cronsRemainPaused=True)
        save(backup/'apply.json',audit)
        return audit | {'backup':str(backup)}
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--prepare',action='store_true'); group.add_argument('--test',type=Path); group.add_argument('--apply',type=Path)
    group.add_argument('--quiesce',type=Path)
    parser.add_argument('--upgrade-source',type=Path)
    parser.add_argument('--upgrade-ref')
    parser.add_argument('--unknown-review',type=Path)
    args=parser.parse_args()
    if (args.upgrade_source or args.upgrade_ref) and not (args.prepare and args.upgrade_source and args.upgrade_ref):
        parser.error('--upgrade-source and --upgrade-ref require --prepare together')
    if args.unknown_review and not args.prepare: parser.error('--unknown-review requires --prepare')
    result=(prepare_upgrade(args.upgrade_source,args.upgrade_ref,args.unknown_review) if args.upgrade_source
            else prepare(args.unknown_review) if args.prepare else test(args.test) if args.test
            else quiesce(args.quiesce) if args.quiesce else apply(args.apply))
    print(json.dumps(result,ensure_ascii=True))
