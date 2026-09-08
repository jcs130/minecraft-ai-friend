"""Offline role skill sync; never stops/starts production or mounts secret directories."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'game': ('qiandengji-qwenpaw-1', 'qwenpaw', 'server/agents/work', 'qiandengji'),
           'operations': ('qiandengji-qwenpaw-ops-1', 'qwenpaw-ops', 'server/operations-agent-state/work', 'qiandengji-ops')}


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('offline_learning_sync_failed: ' + result.stderr[-1500:])
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True, choices=tuple(TARGETS))
    parser.add_argument('--execute', choices=['qiandengji', 'qiandengji-ops'])
    parser.add_argument('--image', help='Already-local reviewed Qwen 2.2 image; never pulled')
    args = parser.parse_args()
    container, service, relative, project = TARGETS[args.runtime]
    metadata = json.loads(command(['docker', 'inspect', container]))[0]
    labels = metadata['Config']['Labels']
    assert labels.get('com.docker.compose.project') == 'qiandengji' and labels.get('com.docker.compose.service') == service
    if args.execute:
        assert args.execute == project and metadata['State']['Running'] is False, 'exact Qwen runtime must be stopped first'
    state = (ROOT / relative).resolve()
    assert state.is_relative_to(ROOT.resolve()) and state.is_dir() and not state.is_symlink()
    mode = '' if args.execute else ',readonly'
    invocation = ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
        '--env', 'HOME=/tmp/qiandeng-learning-home', '--env', 'QWENPAW_WORKING_DIR=/state/work',
        '--mount', f'type=bind,source={state},target=/state/work{mode}',
        '--mount', f'type=bind,source={ROOT / "world/ops"},target=/ops,readonly',
        '--entrypoint', 'python', args.image or metadata['Image'], '/ops/sync_role_learning.py', '--runtime', args.runtime]
    if args.runtime == 'game':
        manifest = ROOT / 'server/mcdata/village/maid-agents/public/roles.json'
        assert manifest.is_file() and not manifest.is_symlink()
        invocation[invocation.index('--entrypoint'):invocation.index('--entrypoint')] = [
            '--mount', f'type=bind,source={manifest},target=/maid-roles/roles.json,readonly',
            '--env', 'MAID_ROLES_MANIFEST_FILE=/maid-roles/roles.json']
    if args.execute:
        invocation += ['--execute', args.execute]
    print(command(invocation).strip())


if __name__ == '__main__':
    main()
