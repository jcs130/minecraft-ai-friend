"""Build a class-only RCON transaction candidate; never deploy or edit manifests."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'world/botgate-src'
FILES = ('dev/god/botgate/RconCommandTransaction.java',
         'dev/god/botgate/mixin/RconFrameReadMixin.java')
REPLACED = 'dev/god/botgate/mixin/RconFrameReadMixin.class'
ADDED = 'dev/god/botgate/RconCommandTransaction.class'
ORIGINAL_MIXIN_SHA = '3288b2137ca443f7231b3a708d390ba6df73fc9aee1b22bc8fb973326045f818'
NATIVE_CLASSES = {
    'net/minecraft/server/rcon/thread/RconClient.class': '6526d9619e7afcb767bc67255357c47f6763d261fe97494d4c653aababf684f2',
    'net/minecraft/server/dedicated/DedicatedServer.class': 'b5f39364751dd9c38b0ff9604e2193e6d20abb49b453e45ebf263d00c480658c',
    'net/minecraft/server/rcon/RconConsoleSource.class': '86c59f0d57d8ded0794c9a38b7a8c7d741b1c4870d23d0294b992d90e5ae1940',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    base = ROOT / 'server/mc/mods/botgate.jar'
    libraries = ROOT / 'server/mc/libraries'
    native = libraries / 'net/neoforged/neoforge/21.1.248/neoforge-21.1.248-server.jar'
    with zipfile.ZipFile(native) as archive:
        if any(sha(archive.read(name)) != digest for name, digest in NATIVE_CLASSES.items()):
            raise ValueError('native_rcon_version_changed_review_required')
    original = base.read_bytes()
    with zipfile.ZipFile(base) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    if sha(entries[REPLACED]) != ORIGINAL_MIXIN_SHA or ADDED in entries:
        raise ValueError('original_rcon_mixin_changed_review_required')
    descriptor = json.loads(entries['botgate.mixins.json'])
    if 'RconFrameReadMixin' not in descriptor.get('mixins', []) or descriptor.get('required') is not True:
        raise ValueError('required_rcon_mixin_missing')
    folder = ROOT / 'runtime/botgate-rcon-transaction-build' / uuid.uuid4().hex[:12]
    classes = folder / 'classes'
    classes.mkdir(parents=True)
    spec = importlib.util.spec_from_file_location('botgate_rcon_build_classpath', SOURCE / 'build.py')
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    cp = build.full_cp(libraries) + os.pathsep + str(base)
    quote = lambda value: '"' + str(value).replace('\\', '/') + '"'
    args = folder / 'javac.args'
    args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8',
        '-cp', quote(cp), '-d', quote(classes), *(quote(SOURCE / name) for name in FILES)]), 'utf-8')
    subprocess.run([build.JAVAC, '@' + str(args)], check=True, timeout=120)
    compiled = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
    if set(compiled) != {REPLACED, ADDED}:
        raise ValueError('unexpected_candidate_classes')
    candidate = folder / 'botgate.jar'
    with zipfile.ZipFile(candidate, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted({**entries, **compiled}.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with zipfile.ZipFile(candidate) as archive:
        built = {name: archive.read(name) for name in archive.namelist()}
    if set(built) != set(entries) | {ADDED} or any(
            built[name] != data for name, data in entries.items() if name != REPLACED):
        raise ValueError('unrelated_jar_entries_changed')
    if base.read_bytes() != original:
        raise ValueError('production_jar_changed_during_build')
    source_files = [Path(__file__), SOURCE / 'build.py', *(SOURCE / name for name in FILES)]
    record = {'schema': 1, 'minecraft': '1.21.1', 'neoforge': '21.1.248', 'javaRelease': 21,
        'marker': 'rcon-command-transaction-v1', 'jar': str(candidate),
        'sha256': sha(candidate.read_bytes()), 'baseJar': str(base), 'baseSha256': sha(original),
        'nativeClassSha256': NATIVE_CLASSES,
        'sourceFiles': {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in source_files},
        'changedEntries': [REPLACED], 'addedEntries': [ADDED],
        'otherEntriesIdentical': True, 'productionJarUnchanged': True, 'deployed': False}
    path = folder / 'build-record.json'
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps({'record': str(path), **record}, ensure_ascii=False))


if __name__ == '__main__':
    main()
