"""Compile only AgentVision against the exact deployed 1.21.1 baseline.

Does not rebuild AgentFriend or install anything in the live server.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--server', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--jdk', type=Path, default=Path('E:/MC/jdk/jdk-21.0.12.1+1'))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
paper = Path(__file__).resolve().parents[1]
source = paper / 'plugins/AgentVision'
baseline = args.server / 'plugins/AgentVision-0.1.1.jar'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(baseline) == 'bf00bb818e824f1b672c441be3fd2838fb072d9d6a066fcffcb704af4654feab'
classpath = [args.server / 'versions/1.21.1/paper-1.21.1.jar']
classpath += sorted((args.server / 'libraries').rglob('*.jar'))
classpath += sorted((args.server / 'plugins').glob('*.jar'))


def compile_sources(sources, destination):
    destination.mkdir()
    options = ['-proc:none', '-implicit:none', '-encoding', 'UTF-8', '--release', '21',
               '-cp', ';'.join(str(f.resolve()) for f in classpath), '-d', str(destination.resolve())]
    options += [str(f.resolve()) for f in sources]
    argfile = destination / 'javac.args'
    argfile.write_text('\n'.join('"' + item.replace('\\', '/') + '"' for item in options), encoding='utf8')
    subprocess.run([str(args.jdk / 'bin/javac.exe'), '@' + str(argfile)], check=True)


classes = args.output / 'classes'
compile_sources(sorted((source / 'src').rglob('*.java')), classes)
entries = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
assert set(entries) == {'org/afuhome/agentvision/' + name + '.class' for name in
                        ('AgentVisionPlugin', 'AgentVisionPlugin$1', 'AgentVisionPlugin$Viewer', 'AgentVisionPlugin$Target')}, set(entries)
entries['paper-plugin.yml'] = (source / 'paper-plugin.yml').read_bytes()
candidate = args.output / 'AgentVision-0.1.2.jar'
preserved = 0
with zipfile.ZipFile(baseline) as original, zipfile.ZipFile(candidate, 'x', zipfile.ZIP_DEFLATED) as target:
    assert set(entries).issubset(original.namelist())
    for name in original.namelist():
        entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        content = entries.get(name, original.read(name))
        preserved += name not in entries
        target.writestr(entry, content)

fixture_classes = args.output / 'fixture-classes'
compile_sources([source / 'tests/VisibilityLifecycleFixture.java'], fixture_classes)
with zipfile.ZipFile(args.output / 'VisibilityLifecycleFixture.jar', 'x', zipfile.ZIP_DEFLATED) as jar:
    jar.writestr('paper-plugin.yml', '''name: VisibilityLifecycleFixture
version: '1.0.0'
main: org.afuhome.agentvision.tests.VisibilityLifecycleFixture
api-version: '1.21'
dependencies:
  server:
    AgentVision:
      load: BEFORE
      required: true
      join-classpath: true
''')
    for path in fixture_classes.rglob('*.class'):
        jar.write(path, path.relative_to(fixture_classes).as_posix())

record = {'baseline': sha(baseline), 'candidate': sha(candidate), 'preservedEntries': preserved,
          'changedEntries': sorted(entries), 'fixture': sha(args.output / 'VisibilityLifecycleFixture.jar')}
(args.output / 'build.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
print(json.dumps(record))
