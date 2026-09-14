"""Rebuild the existing game Qwen/body runtimes without historical base images.

Stages code only below runtime/, checks runtime contracts without production
mounts, and records the actual new image identity. Never initializes agent state
or starts the services. The retired operations runtime is intentionally omitted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
TAGS = {'game': 'qiandengji-qwenpaw-game:2.2.1-recovery1',
        'survivor': 'qiandengji-survivor:2.2.1-recovery1'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stage(destination):
    if destination.exists():
        raise ValueError('build_context_already_exists')
    destination.mkdir(parents=True)
    sources = []
    for folder in ('ops', 'survival'):
        for source in sorted((ROOT / 'world' / folder).rglob('*')):
            if not source.is_file() or source.is_symlink():
                continue
            if '__pycache__' in source.parts or source.suffix in ('.pyc', '.pyo'):
                continue
            target = destination / folder / source.relative_to(ROOT / 'world' / folder)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            sources.append({'path': source.relative_to(ROOT).as_posix(),
                            'sha256': digest(source), 'bytes': source.stat().st_size})
    for relative, name in [('world/sidecar/character_speech.py', 'character_speech.py'),
                           ('world/ops/Dockerfile.qwenpaw-recovery', 'Dockerfile'),
                           ('world/ops/qwenpaw_recovery_probe.py', 'qwenpaw_recovery_probe.py')]:
        source = ROOT / relative
        shutil.copyfile(source, destination / name)
        sources.append({'path': relative, 'sha256': digest(source), 'bytes': source.stat().st_size})
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--index-url', default='https://pypi.org/simple')
    parser.add_argument('--tag-suffix', default='recovery1',
                        help='New immutable image release suffix; defaults to the original recovery release')
    parser.add_argument('--target', choices=['both', 'game', 'survivor'], default='both',
                        help='Build only the selected service when its peer must keep running')
    args = parser.parse_args()
    import re
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,48}', args.tag_suffix):
        parser.error('invalid image tag suffix')
    tags = {key: value.rsplit('-', 1)[0] + '-' + args.tag_suffix for key, value in TAGS.items()}
    if args.target != 'both':
        tags = {args.target: tags[args.target]}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    run = ROOT / 'runtime' / ('qwenpaw-recovery-' + stamp + '-' + uuid.uuid4().hex[:8])
    sources = stage(run / 'context')
    report = {'schema': 1, 'producer': 'build_qwenpaw_recovery.py',
              'generatedAt': stamp, 'sourceRecords': sources, 'images': {},
              'servicesStarted': False, 'stateMounted': False, 'modelCalls': 0,
              'historicalImagesRecreated': False}
    (run / 'source-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    if args.build:
        for target, tag in tags.items():
            command = ['docker', 'build', '--progress', 'plain', '--target', target,
                       '--build-arg', 'PIP_INDEX_URL=' + args.index_url,
                       '-t', tag, str(run / 'context')]
            with (run / (target + '-build.log')).open('w', encoding='utf-8') as log:
                result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                raise SystemExit('Build failed; inspect ' + str(run / (target + '-build.log')))
            image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag], encoding='utf-8'))[0]
            report['images'][target] = {'tag': tag, 'id': image['Id'], 'size': image['Size']}
            (run / 'build-result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        receipt_name = 'qwenpaw-recovery.json' if args.target == 'both' else args.target + '-recovery.json'
        published = ROOT / 'server' / 'runtime-images' / receipt_name
        published.parent.mkdir(parents=True, exist_ok=True)
        published.write_text(json.dumps(report | {'buildReceipt': str(run / 'build-result.json')}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'receipt': str(run / 'build-result.json'),
                      'images': report['images'], 'servicesStarted': False}))


if __name__ == '__main__':
    main()
