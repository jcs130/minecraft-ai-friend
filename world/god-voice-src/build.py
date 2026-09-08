"""Build recorder or reviewed speech queue against installed Minecraft/SVC. Never deploys."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--libraries', type=Path, default=ROOT/'server/mc/libraries')
    parser.add_argument('--voicechat', type=Path, default=ROOT/'server/mc/mods/voicechat-neoforge-1.21.1-2.6.22.jar')
    parser.add_argument('--speech', action='store_true', help='Explicitly permit reviewed playback replacement; preserve recorder/entrypoints')
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get('JDK21_BIN',
        r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    suffix = '.exe' if os.name == 'nt' else ''
    javac, java = args.jdk_bin/('javac'+suffix), args.jdk_bin/('java'+suffix)
    assert javac.is_file() and java.is_file(), 'Java 21 JDK required'
    assert args.voicechat.is_file(), 'Existing Simple Voice Chat 2.6.22 JAR required'
    spec = importlib.util.spec_from_file_location('voice_server_cp', ROOT/'world/botgate-src/build.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    dependencies = list(dict.fromkeys([*map(Path, server.full_cp(args.libraries).split(os.pathsep)), args.voicechat]))
    sources = sorted((HERE/'dev').rglob('*.java'))
    origin = json.loads((HERE/'source-origin.json').read_text(encoding='utf-8-sig'))
    changed = {'dev/god/godvoice/MicCapture.java'}
    if args.speech:
        changed.add('dev/god/godvoice/TtsQueueWatcher.java')
    unchanged = [row for row in origin['files'] if row['path'] not in changed]
    assert all(digest(HERE/row['path']) == row['sha256'] for row in unchanged), 'Original playback/entrypoint/resources must stay unchanged'
    build_root = (ROOT/'runtime/god-voice-build').resolve()
    assert build_root.is_relative_to(ROOT.resolve())
    build_root.mkdir(parents=True, exist_ok=True)
    if args.speech:
        build_root = build_root/('speech-'+uuid.uuid4().hex)
        build_root.mkdir()
    output = build_root/'god-voice-0.1.0.jar' if args.speech else ROOT/'vendor/god-voice-cache/god-voice-0.1.0.jar'
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='classes-', dir=build_root) as temporary:
        classes = Path(temporary).resolve()
        assert classes.is_relative_to(build_root)
        quote = lambda value: '"' + str(value).replace('\\', '/').replace('"', '\\"') + '"'
        argfile = classes/'javac.args'
        argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp',
            quote(os.pathsep.join(map(str, dependencies))), '-d', quote(classes), *map(quote, sources)])+'\n', encoding='utf-8')
        subprocess.run([str(javac), '@'+str(argfile)], check=True, timeout=180)
        tests = classes/'tests'
        tests.mkdir()
        pure_sources = [HERE/'dev/god/godvoice'/name for name in ('CaptureInterval.java', 'CaptureFence.java',
            'SpeechLane.java', 'SpeechFrames.java', 'SpeechJob.java', 'SpeechReceipts.java', 'SpeechHealth.java')]
        pure_cp = os.pathsep.join(str(path) for path in dependencies if path.name.startswith('gson-'))
        assert pure_cp, 'Installed Gson required for speech disk-contract tests'
        test_sources = sorted((HERE/'tests').glob('*.java'))
        subprocess.run([str(javac), '--release', '21', '-encoding', 'UTF-8', '-cp', pure_cp, '-d', str(tests),
            *map(str, pure_sources), *map(str, test_sources)], check=True, timeout=60)
        test_results = {}
        for test in test_sources:
            result = subprocess.run([str(java), '-cp', os.pathsep.join([str(tests), pure_cp]), 'dev.god.godvoice.'+test.stem],
                check=True, capture_output=True, text=True, encoding='utf-8', timeout=15)
            test_results[test.stem] = json.loads(result.stdout)
            assert test_results[test.stem].get('ok') is True
        runtime_source = HERE/'tests-runtime/StaffBoundaryRegistrationTest.java'
        runtime_cp = os.pathsep.join(map(str, [classes, *dependencies]))
        subprocess.run([str(javac), '--release', '21', '-encoding', 'UTF-8', '-cp', runtime_cp,
            '-d', str(tests), str(runtime_source), str(HERE/'tests-runtime/SpeechAudioPlayerContractTest.java')], check=True, timeout=60)
        audio_result = subprocess.run([str(java), '-cp', os.pathsep.join([str(tests), runtime_cp]),
            'dev.god.godvoice.SpeechAudioPlayerContractTest'], check=True, capture_output=True, text=True, encoding='utf-8', timeout=15)
        test_results['SpeechAudioPlayerContractTest'] = json.loads(audio_result.stdout.strip().splitlines()[-1])
        chanting = ROOT/'vendor/chanting-cache/qiandeng-chanting-0.1.0.jar'
        assert chanting.is_file(), 'Actual optional staff boundary JAR required for registration regression'
        for present in (False, True):
            cp = os.pathsep.join(map(str, [tests, classes, *dependencies, *([chanting] if present else [])]))
            result = subprocess.run([str(java), '-cp', cp, 'dev.god.godvoice.StaffBoundaryRegistrationTest',
                'present' if present else 'absent'], check=True, capture_output=True, text=True, encoding='utf-8', timeout=30)
            test_results['StaffBoundaryRegistrationTest_'+('present' if present else 'absent')] = json.loads(result.stdout.strip().splitlines()[-1])
        entries = [(path, path.relative_to(classes).as_posix()) for path in (classes/'dev').rglob('*.class')]
        entries += [(HERE/'META-INF/neoforge.mods.toml', 'META-INF/neoforge.mods.toml')]
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path, name in sorted(entries, key=lambda entry: entry[1]):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, path.read_bytes())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None, 'Recorder JAR CRC verification failed'
        assert not any('Test' in name or name.endswith(('.java', '.py', '.json')) for name in archive.namelist())
        baseline = ROOT/'server/mc/mods/god-voice-0.1.0.jar'
        with zipfile.ZipFile(baseline) as existing:
            names = ([name for name in existing.namelist() if name.startswith('dev/god/godvoice/')
                and name.endswith('.class') and not name.startswith('dev/god/godvoice/TtsQueueWatcher')]
                if args.speech else ['dev/god/godvoice/'+name+'.class' for name in ('GodVoiceLog', 'GodVoiceMod', 'GodVoicePlugin', 'TtsQueueWatcher')])
            bytecode = {name: existing.read(name) == archive.read(name) for name in names}
            assert all(bytecode.values()), 'Protected recorder/entrypoint bytecode differs; review before deployment'
            assert existing.read('META-INF/neoforge.mods.toml') == archive.read('META-INF/neoforge.mods.toml')
    inputs = [*sources, HERE/'build.py', HERE/'source-origin.json', *sorted((HERE/'tests').glob('*.java')), *sorted((HERE/'tests-runtime').glob('*.java')), HERE/'META-INF/neoforge.mods.toml']
    record = {'ok': True, 'mod_id': 'godvoice', 'version': '0.1.0', 'recording_schema': 2,
        'minecraft': '1.21.1', 'neoforge': '21.1.248', 'java_release': 21, 'side': 'server',
        'jar': str(output.resolve()), 'sha256': digest(output), 'tests': test_results, 'registration_test_chanting_sha256': digest(chanting),
        'source_files': [{'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)} for path in sorted(inputs)],
        'unchanged_origin_files': unchanged, 'recording_allowlist_expanded': False,
        'unchanged_server_bytecode': bytecode, 'comparison_server_jar_sha256': digest(baseline),
        'classpath': [{'path': str(path), 'sha256': digest(path)} for path in dependencies],
        'scope': 'Compiled recorder and speech queue, disk contracts and installed SVC with fake encoder/channel; no deployment, microphone capture or audible playback test'}
    if args.speech:
        record.update(speech_schema=2, speech_protocol=2, playback_replaced_explicitly=True,
            health_path='data/godvoice/.speech-health.json', health_interval_seconds=1,
            queue_limit_per_entity=4, active_limit_per_entity=1)
    path = build_root/'build-record.json'
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'jar': str(output), 'sha256': record['sha256'],
                      'record': str(path), 'tests': record['tests']}))


if __name__ == '__main__':
    main()
