"""Package only the native SDK's relative CJS dependencies; no world/model data."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / 'world/src'
RUNTIME = Path('E:/QiandengJiSocietyLab')
NODE = Path('C:/Users/lzl19/AppData/Local/hermes/node/node.exe')

def dependencies(entry: Path) -> list[Path]:
    pending, found = [entry.resolve()], set()
    while pending:
        source = pending.pop()
        if source in found:
            continue
        if SOURCE.resolve() not in source.parents or source.suffix != '.cjs' or not source.is_file():
            raise ValueError('SDK dependency must be a CJS source inside world/src')
        found.add(source)
        for relative in re.findall(r"require\(['\"](\.[^'\"]+)['\"]\)", source.read_text(encoding='utf-8')):
            target = (source.parent / relative).resolve()
            if not target.suffix:
                target = target.with_suffix('.cjs')
            pending.append(target)
    return sorted(found)

def install(destination: Path) -> dict:
    destination = destination.resolve()
    allowed = (RUNTIME / 'integrations/native-sdk').resolve()
    if allowed not in destination.parents or destination == allowed:
        raise ValueError('SDK bundle must be a named directory inside integrations/native-sdk')
    manifest_path = allowed / 'installation.json'
    previous = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else None
    if destination.exists():
        if not previous or Path(previous['directory']).resolve() != destination:
            raise ValueError('Refusing an unowned existing bundle directory')
        for name, digest in previous['files'].items():
            if hashlib.sha256((destination/name).read_bytes()).hexdigest() != digest:
                raise ValueError('Existing SDK files changed outside installer')
    source_files = sorted(set(dependencies(SOURCE/'native-sdk/index.cjs') + dependencies(SOURCE/'native-sdk/stdio.cjs')))
    files = {p.relative_to(SOURCE).as_posix(): p.read_bytes() for p in source_files}
    package = json.loads((SOURCE/'society-agent/package.json').read_text('utf-8'))
    package.update(name='@my-agent-world/native-sdk', version='0.2.0', main='native-sdk/index.cjs',
                   description='Model-neutral My Agent World native body SDK', private=True, license='MIT')
    files['package.json'] = (json.dumps(package, indent=2)+'\n').encode()
    files['LICENSE'] = (REPO/'LICENSE').read_bytes()
    result = subprocess.run([str(NODE), '-e', 'process.stdout.write(JSON.stringify(require("./world/src/native-sdk/catalog.cjs").operationCatalog(),null,2))'],
                            cwd=REPO, capture_output=True, text=True, encoding='utf-8', timeout=15, check=True)
    catalog = json.loads(result.stdout)
    assert catalog['operationCount'] == 70 and not catalog['remoteSupportVerified']
    files['operations.json'] = (result.stdout+'\n').encode()
    for name in ('MY-AGENT-WORLD-NATIVE-SDK.md', 'MY-AGENT-WORLD-NATIVE-SDK-CONNECT.txt'):
        files[name] = (REPO/'docs'/name).read_bytes()
    for name, content in files.items():
        target = destination/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    manifest = {'schemaVersion': 1, 'directory': str(destination), 'operationCount': 70,
                'bodyKind': 'connected_player', 'numenRestoreExisting': False,
                'files': {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())},
                'sourceFiles': {p.relative_to(SOURCE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files},
                'modelRequests': 0, 'publicAccessReady': False}
    allowed.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    result = install(parser.parse_args().destination)
    print(json.dumps({'ok': True, 'directory': result['directory'], 'files': len(result['files']), 'operationCount': result['operationCount']}))
