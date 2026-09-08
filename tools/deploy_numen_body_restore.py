"""Install the verified restore overlay into the stopped D server only.

No new body, client dependency, world edit, container restart, or model call.
Every replaced artifact and lock is backed up before the first replacement.
The surrounding maintenance procedure must preserve its stopped world backup.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILENAME = 'numen-neoforge-1.21.1-0.1.1.jar'
MANIFEST = 'world/numen-patches/restore-existing-v1.json'
CACHE = 'vendor/numen-cache'
LOCK = 'manifests/numen-restore.lock.json'


def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def bytes_sha(data): return hashlib.sha256(data).hexdigest()
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf8')


def contained(root, path):
    root = root.resolve()
    path = Path(path)
    if not path.is_absolute(): path = root/path
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('path_outside_project')
    for parent in path.parents:
        if parent == root: break
        if parent.is_symlink(): raise ValueError('symlink_path')
    return path.resolve()


def verified_record(root, record_path):
    record_path = contained(root, record_path)
    record = read(record_path)
    manifest = read(root/MANIFEST)
    if (record.get('ok') is not True or record.get('capability') != manifest['capability']
            or record.get('baselineJarSha256') != manifest['baselineJarSha256']
            or record.get('sourceCommit') != manifest['sourceCommit']
            or record.get('tests', {}).get('ok') is not True
            or record.get('tests', {}).get('assertions', 0) < 26):
        raise ValueError('build_not_verified')
    sources = record.get('sourceFiles', {})
    required = {'tools/build_numen_body_restore.py', 'tools/build_numen_walk_only.py',
        'world/botgate-src/build.py', MANIFEST,
        'world/numen-patches/restore-src/com/dwinovo/numen/core/entity/ExistingBodyRestore.java',
        'world/numen-patches/tests/ExistingBodyRestoreTest.java'}
    if set(sources) != required: raise ValueError('build_source_evidence_missing')
    for relative, digest in sources.items():
        if sha(contained(root, relative)) != digest:
            raise ValueError('source_changed_after_build')
    jar = contained(root, record['jar'])
    baseline = contained(root, record['baselineJar'])
    if sha(jar) != record['sha256'] or sha(baseline) != manifest['baselineJarSha256']:
        raise ValueError('jar_digest_mismatch')
    families = set(manifest['classFamilies'])
    family = lambda n: n[:-6].split('$', 1)[0] if n.endswith('.class') else None
    with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(jar) as after:
        old_names, new_names = before.namelist(), after.namelist()
        if len(set(old_names)) != len(old_names) or len(set(new_names)) != len(new_names):
            raise ValueError('duplicate_archive_entry')
        preserved = {name: bytes_sha(before.read(name)) for name in old_names if family(name) not in families}
        if len(preserved) < 495 or record.get('preservedEntries') != len(preserved) or record.get('preservedEntryHashes') != preserved:
            raise ValueError('preservation_evidence_invalid')
        if {n for n in new_names if family(n) not in families} != set(preserved):
            raise ValueError('unrelated_entries_changed')
        if any(bytes_sha(after.read(n)) != digest for n, digest in preserved.items()):
            raise ValueError('unrelated_entries_changed')
        expected = {'com/dwinovo/numen/core/NumenCoreNeoForge.class',
                    'com/dwinovo/numen/core/entity/ExistingBodyRestore.class'}
        if {n for n in new_names if family(n) in families} != expected or after.testzip():
            raise ValueError('restore_classes_invalid')
    return record, jar, baseline


def deploy(record_path, apply=False, root=ROOT, is_running=None):
    root = root.resolve()
    record, jar, baseline = verified_record(root, record_path)
    manifest = read(root/MANIFEST)
    target = contained(root, 'server/mc/mods/'+FILENAME)
    if sha(root/'server/mc/mods/numen_act-neoforge-1.21.1-0.1.1.jar') != manifest['actuatorJarSha256']:
        raise ValueError('actuator_changed')
    current = sha(target)
    if current not in (manifest['baselineJarSha256'], record['sha256']):
        raise ValueError('installed_numen_is_another_fork')
    if (root/'client/mods'/FILENAME).exists():
        raise ValueError('unexpected_client_numen_requires_review')
    result = {'ok': True, 'mode': 'apply' if apply else 'check', 'project': 'qiandengji',
        'sha256': record['sha256'], 'baselineSha256': manifest['baselineJarSha256'],
        'preservedEntries': record['preservedEntries'], 'tests': record['tests'],
        'worldChanged': False, 'worldBackupPerformed': False, 'bodyCreated': False,
        'clientChanged': False, 'modelCalls': 0}
    if not apply: return result
    if is_running is None:
        is_running = lambda: subprocess.check_output(['docker', 'inspect', 'qiandengji-mc-1',
            '--format', '{{.State.Running}}'], text=True).strip() != 'false'
    if is_running(): raise ValueError('stop_exact_project_mc_first')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = contained(root, 'runtime/numen-restore-backups/'+stamp)
    backup.mkdir(parents=True, exist_ok=False)
    paths = [target, root/CACHE/FILENAME, root/CACHE/'baseline-numen.jar',
             root/CACHE/'build-record.json', root/LOCK, root/'manifests/server-extensions.lock.json']
    for path in paths:
        path = contained(root, path)
        if path.exists():
            saved = backup/path.relative_to(root); saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
    write(backup/'before.json', {p.relative_to(root).as_posix(): sha(p) if p.exists() else None for p in paths})
    if is_running(): raise ValueError('mc_started_during_backup')
    if sha(target) != current: raise ValueError('installed_numen_changed_during_backup')
    for source, destination in ((jar, target), (jar, root/CACHE/FILENAME), (baseline, root/CACHE/'baseline-numen.jar')):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        if sha(source) != sha(destination): raise ValueError('artifact_copy_mismatch')
    write(root/CACHE/'build-record.json', record | {
        'jar': str(root/CACHE/FILENAME), 'baselineJar': str(root/CACHE/'baseline-numen.jar')})
    write(root/LOCK, {'schema_version': 1, 'capability': record['capability'],
        'minecraft': '1.21.1', 'neoforge': '21.1.248', 'client_required': False,
        'path': 'server/mc/mods/'+FILENAME, 'sha256': record['sha256'],
        'size_bytes': jar.stat().st_size, 'cache_path': CACHE+'/'+FILENAME,
        'source_build': 'tools/build_numen_body_restore.py',
        'baseline_sha256': manifest['baselineJarSha256'], 'preserved_entries': record['preservedEntries']})
    extension_path = root/'manifests/server-extensions.lock.json'
    extensions = read(extension_path)
    row = {'path': 'server/mc/mods/'+FILENAME, 'sha256': record['sha256'], 'client_required': False}
    extensions['files'] = [r for r in extensions['files'] if r['path'] != row['path']] + [row]
    write(extension_path, extensions)
    result.update(backup=str(backup), touched=[p.relative_to(root).as_posix() for p in paths],
                  finishedAt=datetime.now(timezone.utc).isoformat())
    write(backup/'deployment.json', result)
    write(root/'reports/numen-restore-deployment.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    try: print(json.dumps(deploy(args.record, bool(args.apply)), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'errorType': type(exc).__name__, 'error': str(exc)[:160]}))
        sys.exit(1)
