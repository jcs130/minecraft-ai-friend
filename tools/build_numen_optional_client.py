"""Build a server-only compatibility mod without changing official Numen bytes."""
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

from build_society_bridge import (API_SHA, NUMEN_NAME, NUMEN_SHA, add_bytes,
                                 ensure_server_stopped, install_candidate)
from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, REPO, safe_root, sha256

NAME = 'maw_numen_compat-0.1.0.jar'
SOURCE = REPO / 'world/numen-compat-src/src/main'


def build(root: Path, java: Path) -> dict:
    original = root / 'server/mods' / NUMEN_NAME
    if sha256(original) != NUMEN_SHA:
        raise ValueError('Pinned official Numen 0.1.4.1 is required')
    build_dir = root / 'build/numen-optional-client'
    build_dir.mkdir(parents=True, exist_ok=True)
    api = build_dir / 'numen_api.jar'
    with zipfile.ZipFile(original) as archive:
        entries = [n for n in archive.namelist() if n.startswith('META-INF/jarjar/')
                   and 'numen_api' in n and n.endswith('.jar')]
        if len(entries) != 1:
            raise ValueError('Official Numen must contain one embedded API')
        api.write_bytes(archive.read(entries[0]))
    if sha256(api) != API_SHA:
        raise ValueError('Embedded API differs from the locked release')
    spec = importlib.util.spec_from_file_location('numen_compat_cp', REPO / 'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    classpath = os.pathsep.join((helper.full_cp(root / 'server/libraries'), str(api)))
    sources = sorted((SOURCE / 'java').rglob('*.java'))
    resources = sorted(p for p in (SOURCE / 'resources').rglob('*') if p.is_file())
    if not sources or not resources:
        raise ValueError('Missing optional-client source/resources')
    with tempfile.TemporaryDirectory(prefix='compile-', dir=build_dir) as temporary:
        work = Path(temporary)
        classes = work / 'classes'
        classes.mkdir()
        quoted = lambda value: '"' + str(value).replace('\\', '/') + '"'
        args = work / 'javac.args'
        args.write_text('\n'.join(('-proc:none', '--release', '21', '-encoding', 'UTF-8',
                                   '-cp', quoted(classpath), '-d', quoted(classes),
                                   *(quoted(p) for p in sources))), encoding='utf-8')
        result = subprocess.run([str(java.with_name('javac.exe')), '@' + str(args)], capture_output=True,
                                text=True, encoding='utf-8', errors='replace', timeout=180)
        if result.returncode:
            raise RuntimeError(result.stderr[-5000:])
        candidate = work / NAME
        with zipfile.ZipFile(candidate, 'w') as archive:
            for path in resources:
                add_bytes(archive, path.relative_to(SOURCE / 'resources').as_posix(), path.read_bytes())
            for path in sorted(classes.rglob('*.class')):
                add_bytes(archive, path.relative_to(classes).as_posix(), path.read_bytes())
        with zipfile.ZipFile(candidate) as archive:
            if archive.testzip():
                raise ValueError('Compatibility JAR failed CRC validation')
        artifact = build_dir / NAME
        os.replace(candidate, artifact)
    record = {'schemaVersion': 1, 'jar': str(artifact), 'sha256': sha256(artifact),
              'numenSha256': NUMEN_SHA, 'apiSha256': API_SHA, 'clientRequired': False,
              'sourceFiles': {p.relative_to(REPO).as_posix(): sha256(p)
                              for p in (*sources, *resources, Path(__file__))}}
    (build_dir / 'build-record.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--java', type=Path, default=DEFAULT_JAVA)
    parser.add_argument('--install', action='store_true', help='Install only when the target is stopped')
    parser.add_argument('--server-dir', type=Path)
    args = parser.parse_args()
    root = safe_root(args.root)
    server = (args.server_dir or root / 'server').resolve()
    if args.install:
        if server != (root / 'server').resolve() and (root / 'research').resolve() not in server.parents:
            raise ValueError('Installation is limited to this runtime and its research copies')
        ensure_server_stopped(server)
    record = build(root, args.java)
    if args.install:
        target = server / 'mods' / NAME
        target.parent.mkdir(parents=True, exist_ok=True)
        candidate = Path(record['jar']).with_suffix('.install-part')
        shutil.copyfile(record['jar'], candidate)
        install_candidate(candidate, target, server)
        record['installed'] = str(target)
    print(json.dumps({'ok': True, **record}))


if __name__ == '__main__':
    main()
