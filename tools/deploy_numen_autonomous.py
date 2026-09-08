"""Install the verified autonomous-tick overlay into a stopped, backed-up D server."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

from deploy_numen_body_restore import ROOT, FILENAME, contained, read, sha, bytes_sha, write

MANIFEST = 'world/numen-patches/autonomous-body-tick-v1.json'
CACHE = 'vendor/numen-cache'
LOCK = 'manifests/numen-restore.lock.json'
SOURCES = {'tools/build_numen_autonomous.py', 'tools/build_numen_walk_only.py',
    'world/botgate-src/build.py', MANIFEST, 'world/numen-patches/autonomous-body-tick-v1.patch',
    'world/numen-patches/autonomous-src/com/dwinovo/numen/core/entity/AutonomousBodyTick.java',
    'world/numen-patches/tests/AutonomousTickPolicyTest.java', 'config/numen-autonomous-bodies.json'}


def verified_record(root, record_path):
    record = read(contained(root, record_path)); manifest = read(root / MANIFEST)
    if (record.get('ok') is not True or record.get('capability') != manifest['capability']
            or record.get('baselineJarSha256') != manifest['baselineJarSha256']
            or record.get('sourceCommit') != manifest['sourceCommit']
            or record.get('preservedCapabilities') != manifest['preservedCapabilities']
            or record.get('tests', {}).get('ok') is not True
            or type(record.get('tests', {}).get('assertions')) is not int
            or record['tests']['assertions'] < 34):
        raise ValueError('build_not_verified')
    sources = record.get('sourceFiles', {})
    if set(sources) != SOURCES or any(sha(contained(root, p)) != h for p, h in sources.items()):
        raise ValueError('build_sources_changed')
    jar, baseline = [contained(root, record[k]) for k in ('jar', 'baselineJar')]
    if sha(jar) != record['sha256'] or sha(baseline) != manifest['baselineJarSha256']:
        raise ValueError('jar_digest_mismatch')
    family = lambda n: n[:-6].split('$', 1)[0] if n.endswith('.class') else None
    families = set(manifest['classFamilies'])
    expected = {'com/dwinovo/numen/core/NumenCoreNeoForge.class',
        'com/dwinovo/numen/core/entity/AutonomousBodyTick.class',
        'com/dwinovo/numen/core/entity/AutonomousBodyTick$AllowedBody.class'}
    with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(jar) as after:
        old_names, new_names = before.namelist(), after.namelist()
        if (len(set(old_names)) != len(old_names) or len(set(new_names)) != len(new_names)
                or before.testzip() or after.testzip()):
            raise ValueError('archive_invalid')
        originals = {n: bytes_sha(before.read(n)) for n in old_names}
        preserved = {n: h for n, h in originals.items() if family(n) not in families}
        if (originals != record.get('originalEntryHashes') or len(preserved) < 496
                or preserved != record.get('preservedEntryHashes')
                or len(preserved) != record.get('preservedEntries')):
            raise ValueError('preservation_evidence_invalid')
        if ({n for n in new_names if family(n) not in families} != set(preserved)
                or {n for n in new_names if family(n) in families} != expected
                or any(bytes_sha(after.read(n)) != h for n, h in preserved.items())):
            raise ValueError('unrelated_entries_changed')
        if (record.get('embeddedApiHashes') != manifest['embeddedApiHashes']
                or any(originals.get(n) != h or bytes_sha(after.read(n)) != h
                       for n, h in manifest['embeddedApiHashes'].items())):
            raise ValueError('native_api_changed')
    return record, jar, baseline, manifest


def deploy(record_path, apply=False, root=ROOT, is_running=None):
    root = Path(root).resolve()
    record, jar, baseline, manifest = verified_record(root, record_path)
    target = contained(root, 'server/mc/mods/' + FILENAME)
    current = sha(target)
    if current not in (manifest['baselineJarSha256'], record['sha256']):
        raise ValueError('installed_numen_is_another_fork')
    if sha(root / 'server/mc/mods/numen_act-neoforge-1.21.1-0.1.1.jar') != manifest['actuatorJarSha256']:
        raise ValueError('actuator_changed')
    if (root / 'client/mods' / FILENAME).exists():
        raise ValueError('unexpected_client_numen')
    policy_source = contained(root, manifest['configSource'])
    policy = read(policy_source)
    settings = read(root / 'server/survival-agent-state/survival/settings.json')
    expected = {k: settings[k] for k in ('bodyUuid', 'ownerUuid', 'bodyName')}
    if policy != {'schema': 1, 'enabled': True, 'bodies': [expected]}:
        raise ValueError('autonomous_body_binding_changed')
    policy_target = contained(root, manifest['configPath'])
    if policy_target.exists() and policy_target.read_bytes() != policy_source.read_bytes():
        raise ValueError('existing_autonomous_policy_differs')
    result = {'ok': True, 'mode': 'apply' if apply else 'check', 'sha256': record['sha256'],
        'capability': record['capability'], 'preservedEntries': record['preservedEntries'],
        'modelCalls': 0, 'bodyCreated': False, 'worldChanged': False, 'clientChanged': False}
    if not apply: return result
    if is_running is None:
        is_running = lambda: subprocess.check_output(['docker', 'inspect', 'qiandengji-mc-1',
            '--format', '{{.State.Running}}'], text=True).strip() != 'false'
    if is_running(): raise ValueError('stop_exact_project_mc_first')
    backup = contained(root, 'runtime/numen-autonomous-backups/' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True, exist_ok=False)
    paths = [target, root/CACHE/FILENAME, root/CACHE/'baseline-autonomous-numen.jar',
        root/CACHE/'build-record.json', root/LOCK, root/'manifests/server-extensions.lock.json', policy_target]
    paths = [contained(root, p) for p in paths]
    before = {p.relative_to(root).as_posix(): sha(p) if p.exists() else None for p in paths}
    for path in paths:
        if path.exists():
            saved = backup/path.relative_to(root); saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
    write(backup/'before.json', before)
    if is_running() or sha(target) != current:
        raise ValueError('deployment_changed_during_backup')
    try:
        for source, destination in ((jar, target), (jar, root/CACHE/FILENAME),
                (baseline, root/CACHE/'baseline-autonomous-numen.jar'), (policy_source, policy_target)):
            destination.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, destination)
            if sha(source) != sha(destination): raise ValueError('artifact_copy_mismatch')
        write(root/CACHE/'build-record.json', record | {'jar': str(root/CACHE/FILENAME),
            'baselineJar': str(root/CACHE/'baseline-autonomous-numen.jar')})
        old_lock = read(root/LOCK)
        if old_lock.get('capability') != 'existing_body_restore_v1':
            raise ValueError('existing_restore_capability_missing')
        write(root/LOCK, old_lock | {'sha256': record['sha256'], 'size_bytes': jar.stat().st_size,
            'capabilities': manifest['preservedCapabilities'] + [record['capability']],
            'source_build': 'tools/build_numen_autonomous.py', 'baseline_sha256': manifest['baselineJarSha256'],
            'baseline_cache_path': CACHE+'/baseline-autonomous-numen.jar',
            'preserved_entries': record['preservedEntries'], 'autonomous_config': manifest['configPath']})
        extension_path = root/'manifests/server-extensions.lock.json'; extensions = read(extension_path)
        row = {'path': 'server/mc/mods/'+FILENAME, 'sha256': record['sha256'], 'client_required': False}
        extensions['files'] = [r for r in extensions['files'] if r['path'] != row['path']] + [row]
        write(extension_path, extensions)
    except Exception:
        for path in paths:
            saved = backup/path.relative_to(root)
            if saved.is_file(): shutil.copy2(saved, path)
            elif before[path.relative_to(root).as_posix()] is None: path.unlink(missing_ok=True)
        raise
    result.update(backup=str(backup), touched=list(before), finishedAt=datetime.now(timezone.utc).isoformat())
    write(backup/'deployment.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(deploy(args.record, bool(args.apply)), ensure_ascii=True))
