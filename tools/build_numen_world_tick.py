"""Overlay autonomous vanilla world ticking on the exact body-tick-v1 JAR; never deploy."""
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
MANIFEST = ROOT / 'world/numen-patches/autonomous-world-tick-v2.json'
VERSION_SOURCE = ROOT / 'world/numen-patches/versions/autonomous-world-tick-v2'
ARCHIVE = VERSION_SOURCE / 'archive.json'
NATIVE = VERSION_SOURCE / 'src/com/dwinovo/numen/core/entity/AutonomousBodyTick.java'
TEST = VERSION_SOURCE / 'tests/AutonomousTickPolicyTest.java'


def verify_baseline(path, manifest):
    if common.sha(path.read_bytes()) != manifest['baselineJarSha256']:
        raise ValueError('exact_autonomous_v1_baseline_required')
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip():
            raise ValueError('baseline_archive_invalid')
        hashes = {name: common.sha(archive.read(name)) for name in names}
        if any(hashes.get(name) != digest for name, digest in manifest['baselineClassHashes'].items()):
            raise ValueError('native_baseline_classes_changed')
        return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-jar', type=Path, default=ROOT/'server/mc/mods/numen-neoforge-1.21.1-0.1.1.jar')
    parser.add_argument('--output-root', type=Path, default=ROOT/'runtime/numen-world-tick-build')
    parser.add_argument('--no-latest', action='store_true', help='Keep existing latest records unchanged when rebuilding history.')
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get('JDK21_BIN',
        r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text('utf8'))
    archive = json.loads(ARCHIVE.read_text('utf8'))
    if (archive.get('schema') != 1 or archive.get('capability') != manifest['capability']
            or archive.get('baselineJarSha256') != manifest['baselineJarSha256']
            or any(common.sha(common.normalized(VERSION_SOURCE / name)) != digest
                for name, digest in archive['sourceHashes'].items())):
        raise ValueError('historical_v2_source_archive_changed')
    originals = verify_baseline(args.baseline_jar, manifest)
    output_root = args.output_root.resolve()
    if not output_root.is_relative_to((ROOT/'runtime').resolve()):
        raise ValueError('output_must_be_project_runtime')
    build = output_root/uuid.uuid4().hex
    source, classes, tests = build/'source', build/'classes', build/'tests'
    source.mkdir(parents=True); classes.mkdir(); tests.mkdir()
    baseline = build/'baseline-numen.jar'
    shutil.copy2(args.baseline_jar, baseline)
    verify_baseline(baseline, manifest)
    native_file = source/'com/dwinovo/numen/core/entity/AutonomousBodyTick.java'
    native_file.parent.mkdir(parents=True)
    shutil.copy2(NATIVE, native_file)
    dependencies = common.embedded_dependencies(baseline, build/'dependencies')
    spec = importlib.util.spec_from_file_location('numen_world_tick_cp', ROOT/'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    cp = os.pathsep.join([str(baseline), *(str(p) for p in dependencies), helper.full_cp(ROOT/'server/mc/libraries')])
    quote = lambda value: '"' + str(value).replace('\\', '/') + '"'
    suffix = '.exe' if os.name == 'nt' else ''
    javac, java = [str(args.jdk_bin/(tool+suffix)) for tool in ('javac','java')]
    argfile = build/'javac.args'
    argfile.write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(cp),
        '-d',quote(classes),quote(native_file)]), 'utf8')
    subprocess.run([javac,'@'+str(argfile)],check=True,timeout=120)
    test_cp = os.pathsep.join([str(classes),cp])
    subprocess.run([javac,'-proc:none','--release','21','-encoding','UTF-8','-cp',test_cp,
        '-d',str(tests),str(TEST)],check=True,timeout=60)
    result = subprocess.run([java,'-cp',os.pathsep.join([str(tests),test_cp]),'AutonomousTickPolicyTest'],
        check=True,text=True,capture_output=True,timeout=60)
    assertions = json.loads(result.stdout.strip().splitlines()[-1])
    if assertions.get('ok') is not True or assertions.get('assertions',0)<34:
        raise ValueError('autonomous_policy_test_failed')
    jar = build/'numen-neoforge-1.21.1-0.1.1-world-tick-v2.jar'
    preservation = common.overlay_jar(baseline,classes,jar,set(manifest['classFamilies']))
    if common.sha(jar.read_bytes()) != archive['expectedOutputJarSha256']:
        raise ValueError('historical_v2_output_differs_from_approved_jar')
    evidence = (Path(__file__).resolve(),ROOT/'tools/build_numen_walk_only.py',ROOT/'world/botgate-src/build.py',
        MANIFEST,ARCHIVE,NATIVE,TEST)
    record = {'ok':True,'capability':manifest['capability'],'preservedCapabilities':manifest['preservedCapabilities'],
        'jar':str(jar),'sha256':common.sha(jar.read_bytes()),'baselineJar':str(baseline),
        'baselineJarSha256':manifest['baselineJarSha256'],'source':str(source),
        'sourceHashes':{p.relative_to(source).as_posix():common.sha(common.normalized(p)) for p in source.rglob('*.java')},
        'originalEntryHashes':originals,'sourceFiles':{p.relative_to(ROOT).as_posix():common.sha(p.read_bytes()) for p in evidence},
        'tests':assertions,'deployment':'not performed','livePhysicsVerified':False,**preservation}
    for path in ([build/'build-record.json'] + ([] if args.no_latest else [build.parent/'latest.json'])):
        path.write_text(json.dumps(record,indent=2)+'\n','utf8')
    print(json.dumps({key:record[key] for key in ('ok','jar','sha256','tests','preservedEntries','deployment')}))


if __name__ == '__main__':main()
