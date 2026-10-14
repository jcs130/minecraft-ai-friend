"""Distribute both explicit body providers; no credentials, world or new daemon."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from install_maw_native_sdk import dependencies, REPO, SOURCE, RUNTIME

def install(destination: Path):
    destination = destination.resolve()
    parent = (RUNTIME/'integrations/world-adapter').resolve()
    if parent not in destination.parents:
        raise ValueError('Use a named world-adapter bundle directory')
    if destination.exists():
        manifest_path = parent/'installation.json'
        prior = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else None
        if not prior or Path(prior['directory']).resolve() != destination or not all(
            (destination/name).is_file() and hashlib.sha256((destination/name).read_bytes()).hexdigest() == digest
            for name,digest in prior['files'].items()
        ):
            raise ValueError('Refusing an unowned or externally changed adapter bundle')
    source = sorted(set(dependencies(SOURCE/'world-adapter/index.cjs') + dependencies(SOURCE/'world-adapter/stdio.cjs') + dependencies(SOURCE/'java-client/mineflayer-facade.cjs')))
    files = {p.relative_to(SOURCE).as_posix(): p.read_bytes() for p in source}
    package = json.loads((SOURCE/'society-agent/package.json').read_text('utf-8'))
    package.update(name='@my-agent-world/world-adapter', version='0.4.0', main='world-adapter/index.cjs',
                   private=True, license='MIT', description='Explicit Mineflayer / Numen / real Java client world body adapter')
    files['package.json'] = (json.dumps(package, indent=2)+'\n').encode()
    lock = json.loads((SOURCE/'society-agent/package-lock.json').read_text('utf-8'))
    if lock.get('lockfileVersion') != 3 or lock['packages']['']['dependencies'] != package['dependencies']:
        raise ValueError('Runtime dependency lock does not match the adapter package')
    lock.update(name=package['name'], version=package['version'])
    lock['packages'][''].update(name=package['name'], version=package['version'], license='MIT')
    files['package-lock.json'] = (json.dumps(lock, indent=2)+'\n').encode()
    files['LICENSE'] = (REPO/'LICENSE').read_bytes()
    for name in ('MY-AGENT-WORLD-JAVA-CLIENT.md', 'MY-AGENT-WORLD-JAVA-CLIENT.txt', 'MY-AGENT-WORLD-UNIFIED-ACCESS.md', 'MY-AGENT-WORLD-UNIFIED-ACCESS.txt'):
        files[name] = (REPO/'docs'/name).read_bytes()
    evidence = REPO/'docs/evidence/unified-access-20261014.json'
    if evidence.is_file():files['evidence/'+evidence.name] = evidence.read_bytes()
    for name in ('MY-AGENT-WORLD-WORLD-ADAPTER.md', 'MY-AGENT-WORLD-WORLD-ADAPTER.txt', 'MY-AGENT-WORLD-LOGIN.txt', 'MY-AGENT-WORLD-CONTROL-API.txt', 'MY-AGENT-WORLD-RPG-CONTENT.txt', 'MY-AGENT-WORLD-PAPER-MIGRATION.txt', 'MY-AGENT-WORLD-UNDERWORLD.txt', 'MY-AGENT-WORLD-UNDERWORLD.md', 'MY-AGENT-WORLD-MOD-REUSE.md'):
        files[name] = (REPO/'docs'/name).read_bytes()
    for name, content in files.items():
        p = destination/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(content)
    manifest = {'schemaVersion': 1, 'version': '0.4.0', 'directory': str(destination),
                'providers': ['mineflayer', 'numen', 'java-client'], 'modelRequests': 0, 'newServices': 0,
                'files': {name: hashlib.sha256(content).hexdigest() for name,content in sorted(files.items())},
                'sourceFiles': {p.relative_to(SOURCE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in source}}
    (parent/'installation.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    return manifest

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--destination', type=Path, required=True)
    report=install(parser.parse_args().destination)
    print(json.dumps({'ok': True, 'files': len(report['files']), 'directory': report['directory'], 'providers': report['providers']}))
