"""Prepare an explicit, pinned viewer input without changing the shared checkout or live assets."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

REPO = Path(__file__).resolve().parents[1]
CORE = REPO / 'packages/agent-mc-world'


def prepare(shared: Path, workspace: Path, node: Path, update_lock: bool = False):
    shared, workspace = shared.resolve(), workspace.resolve()
    if workspace.exists() or shared == workspace or shared in workspace.parents or workspace in shared.parents:
        raise ValueError('Use a fresh, separate viewer build directory')
    lock_path = CORE / 'release-sources.json'
    lock = json.loads(lock_path.read_text('utf-8'))
    pinned = lock['viewer']['commit']
    actual = subprocess.check_output(['git', 'rev-parse', pinned + '^{commit}'], cwd=shared, text=True).strip()
    if actual != pinned:
        raise ValueError('Pinned shared source unavailable')
    workspace.mkdir(parents=True)
    source = workspace / 'source'
    source.mkdir()
    archive = workspace / 'source.tar'
    subprocess.run(['git', 'archive', '--format=tar', '--output=' + str(archive), pinned,
                    'tools/prepare-viewer-assets.mjs', 'tools/client-console', 'tools/model-status-overlay',
                    'packages/modern-viewer/renderer-src', 'packages/modern-viewer/src',
                    'packages/modern-viewer/asset-packs/java-1.20.6', 'LICENSE'], cwd=shared, check=True)
    with tarfile.open(archive) as handle:
        handle.extractall(source, filter='data')
    renderer = source / 'packages/modern-viewer/renderer-src'
    # Reuse explicitly selected local build dependencies, never a running viewer.
    dependencies = shared / 'packages/modern-viewer/renderer-src/node_modules'
    if not dependencies.is_dir():
        raise ValueError('Prepare the shared renderer build dependencies first')
    subprocess.run([str(node), '-e', "require('node:fs').symlinkSync(process.argv[1],process.argv[2],'junction')",
                    str(dependencies), str(renderer / 'node_modules')], check=True)
    output = workspace / 'input'
    viewer = output / 'viewer'
    subprocess.run([str(node), str(source / 'tools/prepare-viewer-assets.mjs'),
                    lock['viewer']['assetPack'], str(viewer)], cwd=source, check=True)
    stamp = subprocess.check_output(['git', 'show', '-s', '--format=%cI', pinned], cwd=shared, text=True).strip()
    receipt_path = viewer / 'viewer-assets.json'
    receipt = json.loads(receipt_path.read_text('utf-8'))
    receipt['preparedAt'] = stamp
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    shutil.copyfile(source / 'LICENSE', viewer / 'LICENSE-mc-visual-console.txt')
    source_info = {k: lock['viewer'][k] for k in ('repository', 'commit', 'assetPack', 'preset')}
    source_info['viewerClientManifestSha256'] = hashlib.sha256((viewer / 'viewer-client.json').read_bytes()).hexdigest()
    (viewer / 'source.json').write_text(json.dumps(source_info, indent=2) + '\n', encoding='utf-8')
    for directory, excludes in [('client-console', {'test'}), ('model-status-overlay', {'__pycache__'})]:
        target = output / ('monitor' if directory == 'model-status-overlay' else directory)
        files = []
        for file in sorted((source / 'tools' / directory).rglob('*')):
            if not file.is_file() or any(p.startswith('.') or p in excludes for p in file.relative_to(source / 'tools' / directory).parts):
                continue
            relative = file.relative_to(source / 'tools' / directory)
            dest = target / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, dest)
            files.append({'file': relative.as_posix(), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        (target / 'source.json').write_text(json.dumps({'repository': lock['viewer']['repository'], 'commit': pinned, 'files': files}, indent=2) + '\n', encoding='utf-8')
    packed = workspace / 'mc-visual-console-java-1.20.6.tgz'
    with packed.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as handle:
            for file in sorted(output.rglob('*')):
                if file.is_file():
                    data = file.read_bytes()
                    info = tarfile.TarInfo(file.relative_to(output).as_posix())
                    info.size, info.mode, info.mtime = len(data), 0o644, 0
                    handle.addfile(info, io.BytesIO(data))
    digest = hashlib.sha256(packed.read_bytes()).hexdigest()
    report = {'schemaVersion': 1, 'sourceCommit': pinned, 'archive': str(packed), 'sha256': digest,
              'previousArchiveSha256': lock['viewer']['sha256'], 'liveAssetsChanged': False,
              'sourceCheckoutChanged': False, 'lockUpdated': update_lock}
    if update_lock:
        lock['viewer']['sha256'] = digest
        lock_path.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
    (workspace / 'preparation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shared-source', required=True, type=Path)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--update-lock', action='store_true', help='Explicitly record the newly prepared archive SHA; never relax verification')
    args = parser.parse_args()
    print(json.dumps(prepare(args.shared_source, args.workspace, args.node, args.update_lock), indent=2))
