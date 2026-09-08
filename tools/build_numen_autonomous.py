"""Add owner-offline autonomous-body tickets to the exact deployed Numen fork. Never deploy."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
import zipfile

import build_numen_walk_only as common

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'world/numen-patches'
MANIFEST = DIRECTORY / 'autonomous-body-tick-v1.json'
NATIVE = DIRECTORY / 'autonomous-src/com/dwinovo/numen/core/entity/AutonomousBodyTick.java'
TEST = DIRECTORY / 'tests/AutonomousTickPolicyTest.java'
ENTRY = 'com/dwinovo/numen/core/NumenCoreNeoForge.java'


def restored_entry(original):
    needle = '        NumenCore.init();'
    if original.count(needle) != 1:
        raise ValueError('original_entry_changed')
    return original.replace(needle, needle + '\n\n'
        '        NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.RegisterCommandsEvent e) ->\n'
        '                com.dwinovo.numen.core.entity.ExistingBodyRestore.register(e.getDispatcher()));')


def verify_baseline(path, manifest):
    if common.sha(path.read_bytes()) != manifest['baselineJarSha256']:
        raise ValueError('exact_deployed_numen_baseline_required')
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip():
            raise ValueError('baseline_archive_invalid')
        hashes = {name: common.sha(archive.read(name)) for name in names}
        if hashes.get(ENTRY[:-5] + '.class') != manifest['entryBaselineClassSha256']:
            raise ValueError('baseline_entry_changed')
        if any(hashes.get(name) != digest for name, digest in manifest['embeddedApiHashes'].items()):
            raise ValueError('native_api_changed')
        return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    native_source = json.loads((ROOT / 'manifests/ai-components.lock.json').read_text(encoding='utf-8-sig'))['source_locations']['numen_source']
    parser.add_argument('--source', type=Path, default=Path(native_source))
    parser.add_argument('--baseline-jar', type=Path, default=ROOT / 'server/mc/mods/numen-neoforge-1.21.1-0.1.1.jar')
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get('JDK21_BIN',
        r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding='utf8'))
    originals = verify_baseline(args.baseline_jar, manifest)
    actuator = ROOT / 'server/mc/mods/numen_act-neoforge-1.21.1-0.1.1.jar'
    if common.sha(actuator.read_bytes()) != manifest['actuatorJarSha256']:
        raise ValueError('actuator_changed')
    head = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
    if head != manifest['sourceCommit']:
        raise ValueError('source_commit_changed')
    common.verify_sources(args.source, manifest)
    patch = DIRECTORY / 'autonomous-body-tick-v1.patch'
    if common.sha(patch.read_bytes()) != manifest['patchSha256']:
        raise ValueError('patch_hash_changed')
    if common.sha(common.normalized(NATIVE)) != manifest['nativeSourceSha256']:
        raise ValueError('native_source_hash_changed')
    original = restored_entry((args.source / manifest['entrySource']).read_text(encoding='utf8'))
    if common.sha(original.encode('utf8')) != manifest['entryPreimageSha256']:
        raise ValueError('restored_entry_preimage_changed')
    build = ROOT / 'runtime/numen-autonomous-build' / uuid.uuid4().hex
    source, classes, tests = build / 'source', build / 'classes', build / 'tests'
    source.mkdir(parents=True); classes.mkdir(); tests.mkdir()
    baseline = build / 'baseline-numen.jar'
    shutil.copy2(args.baseline_jar, baseline)
    verify_baseline(baseline, manifest)
    entry_file = source / ENTRY
    entry_file.parent.mkdir(parents=True)
    entry_file.write_text(original, encoding='utf8', newline='\n')
    subprocess.run(['git', 'init', '-q', str(source)], check=True)
    subprocess.run(['git', '-C', str(source), 'apply', '--check', str(patch)], check=True)
    subprocess.run(['git', '-C', str(source), 'apply', str(patch)], check=True)
    if common.sha(common.normalized(entry_file)) != manifest['entryPostimageSha256']:
        raise ValueError('patched_entry_changed')
    native_file = source / 'com/dwinovo/numen/core/entity/AutonomousBodyTick.java'
    native_file.parent.mkdir(parents=True)
    shutil.copy2(NATIVE, native_file)
    dependencies = common.embedded_dependencies(baseline, build / 'dependencies')
    spec = importlib.util.spec_from_file_location('numen_autonomous_cp', ROOT / 'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    cp = os.pathsep.join([str(baseline), *(str(p) for p in dependencies), helper.full_cp(ROOT / 'server/mc/libraries')])
    quote = lambda value: '"' + str(value).replace('\\', '/') + '"'
    suffix = '.exe' if os.name == 'nt' else ''
    javac, java = str(args.jdk_bin / ('javac' + suffix)), str(args.jdk_bin / ('java' + suffix))
    argfile = build / 'javac.args'
    argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp),
        '-d', quote(classes), quote(entry_file), quote(native_file)]), encoding='utf8')
    subprocess.run([javac, '@' + str(argfile)], check=True, timeout=120)
    test_cp = os.pathsep.join([str(classes), cp])
    subprocess.run([javac, '-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', test_cp,
        '-d', str(tests), str(TEST)], check=True, timeout=60)
    result = subprocess.run([java, '-cp', os.pathsep.join([str(tests), test_cp]), 'AutonomousTickPolicyTest'],
        check=True, text=True, capture_output=True, timeout=60)
    assertions = json.loads(result.stdout.strip().splitlines()[-1])
    if assertions.get('ok') is not True or assertions.get('assertions', 0) < 30:
        raise ValueError('autonomous_policy_test_failed')
    jar = build / 'numen-neoforge-1.21.1-0.1.1-autonomous-v1.jar'
    preservation = common.overlay_jar(baseline, classes, jar, set(manifest['classFamilies']))
    evidence = (Path(__file__).resolve(), ROOT / 'tools/build_numen_walk_only.py', ROOT / 'world/botgate-src/build.py',
                MANIFEST, patch, NATIVE, TEST, ROOT / manifest['configSource'])
    record = {'ok': True, 'capability': manifest['capability'], 'preservedCapabilities': manifest['preservedCapabilities'],
        'jar': str(jar), 'sha256': common.sha(jar.read_bytes()), 'baselineJar': str(baseline),
        'baselineJarSha256': manifest['baselineJarSha256'], 'sourceCommit': head, 'source': str(source),
        'sourceHashes': {p.relative_to(source).as_posix(): common.sha(common.normalized(p)) for p in source.rglob('*.java')},
        'originalEntryHashes': originals, 'embeddedApiHashes': manifest['embeddedApiHashes'],
        'sourceFiles': {p.relative_to(ROOT).as_posix(): common.sha(p.read_bytes()) for p in evidence},
        'tests': assertions, 'deployment': 'not performed', 'configPath': manifest['configPath'],
        'livePhysicsVerified': False, **preservation}
    for path in (build / 'build-record.json', build.parent / 'latest.json'):
        path.write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
    print(json.dumps({key: record[key] for key in ('ok', 'jar', 'sha256', 'tests', 'preservedEntries', 'deployment')}))


if __name__ == '__main__':
    main()
