"""Compile exact-identity reconnect/death recovery onto the verified local Numen fork; never deploy."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

import build_numen_walk_only as common

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'world/numen-patches'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default_source = json.loads((ROOT/'manifests/ai-components.lock.json').read_text(encoding='utf-8-sig'))['source_locations']['numen_source']
    parser.add_argument('--source', type=Path, default=Path(default_source))
    parser.add_argument('--baseline-jar', type=Path, default=ROOT/'server/mc/mods/numen-neoforge-1.21.1-0.1.1.jar')
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get('JDK21_BIN',
        r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    manifest = json.loads((DIRECTORY/'restore-existing-v1.json').read_text(encoding='utf8'))
    if common.sha(args.baseline_jar.read_bytes()) != manifest['baselineJarSha256']:
        raise SystemExit('Exact manifest-locked local Numen baseline required; never replace another fork')
    if common.sha((ROOT/'server/mc/mods/numen_act-neoforge-1.21.1-0.1.1.jar').read_bytes()) != manifest['actuatorJarSha256']:
        raise SystemExit('Actuator changed; compatibility audit required')
    head = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
    if head != manifest['sourceCommit']:
        raise SystemExit('Local Numen source commit changed')
    common.verify_sources(args.source, manifest)
    build = ROOT/'runtime/numen-body-restore-build'/uuid.uuid4().hex
    source, classes, tests = build/'source', build/'classes', build/'tests'
    source.mkdir(parents=True); classes.mkdir(); tests.mkdir()
    baseline = build/'baseline-numen.jar'
    shutil.copy2(args.baseline_jar, baseline)
    if common.sha(baseline.read_bytes()) != manifest['baselineJarSha256']:
        raise SystemExit('Baseline changed while preparing the build')
    entry = manifest['entrySource']
    original = (args.source/entry).read_text(encoding='utf8')
    needle = '        NumenCore.init();'
    if original.count(needle) != 1:
        raise SystemExit('Entry point changed')
    patched = original.replace(needle, needle + '\n\n'
        '        NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.RegisterCommandsEvent e) ->\n'
        '                com.dwinovo.numen.core.entity.ExistingBodyRestore.register(e.getDispatcher()));')
    entry_file = source/'com/dwinovo/numen/core/NumenCoreNeoForge.java'
    entry_file.parent.mkdir(parents=True); entry_file.write_text(patched, encoding='utf8')
    native = DIRECTORY/'restore-src/com/dwinovo/numen/core/entity/ExistingBodyRestore.java'
    if common.sha(common.normalized(native)) != manifest['restoreSourceSha256']:
        raise SystemExit('Restore source hash does not match manifest')
    native_file = source/'com/dwinovo/numen/core/entity/ExistingBodyRestore.java'
    native_file.parent.mkdir(parents=True); shutil.copy2(native, native_file)
    dependencies = common.embedded_dependencies(baseline, build/'dependencies')
    spec = importlib.util.spec_from_file_location('numen_restore_cp', ROOT/'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    cp = os.pathsep.join([str(baseline), *(str(p) for p in dependencies), helper.full_cp(ROOT/'server/mc/libraries')])
    quote = lambda p: '"' + str(p).replace('\\', '/') + '"'
    argfile = build/'javac.args'
    argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp),
        '-d', quote(classes), quote(entry_file), quote(native_file)]), encoding='utf8')
    suffix = '.exe' if os.name == 'nt' else ''
    javac, java = str(args.jdk_bin/('javac'+suffix)), str(args.jdk_bin/('java'+suffix))
    subprocess.run([javac, '@'+str(argfile)], check=True, timeout=120)
    subprocess.run([javac, '-proc:none', '--release', '21', '-cp', os.pathsep.join([str(classes), cp]),
        '-d', str(tests), str(DIRECTORY/'tests/ExistingBodyRestoreTest.java')], check=True, timeout=60)
    result = subprocess.run([java, '-cp', os.pathsep.join([str(tests), str(classes), cp]),
        'ExistingBodyRestoreTest'], check=True, capture_output=True, text=True, timeout=60)
    target = build/'numen-neoforge-1.21.1-0.1.1-body-restore-v1.jar'
    preservation = common.overlay_jar(baseline, classes, target, set(manifest['classFamilies']))
    report = {'ok': True, 'jar': str(target), 'sha256': common.sha(target.read_bytes()),
        'sourceCommit': head, 'baselineJar': str(baseline), 'baselineJarSha256': manifest['baselineJarSha256'],
        'source': str(source), 'sourceHashes': {p.relative_to(source).as_posix():common.sha(common.normalized(p))
            for p in source.rglob('*.java')}, 'tests': json.loads(result.stdout.strip().splitlines()[-1]),
        'capability': 'existing_body_restore_v1', 'deployment': 'not performed', **preservation}
    report['sourceFiles'] = {p.relative_to(ROOT).as_posix(): common.sha(p.read_bytes()) for p in (
        Path(__file__).resolve(), ROOT/'tools/build_numen_walk_only.py',
        ROOT/'world/botgate-src/build.py', DIRECTORY/'restore-existing-v1.json', native,
        DIRECTORY/'tests/ExistingBodyRestoreTest.java')}
    for path in (build/'build-record.json', build.parent/'latest.json'):
        path.write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    print(json.dumps({k:report[k] for k in ('ok','jar','sha256','tests','preservedEntries','deployment')}))


if __name__ == '__main__':
    main()
