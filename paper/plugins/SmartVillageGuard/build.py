"""Build SmartVillageGuard without installing or restarting anything."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--server', type=Path, required=True)
parser.add_argument('--jdk', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
here = Path(__file__).resolve().parent
repo = here.parents[2]
suffix = '.exe' if os.name == 'nt' else ''
libs = [*args.server.glob('versions/**/*.jar'), *args.server.glob('libraries/**/*.jar'), *args.server.glob('plugins/*.jar')]
assert libs, 'no compile jars found'
args.output.mkdir(parents=True, exist_ok=False)
classes = args.output / 'classes'
tests = args.output / 'test-classes'
classes.mkdir()
tests.mkdir()


def argfile(name, values):
    path = args.output / name
    path.write_text('\n'.join('"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"' for value in values), encoding='utf-8')
    return '@' + str(path)


def run(name, values):
    log = args.output / (name + '.log')
    with log.open('wb') as stream:
        result = subprocess.run(values, stdout=stream, stderr=subprocess.STDOUT)
    text = log.read_text(encoding='utf-8', errors='replace')
    assert result.returncode == 0, name + ' failed:\n' + text[-4000:]
    return text


javac = str(args.jdk / ('bin/javac' + suffix))
java = str(args.jdk / ('bin/java' + suffix))
cp = os.pathsep.join(map(str, libs))
sources = sorted(here.glob('src/**/*.java'))
test_sources = sorted(here.glob('tests/**/*.java'))
run('compile', [javac, argfile('compile.args', ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', cp, '-d', classes, *sources])])
test_cp = os.pathsep.join([str(classes), cp])
run('compile-tests', [javac, argfile('tests.args', ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', test_cp, '-d', tests, *test_sources])])
rules = run('rules', [java, '-ea', argfile('rules.args', ['-cp', os.pathsep.join([str(tests), test_cp]), 'org.qiandengji.smartvillage.SmartVillageGuardTest'])])
assert 'passed=true' in rules, rules
jar = args.output / 'SmartVillageGuard-1.0.0.jar'
with zipfile.ZipFile(jar, 'x', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(classes.rglob('*.class')):
        archive.write(file, file.relative_to(classes).as_posix())
    for resource in ('plugin.yml', 'config.yml'):
        archive.write(here / 'resources' / resource, resource)
report = {'productionChanged': False, 'version': '1.0.0', 'rules': rules.strip(),
          'jar': {'path': str(jar), 'sha256': hashlib.sha256(jar.read_bytes()).hexdigest()},
          'sources': {str(file.relative_to(repo)).replace('\\', '/'): hashlib.sha256(file.read_bytes()).hexdigest() for file in sources}}
(args.output / 'build.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(json.dumps({'version': '1.0.0', 'rules': rules.strip(), 'jar': report['jar']}, ensure_ascii=False))
