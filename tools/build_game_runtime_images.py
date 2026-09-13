"""Build the D-project world, NPC and voice runtimes from explicit inputs.

This does not start containers, change Compose, copy Windows node_modules, or
reuse historical mc-* image identities. Receipts stay in ignored runtime/.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import uuid

PROJECT = Path(__file__).resolve().parents[1]
IMAGES = {
    'world': 'qiandengji-world:20260913-qd1',
    'sidecar': 'qiandengji-sidecar:20260913-qd1',
    'voice': 'qiandengji-voice:20260913-qd1',
}
PREFIXES = ('world/src/', 'world/admin/', 'world/sidecar/', 'world/ops/', 'world/survival/')
FILES = ('world/package.json', 'world/package-lock.json', 'world/.npmrc',
         'world/bootstrap-world.mts', 'tools/npc_health.py',
         'tools/voice_health.py', 'tools/register_maid_agents.py')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def selected_inputs():
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=PROJECT).decode('utf-8').split('\0')
    names = {name for name in tracked if name in FILES or name.startswith(PREFIXES)}
    for folder in ('world/runtime-images', 'vendor/modern-viewer'):
        for path in (PROJECT / folder).rglob('*'):
            if path.is_file() and not any(part.startswith('.') or part in ('node_modules', '__pycache__') for part in path.relative_to(PROJECT / folder).parts):
                names.add(path.relative_to(PROJECT).as_posix())
    for name in FILES:
        if name not in names:
            raise ValueError('Required tracked source is missing: ' + name)
    for name in sorted(names):
        path = PROJECT / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(PROJECT.resolve()):
            raise ValueError('Invalid build input: ' + name)
        yield name, path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('services', choices=list(IMAGES), nargs='*', default=list(IMAGES))
    parser.add_argument('--stage-only', action='store_true')
    parser.add_argument('--tag-suffix', default='20260913-qd1',
                        help='Use a new suffix for changed inputs; existing tags are never overwritten')
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = PROJECT / 'runtime' / ('game-images-' + stamp + '-' + uuid.uuid4().hex[:6])
    context = output / 'context'
    context.mkdir(parents=True)
    records = []
    for name, source in selected_inputs():
        target = context / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        records.append({'path': name, 'bytes': target.stat().st_size, 'sha256': digest(target)})
    source_sha = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    manifest = {'schema': 1, 'producer': 'build_game_runtime_images.py', 'sourceSha256': source_sha,
                'createdAt': stamp, 'entries': records}
    (output / 'source-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'context': str(context), 'sourceSha256': source_sha, 'files': len(records)}), flush=True)
    if args.stage_only:
        return
    for service in args.services:
        tag = IMAGES[service].split(':', 1)[0] + ':' + args.tag_suffix
        exists = subprocess.run(['docker', 'image', 'inspect', tag], cwd=PROJECT,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if exists.returncode == 0:
            raise SystemExit('Image already exists; keep its identity and choose --tag-suffix: ' + tag)
        log_path = output / (service + '-build.log')
        with log_path.open('w', encoding='utf-8') as log:
            result = subprocess.run(['docker', 'build', '--progress=plain', '--label',
                                     'org.qiandengji.source-sha256=' + source_sha,
                                     '-t', tag, '-f', str(context / 'world/runtime-images' / ('Dockerfile.' + service)),
                                     str(context)], cwd=PROJECT, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise SystemExit('Build failed. Inspect ' + str(log_path))
        image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag], cwd=PROJECT))[0]
        receipt = {'schema': 1, 'producer': 'build_game_runtime_images.py', 'service': service,
                   'image': {'tag': tag, 'id': image['Id']}, 'sourceSha256': source_sha,
                   'sourceManifest': str(output / 'source-manifest.json'),
                   'buildLog': str(log_path), 'serviceStarted': False}
        (output / (service + '-image.json')).write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        state = PROJECT / 'server' / 'runtime-images'
        state.mkdir(parents=True, exist_ok=True)
        (state / (service + '.json')).write_text(json.dumps(receipt, indent=2), encoding='utf-8')
        print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
