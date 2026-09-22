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
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get(
        'JDK21_BIN', r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    mods = args.resource_root / 'server/mc/mods'
    numens = list(mods.glob('numen-neoforge-*.jar'))
    actuators = list(mods.glob('numen_act-neoforge-*.jar'))
    if len(numens) != 1 or len(actuators) != 1:
        raise ValueError('exact_numen_and_actuator_required')
    numen, baseline = numens[0], actuators[0]
    build = SOURCE / 'build'
    build.mkdir(exist_ok=True)
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
        target = build / baseline.name
        with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as after:
            preserved = []
            for name in before.namelist():
                if name.startswith('com/dwinovo/numen/actuator/') and name.endswith('.class'):
                    continue
                after.writestr(name, before.read(name))
                preserved.append(name)
            for path in sorted(classes.rglob('*.class')):
                after.write(path, path.relative_to(classes).as_posix())
        with zipfile.ZipFile(target) as archive:
            if archive.testzip():
                raise ValueError('archive_crc_failed')
        record = {'ok': True, 'jar': str(target), 'sha256': sha(target),
                  'baseline': str(baseline), 'baselineSha256': sha(baseline),
                  'numenJar': str(numen), 'numenSha256': sha(numen),
                  'sources': {p.relative_to(ROOT).as_posix(): sha(p) for p in [*sources, Path(__file__)]},
                  'preservedEntries': preserved, 'deployment': 'not performed'}
        (build / 'build-record.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
        print(json.dumps({k: record[k] for k in ('ok', 'jar', 'sha256', 'deployment')}))


if __name__ == '__main__':
    main()
