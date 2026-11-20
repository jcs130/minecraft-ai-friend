"""Build qiandeng-villager-quests (candidate only: does not install, reload or restart anything).

    python build.py --server /isolated/youer-or-paper-1.21.1 --jdk /path/to/jdk21 --output /new/output
    python build.py --classpath-dir /dir/with/paper-api-1.21.1-and-deps --jdk /path/to/jdk21 --output /new/output

--server reads versions/**/*.jar, libraries/**/*.jar and plugins/*.jar from that directory (Paper/Youer layout).
--classpath-dir takes every *.jar in one directory, e.g. paper-api 1.21.1-R0.1-SNAPSHOT and its compile deps.
Citizens and the DeepSeek plugin are reached by reflection, so they are not needed to compile.
"""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, zipfile

VERSION = '0.1.2'
p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
src_group = p.add_mutually_exclusive_group(required=True)
src_group.add_argument('--server', type=Path)
src_group.add_argument('--classpath-dir', type=Path)
p.add_argument('--jdk', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
here = Path(__file__).resolve().parent
repo = here.parents[2]
suffix = '.exe' if os.name == 'nt' else ''
digest = lambda file: hashlib.sha256(Path(file).read_bytes()).hexdigest()

if a.server:
    libs = [*a.server.glob('versions/**/*.jar'), *a.server.glob('libraries/**/*.jar'), *a.server.glob('plugins/*.jar')]
else:
    libs = sorted(a.classpath_dir.glob('*.jar'))
assert libs, 'no compile jars found'

a.output.mkdir(parents=True, exist_ok=False)
classes = a.output / 'classes'; classes.mkdir()
tests = a.output / 'test-classes'; tests.mkdir()


def args_file(name, values):
    path = a.output / name
    path.write_text('\n'.join('"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"' for v in values), encoding='utf8')
    return '@' + str(path)


def run(name, argv):
    with (a.output / (name + '.log')).open('wb') as log:
        r = subprocess.run(argv, stdout=log, stderr=subprocess.STDOUT)
    text = (a.output / (name + '.log')).read_text(encoding='utf8', errors='replace')
    assert r.returncode == 0, name + ' failed:\n' + text[-4000:]
    return text


javac, java = str(a.jdk / ('bin/javac' + suffix)), str(a.jdk / ('bin/java' + suffix))
sources = sorted(here.glob('src/**/*.java'))
run('compile', [javac, args_file('compile.args', ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', os.pathsep.join(map(str, libs)), '-d', classes, *sources])])
core = sorted(here.glob('src/org/qiandengji/villagerquests/core/*.java'))
test_src = sorted(here.glob('tests/**/*.java'))
# Same classpath as the plugin, so the rules run against the gson the server actually ships.
cp = os.pathsep.join(map(str, libs))
run('compile-tests', [javac, args_file('tests.args', ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', cp, '-d', tests, *core, *test_src])])
schema = repo / 'packages/agent-harness-py/schemas/villager_quest.schema.json'
rules = run('rules', [java, '-ea', args_file('rules.args', ['-cp', os.pathsep.join([str(tests), cp]), 'org.qiandengji.villagerquests.core.CoreRulesTest', str(schema)])])
assert 'passed=true' in rules, rules

jar = a.output / f'qiandeng-villager-quests-{VERSION}.jar'
with zipfile.ZipFile(jar, 'x', zipfile.ZIP_DEFLATED) as z:
    for file in sorted(classes.rglob('*.class')):
        z.write(file, file.relative_to(classes).as_posix())
    for res in ('plugin.yml', 'config.yml'):
        z.write(here / 'resources' / res, res)
report = {'productionChanged': False, 'version': VERSION, 'rules': rules.strip().splitlines()[-1],
          'jar': {'path': str(jar), 'sha256': digest(jar)},
          'sources': {str(f.relative_to(repo)).replace('\\', '/'): digest(f) for f in sources}}
(a.output / 'build.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
print(json.dumps({k: report[k] for k in ('version', 'rules', 'jar')}, ensure_ascii=False))
