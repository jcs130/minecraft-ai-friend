"""Install verified character JARs while the exact D Minecraft service is stopped.

Does not start services, rebuild worlds, change owners, or touch the old C pack.
Backups include the complete stopped D world and every overwritten local file.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def deploy(speech_record, apply=False):
    speech_record = speech_record.resolve()
    if not speech_record.is_relative_to(ROOT / 'runtime'): raise ValueError('speech_record_outside_runtime')
    speech = read(speech_record)
    maid_record = ROOT / 'world/maid-bridge-src/build/build-record.json'
    maid = read(maid_record)
    artifacts = [(speech, ROOT / 'vendor/god-voice-cache', 'godvoice', 'manifests/recording-extension.lock.json'),
                 (maid, ROOT / 'vendor/maid-bridge-cache', 'qiandeng_maid_bridge', 'manifests/maid-bridge.lock.json')]
    for record, cache, mod_id, lock in artifacts:
        jar = Path(record['jar']).resolve()
        if not jar.is_relative_to(ROOT) or jar.is_symlink() or sha(jar) != record['sha256'] or record['ok'] is not True:
            raise ValueError('artifact_not_verified')
        sources = record.get('source_files') or [{'path': key, 'sha256': value} for key, value in record['sources'].items()]
        for row in sources:
            path = (ROOT / row['path']).resolve()
            if not path.is_relative_to(ROOT) or path.is_symlink() or sha(path) != row['sha256']:
                raise ValueError('source_changed_after_build')
    if speech.get('speech_protocol') != 2 or speech.get('playback_replaced_explicitly') is not True:
        raise ValueError('speech_protocol_not_verified')
    if not all(row.get('ok') for row in speech['tests'].values()) or maid['tests']['ok'] is not True:
        raise ValueError('artifact_tests_failed')
    config = read(ROOT / 'server/mc/data/godvoice/config.json')
    if config != {'listen': ['MengMeng']}: raise ValueError('recorder_allowlist_changed')
    result = {'project': 'qiandengji', 'ok': True, 'mode': 'apply' if apply else 'check',
        'artifacts': [{'modId': mod_id, 'filename': Path(row['jar']).name, 'sha256': row['sha256']} for row, _, mod_id, _ in artifacts],
        'worldReplaced': False, 'ownerChanges': 0, 'modelCalls': 0}
    if not apply: return result
    state = subprocess.check_output(['docker', 'inspect', 'qiandengji-mc-1', '--format', '{{.State.Running}}'], text=True).strip()
    if state != 'false': raise ValueError('stop_exact_project_mc_first')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = (ROOT / 'runtime/character-integration-backups' / stamp).resolve()
    if not backup.is_relative_to(ROOT / 'runtime'): raise ValueError('backup_outside_runtime')
    backup.mkdir(parents=True, exist_ok=False)
    # Preserve all player/entity/poi/region/datapack progress as one stopped copy.
    shutil.copytree(ROOT / 'server/mc/shadow', backup / 'shadow', symlinks=True)
    for relative in ('server/mc/config/touhou_little_maid/sites', 'server/mc/config/touhou_little_maid/settings'):
        source = ROOT / relative
        if source.exists(): shutil.copytree(source, backup / relative, symlinks=True)
    touched = []
    def preserve(path):
        if path.exists():
            destination = backup / path.relative_to(ROOT); destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
        touched.append(path.relative_to(ROOT).as_posix())
    client_path = ROOT / 'manifests/client.lock.json'; client = read(client_path)
    extensions_path = ROOT / 'manifests/server-extensions.lock.json'; extensions = read(extensions_path)
    for record, cache, mod_id, lock_name in artifacts:
        jar = Path(record['jar']); name = jar.name; digest = record['sha256']; size = jar.stat().st_size
        for destination in (ROOT / 'server/mc/mods' / name, ROOT / 'client/mods' / name, cache / name):
            preserve(destination); destination.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(jar, destination)
            if sha(destination) != digest: raise ValueError('copied_jar_mismatch')
        cache_record = cache / 'build-record.json'; preserve(cache_record); write(cache_record, record)
        lock_path = ROOT / lock_name; preserve(lock_path)
        write(lock_path, {'schema_version': 1, 'minecraft': '1.21.1', 'neoforge': '21.1.248',
            'client_only': False, 'server_required': True, 'files': [{'mod_id': mod_id, 'filename': name,
                'cache_path': (cache / name).relative_to(ROOT).as_posix(), 'sha256': digest, 'size_bytes': size,
                'client_only': False, 'source_build': 'world/god-voice-src/build.py' if mod_id == 'godvoice' else 'tools/build_maid_bridge.py'}]})
        client['files'] = [r for r in client['files'] if r['path'] != 'mods/' + name] + [
            {'path': 'mods/' + name, 'size': size, 'sha256': digest, 'source_sha256': digest,
             'source': 'client_extension', 'preserved_existing': False}]
        client['mods'] = [r for r in client['mods'] if r['file'] != name] + [
            {'file': name, 'source': 'client_extension', 'ids': [mod_id], 'sha256': digest}]
        extension = {'path': 'server/mc/mods/' + name, 'sha256': digest, 'client_required': True}
        extensions['files'] = [r for r in extensions['files'] if r['path'] != extension['path']] + [extension]
    for path, data in ((client_path, client), (extensions_path, extensions)):
        preserve(path); write(path, data)
    content_path = ROOT / 'config/content-mods.json'; content = read(content_path)
    if 'manifests/maid-bridge.lock.json' not in content['shared_extension_locks']:
        content['shared_extension_locks'].append('manifests/maid-bridge.lock.json')
    preserve(content_path); write(content_path, content)
    recording_path = ROOT / 'reports/recording-build.json'; preserve(recording_path)
    write(recording_path, speech | {'jar': str(ROOT / 'vendor/god-voice-cache/god-voice-0.1.0.jar'),
        'deployed_path': 'server/mc/mods/god-voice-0.1.0.jar', 'recording_allowlist_expanded': False,
        'scope': 'Recorder bytes preserved; speech queue explicitly replaced and tested. Physical capture/playback separate.'})
    result.update(backup=str(backup), touched=touched, finishedAt=datetime.now(timezone.utc).isoformat())
    write(backup / 'deployment.json', result)
    write(ROOT / 'reports/character-extensions-deployment.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--speech-record', type=Path, required=True)
    parser.add_argument('--apply', choices=['qiandengji'])
    args = parser.parse_args()
    try:
        print(json.dumps(deploy(args.speech_record, bool(args.apply)), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'errorType': type(exc).__name__, 'error': str(exc)[:160]}))
        sys.exit(1)
