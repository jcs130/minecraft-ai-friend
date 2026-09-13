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
TAGS = {'game': 'qiandengji-qwenpaw-game:2.2.0-recovery1',
        'survivor': 'qiandengji-survivor:2.2.0-recovery1'}


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
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    run = ROOT / 'runtime' / ('qwenpaw-recovery-' + stamp + '-' + uuid.uuid4().hex[:8])
    sources = stage(run / 'context')
    report = {'schema': 1, 'producer': 'build_qwenpaw_recovery.py',
              'generatedAt': stamp, 'sourceRecords': sources, 'images': {},
              'servicesStarted': False, 'stateMounted': False, 'modelCalls': 0,
              'historicalImagesRecreated': False}
    (run / 'source-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    if args.build:
        for target, tag in TAGS.items():
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
        published = ROOT / 'server' / 'runtime-images' / 'qwenpaw-recovery.json'
        published.parent.mkdir(parents=True, exist_ok=True)
        published.write_text(json.dumps(report | {'buildReceipt': str(run / 'build-result.json')}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'receipt': str(run / 'build-result.json'),
                      'images': report['images'], 'servicesStarted': False}))


if __name__ == '__main__':
    main()
