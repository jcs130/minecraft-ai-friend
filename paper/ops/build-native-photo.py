"""Build the native camera coordinator over the pinned current AF release."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import os
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
for name in ['server', 'jdk', 'output']:
    parser.add_argument('--' + name, type=Path, required=True)
args = parser.parse_args()
paper = Path(__file__).resolve().parents[1]
baseline = args.server / 'plugins/AgentFriend-0.4.47.44-rpg.jar'
digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
assert digest(baseline) == 'bda5445a4c3e472d8c8cae0ec116450fe8941a017627fc94dc3717f2cb582d17'
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=False)
classes = out / 'classes'
classes.mkdir()
source = paper / 'plugins/AgentFriend/src/org/afuhome/agentfriend/PhotoCameraManager.java'
dependencies = [baseline, *args.server.glob('libraries/**/*.jar'), *args.server.glob('plugins/*.jar')]
values = ['-proc:none', '-implicit:none', '-encoding', 'UTF-8', '--release', '21',
          '-cp', os.pathsep.join(map(str, dependencies)), '-d', str(classes), str(source)]
argfile = out / 'compile.args'
argfile.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in values), encoding='utf-8')
with (out / 'compile.log').open('wb') as log:
    compiled = subprocess.run([str(args.jdk / 'bin/javac.exe'), '@' + str(argfile)], stdout=log, stderr=subprocess.STDOUT)
assert compiled.returncode == 0, 'Inspect compile.log; no production file was changed'
updates = {file.relative_to(classes).as_posix(): file.read_bytes() for file in classes.rglob('*.class')}
prefix = 'org/afuhome/agentfriend/PhotoCameraManager'
assert updates and all(name.startswith(prefix) for name in updates)
target = out / 'AgentFriend-0.4.47.45-rpg.jar'
with zipfile.ZipFile(baseline) as before:
    assert set(updates) == {name for name in before.namelist() if name.startswith(prefix) and name.endswith('.class')}
    descriptor = before.read('plugin.yml')
    assert descriptor.count(b'0.4.47.44-rpg') == 1
    updates['plugin.yml'] = descriptor.replace(b'0.4.47.44-rpg', b'0.4.47.45-rpg')
    with zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as after:
        for entry in before.infolist():
            after.writestr(copy.copy(entry), updates.get(entry.filename, before.read(entry.filename)))
with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(target) as after:
    changed = [name for name in before.namelist() if before.read(name) != after.read(name)]
    assert set(before.namelist()) == set(after.namelist()) and set(changed) <= set(updates)
receipt = {'artifact': target.name, 'sha256': digest(target), 'baselineSha256': digest(baseline),
           'sourceSha256': digest(source), 'changedEntries': changed,
           'otherEntriesPreserved': len(before.namelist()) - len(changed), 'productionChanged': False}
(out / 'build.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt))
