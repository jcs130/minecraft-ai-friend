"""Build the bounded network filter and its paid-sense bridge against the installed Paper baseline."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import zipfile

p = argparse.ArgumentParser()
p.add_argument('--server', type=Path, required=True)
p.add_argument('--numen', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--jdk', type=Path, default=Path('E:/MC/jdk/jdk-21.0.12.1+1'))
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=False)
paper = Path(__file__).resolve().parents[1]
base = a.server / 'plugins/AgentFriend-0.4.47.8.jar'
expected = 'cca58b89a9495274e842ed99c70b989ca24490d9b93d6b18becb3a1b4126b086'
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()

def write_entry(out, name, content):
    entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    entry.compress_type = zipfile.ZIP_DEFLATED
    out.writestr(entry, content)

assert sha(base) == expected, 'Use the pinned production baseline, not the full unreleased build'
cp = [a.server / 'versions/1.21.1/paper-1.21.1.jar', a.numen]
cp += sorted((a.server / 'libraries').rglob('*.jar')) + sorted((a.server / 'plugins').glob('*.jar'))

def compile_sources(sources, output, classpath):
    output.mkdir()
    args = ['-proc:none', '-implicit:none', '-encoding', 'UTF-8', '--release', '21',
            '-cp', ';'.join(str(f.resolve()) for f in classpath), '-d', str(output.resolve())]
    args += [str(f.resolve()) for f in sources]
    argfile = output / 'javac.args'
    argfile.write_text('\n'.join('"' + s.replace('\\', '/') + '"' for s in args), encoding='utf8')
    subprocess.run([str(a.jdk / 'bin/javac.exe'), '@' + str(argfile)], check=True)

af_src = paper / 'plugins/AgentFriend/src/org/afuhome/agentfriend'
af_classes = a.output / 'agentfriend-classes'
compile_sources([af_src / 'AgentVisionBridge.java', af_src / 'UtilitySpells.java'], af_classes, cp)
entries = {f.relative_to(af_classes).as_posix(): f.read_bytes() for f in af_classes.rglob('*.class')}
allowed = {'org/afuhome/agentfriend/' + name + '.class' for name in
           ['AgentVisionBridge', 'AgentVisionBridge$Reveals', 'UtilitySpells', 'UtilitySpells$1',
            'UtilitySpells$Guardian', 'UtilitySpells$Sense']}
assert set(entries) == allowed, set(entries)
af = a.output / 'AgentFriend-0.4.47.9.jar'
with zipfile.ZipFile(base) as source, zipfile.ZipFile(af, 'x', compression=zipfile.ZIP_DEFLATED) as out:
    descriptor = source.read('plugin.yml').decode('utf8')
    assert "version: '0.4.47.8'" in descriptor
    entries['plugin.yml'] = descriptor.replace("version: '0.4.47.8'", "version: '0.4.47.9'").encode('utf8')
    for name in source.namelist():
        write_entry(out, name, entries.pop(name, source.read(name)))
    for name, content in entries.items():
        write_entry(out, name, content)

vision_src = paper / 'plugins/AgentVision'
vision_classes = a.output / 'vision-classes'
compile_sources(sorted((vision_src / 'src').rglob('*.java')), vision_classes, [af, *cp])
vision = a.output / 'AgentVision-0.1.1.jar'
with zipfile.ZipFile(vision, 'x', compression=zipfile.ZIP_DEFLATED) as out:
    for name in ['paper-plugin.yml', 'config.yml']:
        write_entry(out, name, (vision_src / name).read_bytes())
    for file in vision_classes.rglob('*.class'):
        write_entry(out, file.relative_to(vision_classes).as_posix(), file.read_bytes())
record = {'agentFriend': {'file': af.name, 'sha256': sha(af), 'baseSha256': expected},
          'vision': {'file': vision.name, 'sha256': sha(vision)},
          'numen': {'file': a.numen.name, 'sha256': sha(a.numen)}}
(a.output / 'build.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
print(json.dumps(record))
