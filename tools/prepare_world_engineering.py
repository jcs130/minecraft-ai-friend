"""Prepare a standalone source clone and fixed test plans for the existing engineer.

No models or deployment. Never reset an existing engineer checkout; a future
base upgrade must preserve and review its local work separately.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def run(args, cwd=ROOT):
    value = subprocess.run(args, cwd=cwd, capture_output=True, encoding='utf-8', timeout=120,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if value.returncode: raise RuntimeError(value.stderr[-1800:])
    return value.stdout.strip()


def prepare(apply=False):
    root = ROOT / 'server/engineering'
    repo = ROOT / 'server/operations-agent-state/work/workspaces/mc-god/engineering/repo'
    if (root / 'config.json').exists():
        cfg = json.loads((root / 'config.json').read_text(encoding='utf-8'))
        assert (repo / '.git').is_dir() and cfg['repo'] == '/state/work/workspaces/mc-god/engineering/repo'
        return {'ok': True, 'alreadyPrepared': True, 'baseCommit': cfg['baseCommit'], 'reset': False}
    base = run(['git', 'rev-parse', 'HEAD'])
    def committed_sha(name):
        data = subprocess.check_output(['git', 'show', base + ':' + name], cwd=ROOT, timeout=20)
        return hashlib.sha256(data).hexdigest()
    image = run(['docker', 'inspect', '--format', '{{.Image}}', 'qiandengji-qwenpaw-ops-1'])
    tests = ['tests/test_world_team.py', 'tests/test_world_team_schedule.py']
    content_tests = ['tests/test_world_content.py']
    plans = [
        {'id': 'team-python', 'image': image,
         'argv': ['python', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_world_team*.py', '-v'],
         'coverage': ['world/ops/world_team.py', 'world/ops/world_team_mcp.py',
                      'world/ops/world_team_schedule.py', 'world/ops/world_team_profiles.py', 'docs/', 'tests/'],
         'checks': {p: committed_sha(p) for p in tests + ['tests/test_world_team_health.py']},
         'timeoutSeconds': 180},
        {'id': 'guild-python', 'image': image,
         'argv': ['python', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_world_content.py', '-v'],
         'coverage': ['world/sidecar/mc_guild.py', 'world/sidecar/world_content.py', 'world/ops/world_content_tools.py', 'docs/', 'tests/'],
         'checks': {p: committed_sha(p) for p in content_tests},
         'timeoutSeconds': 180},
    ]
    config = {'schema': 1, 'enabled': True, 'role': 'mc-god', 'baseCommit': base,
              'branch': 'codex/ops-world-improvements', 'repo': '/state/work/workspaces/mc-god/engineering/repo',
              'snapshotHostRoot': '/run/desktop/mnt/host/d/Projects/QiandengJi/server/engineering/snapshots', 'plans': plans}
    if apply:
        assert not repo.exists(), 'existing_engineering_source_preserved'
        repo.parent.mkdir(parents=True, exist_ok=True)
        run(['git', '-c', 'core.autocrlf=false', 'clone', '--no-hardlinks', '--no-local', str(ROOT), str(repo)])
        run(['git', '-C', str(repo), 'config', 'core.autocrlf', 'false'])
        run(['git', '-C', str(repo), 'remote', 'remove', 'origin'])
        run(['git', '-C', str(repo), 'switch', '-c', config['branch'], base])
        # baseline hashes refer to committed bytes, never uncommitted host edits.
        for plan in plans:
            for name, sha in plan['checks'].items():
                assert hashlib.sha256((repo / name).read_bytes()).hexdigest() == sha, 'uncommitted_baseline_check'
        for name in ('requests', 'snapshots', 'receipts', 'state'):
            (root / name).mkdir(parents=True, exist_ok=True)
        (ROOT / 'server/team-state').mkdir(parents=True, exist_ok=True)
        (root / 'config.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'ok': True, 'apply': apply, 'baseCommit': base, 'testPlans': [p['id'] for p in plans], 'source': str(repo)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    print(json.dumps(prepare(parser.parse_args().apply), ensure_ascii=False))
