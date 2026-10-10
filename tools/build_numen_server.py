"""Build the server-resident Numen addon; official core/API remain byte-identical."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile
from build_society_bridge import API_SHA, NUMEN_NAME, NUMEN_SHA, add_bytes, ensure_server_stopped, install_candidate
from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, REPO, safe_root, sha256

NAME = 'maw_numen_server-0.1.0.jar'
SOURCE = REPO / 'world/numen-server-src/src/main'

def build(root: Path, java: Path) -> dict:
    original = root / 'server/mods' / NUMEN_NAME
    if sha256(original) != NUMEN_SHA:
        raise ValueError('Pinned official Numen 0.1.4.1 is required')
    build_dir = root / 'build/numen-server'
    build_dir.mkdir(parents=True, exist_ok=True)
    api = build_dir / 'numen_api.jar'
    with zipfile.ZipFile(original) as z:
        entries = [n for n in z.namelist() if n.startswith('META-INF/jarjar/') and 'numen_api' in n and n.endswith('.jar')]
        if len(entries) != 1:
            raise ValueError('Official Numen must contain one embedded API')
        api.write_bytes(z.read(entries[0]))
    if sha256(api) != API_SHA:
        raise ValueError('Embedded API hash mismatch')
    spec = importlib.util.spec_from_file_location('numen_server_cp', REPO / 'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    cp = os.pathsep.join((helper.full_cp(root / 'server/libraries'), str(api), str(original)))
    sources = sorted((SOURCE / 'java').rglob('*.java'))
    resources = sorted(p for p in (SOURCE / 'resources').rglob('*') if p.is_file())
    with tempfile.TemporaryDirectory(prefix='compile-', dir=build_dir) as temp:
        work = Path(temp)
        classes = work / 'classes'
        classes.mkdir()
        quote = lambda value: '"' + str(value).replace('\\', '/') + '"'
        args = work / 'javac.args'
        args.write_text('\n'.join(('-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp), '-d', quote(classes), *(quote(p) for p in sources))), encoding='utf-8')
        result = subprocess.run([str(java.with_name('javac.exe')), '-J-Duser.language=en', '@' + str(args)], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
        if result.returncode:
            raise RuntimeError(result.stderr[-9000:])
        candidate = work / NAME
        with zipfile.ZipFile(candidate, 'w') as z:
            for p in resources:
                add_bytes(z, p.relative_to(SOURCE / 'resources').as_posix(), p.read_bytes())
            for p in sorted(classes.rglob('*.class')):
                add_bytes(z, p.relative_to(classes).as_posix(), p.read_bytes())
        with zipfile.ZipFile(candidate) as z:
            if z.testzip():
                raise ValueError('JAR CRC failed')
        artifact = build_dir / NAME
        os.replace(candidate, artifact)
    record = {'schemaVersion': 1, 'jar': str(artifact), 'sha256': sha256(artifact), 'numenSha256': NUMEN_SHA, 'apiSha256': API_SHA, 'serverResident': True, 'clientRequired': False, 'sourceFiles': {p.relative_to(REPO).as_posix(): sha256(p) for p in (*sources, *resources, Path(__file__))}}
    (build_dir / 'build-record.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return record

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    p.add_argument('--java', type=Path, default=DEFAULT_JAVA)
    p.add_argument('--install', action='store_true')
    p.add_argument('--server-dir', type=Path)
    args = p.parse_args()
    root = safe_root(args.root)
    server = (args.server_dir or root / 'server').resolve()
    if args.install:
        if server != (root / 'server').resolve() and (root / 'research').resolve() not in server.parents:
            raise ValueError('Installation outside managed runtime/research is prohibited')
        ensure_server_stopped(server)
    record = build(root, args.java)
    if args.install:
        target = server / 'mods' / NAME
        candidate = Path(record['jar']).with_suffix('.install-part')
        shutil.copyfile(record['jar'], candidate)
        install_candidate(candidate, target, server)
        record['installed'] = str(target)
    print(json.dumps({'ok': True, **record}))

if __name__ == '__main__':
    main()
