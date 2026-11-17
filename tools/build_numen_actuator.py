"""Compile the existing actuator against the installed Numen API; no deployment."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'world/numen-actuator-src'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resource-root', type=Path, default=ROOT)
    parser.add_argument('--output-dir', type=Path, default=SOURCE / 'build')
    parser.add_argument('--baseline-jar', type=Path)
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get(
        'JDK21_BIN', r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    mods = args.resource_root / 'server/mc/mods'
    numens = list(mods.glob('numen-neoforge-*.jar'))
    actuators = list(mods.glob('numen_act-neoforge-*.jar'))
    if len(numens) != 1 or len(actuators) > 1:
        raise ValueError('exact_numen_and_at_most_one_actuator_required')
    numen = numens[0]
    # Without a baseline JAR the mod is assembled from source resources (Numen 0.1.5+).
    baseline = args.baseline_jar or (actuators[0] if actuators else None)
    build = args.output_dir.resolve()
    if not build.is_relative_to(ROOT.resolve()):
        raise ValueError('build_output_must_be_within_project')
    build.mkdir(parents=True, exist_ok=True)
    if (build / 'build-record.json').exists() and build != (SOURCE / 'build').resolve():
        raise ValueError('isolated_build_record_already_exists')
    spec = importlib.util.spec_from_file_location('actuator_classpath', ROOT / 'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    libraries = helper.full_cp(args.resource_root / 'server/mc/libraries')
    sources = sorted((SOURCE / 'neoforge/src/main/java').rglob('*.java'))
    with tempfile.TemporaryDirectory(prefix='compile-', dir=build) as temporary:
        work = Path(temporary)
        with zipfile.ZipFile(numen) as archive:
            nested = [n for n in archive.namelist() if n.startswith('META-INF/jarjar/')
                      and n.endswith('.jar') and 'numen_api' in n]
            if len(nested) != 1:
                raise ValueError('exact_numen_api_required')
            api = work / 'numen-api.jar'
            api.write_bytes(archive.read(nested[0]))
        cp = os.pathsep.join([libraries, str(api), str(numen)])
        classes = work / 'classes'
        classes.mkdir()
        quote = lambda value: '"' + str(value).replace('\\', '/') + '"'
        argfile = work / 'javac.args'
        argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8',
            '-cp', quote(cp), '-d', quote(classes), *(quote(p) for p in sources)]), encoding='utf8')
        subprocess.run([str(args.jdk_bin / ('javac.exe' if os.name == 'nt' else 'javac')),
                        '@' + str(argfile)], check=True, timeout=180)
        test_source = SOURCE / 'tests/ExistingBodyRestoreContractTest.java'
        test_cp = os.pathsep.join([str(classes), cp])
        test_args = work / 'test-javac.args'
        test_args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8',
            '-cp', quote(test_cp), '-d', quote(classes), quote(test_source)]), encoding='utf8')
        subprocess.run([str(args.jdk_bin / ('javac.exe' if os.name == 'nt' else 'javac')),
                        '@' + str(test_args)], check=True, timeout=90)
        test = subprocess.run([str(args.jdk_bin / ('java.exe' if os.name == 'nt' else 'java')),
                               '-cp', test_cp, 'ExistingBodyRestoreContractTest'],
                              capture_output=True, text=True, encoding='utf8', errors='replace', timeout=45)
        (build / 'restore-contract-output.txt').write_text(test.stdout + test.stderr, encoding='utf8')
        test.check_returncode()
        test_result = json.loads(test.stdout.strip().splitlines()[-1])
        if test_result.get('ok') is not True or test_result.get('assertions', 0) < 40:
            raise ValueError('restore_contract_test_failed')
        numen_version = numen.stem.rsplit('-', 1)[-1]
        target = build / (baseline.name if baseline else f'numen_act-neoforge-1.21.1-{numen_version}.jar')
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as after:
            preserved = []
            if baseline:
                with zipfile.ZipFile(baseline) as before:
                    for name in before.namelist():
                        if name.startswith('com/dwinovo/numen/actuator/') and name.endswith('.class'):
                            continue
                        after.writestr(name, before.read(name))
                        preserved.append(name)
            else:
                values = {'mod_id': 'numen_act', 'version': numen_version,
                          'neoforge_loader_version_range': '[4,)', 'neoforge_version': '21.1.233',
                          'minecraft_version_range': '[1.21.1, 1.21.2)'}
                toml = (SOURCE / 'neoforge/src/main/resources/META-INF/neoforge.mods.toml').read_text(encoding='utf8')
                for key, value in values.items():
                    toml = toml.replace('${' + key + '}', value)
                if '${' in toml:
                    raise ValueError('unexpanded_mods_toml_property')
                after.writestr('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\r\n'
                               f'Implementation-Title: numen_act\r\nImplementation-Version: {numen_version}\r\n\r\n')
                after.writestr('META-INF/neoforge.mods.toml', toml)
                preserved = ['META-INF/MANIFEST.MF', 'META-INF/neoforge.mods.toml']
            for path in sorted(classes.rglob('*.class')):
                if not path.relative_to(classes).as_posix().startswith('com/dwinovo/numen/actuator/'):
                    continue  # Isolated test classes never enter the production mod.
                after.write(path, path.relative_to(classes).as_posix())
        with zipfile.ZipFile(target) as archive:
            if archive.testzip():
                raise ValueError('archive_crc_failed')
        record = {'ok': True, 'jar': str(target), 'sha256': sha(target),
                  'baseline': str(baseline) if baseline else 'assembled from source resources',
                  'baselineSha256': sha(baseline) if baseline else None,
                  'numenJar': str(numen), 'numenSha256': sha(numen),
                  'sources': {p.relative_to(ROOT).as_posix(): sha(p) for p in [*sources, Path(__file__)]},
                  'tests': {'restoreContract': dict(test_result, source=test_source.relative_to(ROOT).as_posix(),
                      sourceSha256=sha(test_source), outputSha256=sha(build / 'restore-contract-output.txt'))},
                  'preservedEntries': preserved, 'deployment': 'not performed'}
        (build / 'build-record.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
        print(json.dumps({k: record[k] for k in ('ok', 'jar', 'sha256', 'deployment')}))


if __name__ == '__main__':
    main()
