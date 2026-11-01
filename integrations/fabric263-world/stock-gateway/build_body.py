"""Build the independent, server-only, read-only stock-client snapshot bridge."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent


def build(cache, java, output):
    if output.exists():
        raise ValueError('Use a new build directory')
    output.mkdir(parents=True)
    sources = sorted((HERE / 'server-src').glob('*.java'))
    deps = sorted((cache / 'mineflayer/native-build').glob('fabric-*.jar'))
    if not deps:
        raise ValueError('Prepare the reviewed Fabric native build dependencies first')
    lock = json.loads((HERE.parent / 'pack.lock.json').read_text(encoding='utf-8'))
    api = next(entry for entry in lock['mods'] if entry['slug'] == 'fabric-api')
    archive = cache / api['filename']
    for algorithm, expected in api['hashes'].items():
        if hashlib.new(algorithm, archive.read_bytes()).hexdigest() != expected:
            raise ValueError('Fabric API differs from its locked source')
    with zipfile.ZipFile(archive) as source:
        entries = {Path(name).name: name for name in source.namelist() if name.endswith('.jar')}
        for dependency in deps:
            if dependency.name not in entries or source.read(entries[dependency.name]) != dependency.read_bytes():
                raise ValueError('Extracted compile dependency differs from reviewed API')
    classes = output / 'classes'
    classes.mkdir()
    cp = [cache / 'minecraft-26.3-client.jar', *deps, *sorted((cache / 'libraries').rglob('*.jar'))]
    cmd = [str(java.with_name('javac.exe')), '-J-Dfile.encoding=UTF-8', '-encoding', 'UTF-8', '--release', '25', '-proc:none', '-cp', ';'.join(map(str, cp)), '-d', str(classes), *map(str, sources)]
    result = subprocess.run(cmd, capture_output=True)
    (output / 'compile.log').write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise ValueError(result.stderr.decode('utf-8', 'replace'))
    metadata = {'schemaVersion': 1, 'id': 'maw_stock263', 'version': '0.1.0', 'environment': 'server',
                'name': 'My Agent World: Stock Client Read Bridge', 'license': 'MIT',
                'entrypoints': {'main': ['dev.myagentworld.stock263.BodyBridge']},
                'depends': {'minecraft': '26.3', 'java': '>=25', 'fabricloader': '>=0.20.1', 'fabric-networking-api-v1': '*'}}
    files = {'fabric.mod.json': json.dumps(metadata).encode()}
    for file in classes.rglob('*.class'):
        files[file.relative_to(classes).as_posix()] = file.read_bytes()
    target = output / 'maw-stock263-0.1.0.jar'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
    return {'filename': target.name, 'sha256': digest(target), 'sourceSha256': {p.name: digest(p) for p in sources}, 'sides': ['server']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True); parser.add_argument('--java', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); print(json.dumps(build(args.cache, args.java, args.output)))
