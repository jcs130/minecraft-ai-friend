"""Install a new optional agent-mc/v1 host bundle. Does not restart services or attach a body."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
from install_maw_native_sdk import dependencies, REPO, SOURCE, RUNTIME

def sha(data):
    return hashlib.sha256(data).hexdigest()

def install(destination: Path, core_package: Path, npm: Path):
    destination, core_package = destination.resolve(), core_package.resolve()
    parent = (RUNTIME / 'integrations/agent-mc-world').resolve()
    if parent not in destination.parents or destination.exists():
        raise ValueError('Use a fresh named integrations/agent-mc-world bundle; keep old SDKs and journals')
    core_source = REPO / 'packages/agent-mc-world'
    metadata = {}
    with tarfile.open(core_package, mode='r|gz') as archive:
        for item in archive:
            if item.name in ('package/package.json', 'package/dist/build.json'):
                metadata[item.name] = json.load(archive.extractfile(item))
    package, build = metadata['package/package.json'], metadata['package/dist/build.json']
    if package['name'] != 'agent-mc-world' or package['version'] != '0.4.0':
        raise ValueError('Expected verified independent agent-mc-world 0.4.0')
    for item in build['sourceFiles']:
        relative = Path(item['file'])
        if relative.is_absolute() or '..' in relative.parts or sha((core_source / relative).read_bytes()) != item['sha256']:
            raise ValueError('Packed core does not match current owned sources')
    expected = {'package/' + row['file']: row['sha256'] for row in build['files']}
    seen = set()
    # Streaming avoids quadratic gzip seeks in a large asset-bearing npm package.
    with tarfile.open(core_package, mode='r|gz') as archive:
        for item in archive:
            if item.name in expected:
                if not item.isfile() or item.name in seen or sha(archive.extractfile(item).read()) != expected[item.name]:
                    raise ValueError('Packed core build verification failed')
                seen.add(item.name)
    if seen != set(expected):
        raise ValueError('Packed core build files missing')
    source_files = dependencies(SOURCE / 'world-adapter/index.cjs')
    source_files += sorted((SOURCE / 'agent-mc-host').glob('*.mjs'))
    source_files += sorted((SOURCE / 'agent-mc-host').glob('*.mts'))
    source_files += [SOURCE / 'agent-mc-host/ENV_PROMPT.txt']
    source_files = sorted(set(p for p in source_files if '.test.' not in p.name))
    files = {p.relative_to(SOURCE).as_posix(): p.read_bytes() for p in source_files}
    native = json.loads((SOURCE / 'society-agent/package.json').read_text('utf-8'))
    bundle = {'name': '@my-agent-world/agent-mc-host', 'version': '0.1.0', 'private': True,
              'description': 'Explicit native My Agent World environment for the independent agent-mc/v1 harness',
              'license': 'MIT', 'type': 'module', 'engines': {'node': '>=22 <23'},
              'exports': {'.': {'types': './agent-mc-host/index.d.mts', 'default': './agent-mc-host/index.mjs'}},
              'bin': {'my-agent-world-mcp': './agent-mc-host/mcp.mjs'},
              'dependencies': {**native['dependencies'], 'agent-mc-world': 'file:vendor/agent-mc-world-0.4.0.tgz'},
              'overrides': native['overrides']}
    files['package.json'] = (json.dumps(bundle, indent=2) + '\n').encode()
    files['LICENSE'] = (REPO / 'LICENSE').read_bytes()
    files['MY-AGENT-WORLD-AGENT-MC-WORLD.txt'] = (REPO / 'docs/MY-AGENT-WORLD-AGENT-MC-WORLD.txt').read_bytes()
    destination.mkdir(parents=True)
    for name, data in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    vendor = destination / 'vendor/agent-mc-world-0.4.0.tgz'
    vendor.parent.mkdir()
    shutil.copyfile(core_package, vendor)
    files['vendor/agent-mc-world-0.4.0.tgz'] = vendor.read_bytes()
    # npm resolves the explicit local core tarball under the existing protocol pins.
    # No dependency scripts, global packages, services or model calls are enabled.
    subprocess.run([str(npm), 'install', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=destination, check=True)
    files['package-lock.json'] = (destination / 'package-lock.json').read_bytes()
    result = {'schemaVersion': 1, 'directory': str(destination), 'version': bundle['version'], 'coreVersion': package['version'],
              'coreArchiveSha256': sha(vendor.read_bytes()), 'coreSourceFiles': {i['file']: i['sha256'] for i in build['sourceFiles']},
              'viewerInput': build['viewer'], 'providers': ['mineflayer', 'numen'], 'newServices': 0,
              'modelRequests': 0, 'bodyConnections': 0, 'productionRestarted': False,
              'files': {name: sha(data) for name, data in sorted(files.items())},
              'sourceFiles': {p.relative_to(SOURCE).as_posix(): sha(p.read_bytes()) for p in source_files}}
    (destination / 'installation.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    (parent / 'installation.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return {key: result[key] for key in ('directory', 'version', 'coreVersion', 'coreArchiveSha256', 'bodyConnections', 'newServices', 'modelRequests')}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--core-package', type=Path, required=True)
    parser.add_argument('--npm', type=Path, required=True)
    a = parser.parse_args()
    print(json.dumps(install(a.destination, a.core_package, a.npm), indent=2))
