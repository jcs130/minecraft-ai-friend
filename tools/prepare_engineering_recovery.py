"""Reviewable recovery of the existing engineering checkout, never a baseline reset.

Prepare and test only write an isolated runtime directory. Apply requires every
engineer Cron paused, the native role idle, unchanged original/candidate bytes,
and a completed receipt from the fixed isolated command below. A failing test
restores a testable candidate, never approves its business changes for commit.
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
import textwrap
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


def safe(path, root=ROOT):
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


def clone_preserving_refs(original, stage, refs):
    run(['git', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath='+os.devnull,
         'clone', '--no-local', '--no-hardlinks', str(original), str(stage)])
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
    captured = {'head': head, 'branch': branch, 'refs': refs, 'files': manifest}
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
    checks = report['proposedConfig']['plans'][0]['checks']
    require(all(hashes.get(name) == digest for name,digest in checks.items()), 'approved_check_bytes_changed')


def completed_test_receipt(report, receipt, output):
    code = receipt.get('exitCode')
    require(type(code) is int and code in (0, 1), 'candidate_test_did_not_complete')
    require(receipt.get('status') == ('passed' if code == 0 else 'failed')
        and receipt.get('image') == IMAGE and receipt.get('argv') == ARGV
        and receipt.get('snapshotSha256') == report['snapshotSha256']
        and receipt.get('outputSha256') == sha(output), 'completed_candidate_test_required')
    return receipt['status']


def prepare():
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
    save(folder / 'proposal.json', report)
    return {'ok': True, 'folder': str(folder), 'modeFixes': len(mode_fixes), 'splits': splits,
            'changedPaths': sorted(changed), 'productionMutations': 0}


def load(folder):
    folder = safe(folder); require(folder.parent == ROOT / 'runtime' and folder.name.startswith('engineering-recovery-'), 'wrong_migration_folder')
    report = json.loads((folder / 'proposal.json').read_text('utf8'))
    require(report['schema'] == 1 and report['image'] == IMAGE
            and report['proposedConfig'] == proposed_config(report['originalConfig']),
            'migration_contract_changed')
    require(report['source']['branch'] == report['originalConfig']['branch']
        and report['preparedSource']['branch'] == report['originalConfig']['branch']
        and report['preparedSource']['refs'] == report['source']['refs'] |
            {'refs/heads/'+report['originalConfig']['branch']:report['migrationHead']}, 'migration_refs_changed')
    require(capture(folder / 'repo')[0] == report['preparedSource'], 'prepared_checkout_changed')
    verify_snapshot_contract(report)
    for name, digest in report['proposedConfig']['plans'][0]['checks'].items():
        require(sha(git(folder/'repo', 'show', report['originalConfig']['baseCommit']+':'+name)) == digest,
                'approved_check_not_committed_base')
    snapshot_root = safe(folder / 'snapshot/source')
    require(sorted(p.relative_to(snapshot_root).as_posix() for p in snapshot_root.rglob('*') if p.is_file())
            == sorted(row['path'] for row in report['snapshotManifest']), 'snapshot_file_set_changed')
    require(sha(canonical(report['snapshotManifest'])) == report['snapshotSha256'], 'snapshot_manifest_changed')
    for entry in report['snapshotManifest']:
        require(sha(safe(folder / 'snapshot/source' / entry['path'], folder / 'snapshot/source').read_bytes()) == entry['sha256'], 'snapshot_changed')
    return folder, report


def test(folder):
    folder, proposal = load(folder)
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


def native_idle():
    def get(route):
        request = urllib.request.Request('http://127.0.0.1:18089/api'+route, headers={'X-Agent-Id':'qd-engineer'})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
            return json.load(response)
    jobs = get('/cron/jobs'); require(isinstance(jobs,list) and jobs, 'native_jobs_unavailable')
    require(all(j.get('enabled') is False for j in jobs), 'engineer_crons_must_be_paused')
    states = [get('/cron/jobs/'+j['id']+'/state') for j in jobs]
    require(all(s.get('last_status') != 'running' for s in states), 'native_cron_running')
    active = get('/agents/qd-engineer/agent-status')
    require(active.get('status') == 'idle' and active.get('running_task_count') == 0, 'engineer_not_idle')
    return {'jobs': [{'id':j['id'],'enabled':j['enabled']} for j in jobs], 'active': active}


def apply(folder):
    folder, proposal = load(folder)
    receipt = json.loads((folder/'test-result.json').read_text('utf8'))
    acceptance = completed_test_receipt(proposal, receipt, (folder/'test-output.txt').read_bytes())
    original = safe(ROOT / REPO); config = safe(ROOT / CONFIG)
    require(capture(original)[0] == proposal['source'] and sha(config.read_bytes()) == proposal['originalConfigSha256']
            and json.loads(config.read_bytes()) == proposal['originalConfig'], 'production_candidate_changed')
    checkpoint = native_idle()
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
        require(capture(original)[0] == proposal['source'], 'candidate_changed_at_apply')
        native_idle()
        original.rename(safe(backup/'original-repo'))
        audit['phase']='original_archived'; save(backup/'apply.json',audit)
        safe(folder/'repo').rename(original)
        audit['phase']='candidate_installed'; save(backup/'apply.json',audit)
        save(config, proposal['proposedConfig'])
        require(capture(original)[0] == proposal['preparedSource'], 'installed_candidate_mismatch')
        audit.update(phase='complete',applied=True,historyRewritten=False,approvedChecksChanged=False,
                     oldReceiptsPreserved=True,cronsRemainPaused=True)
        save(backup/'apply.json',audit)
        return audit | {'backup':str(backup)}
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--prepare',action='store_true'); group.add_argument('--test',type=Path); group.add_argument('--apply',type=Path)
    args=parser.parse_args()
    result=prepare() if args.prepare else test(args.test) if args.test else apply(args.apply)
    print(json.dumps(result,ensure_ascii=True))
