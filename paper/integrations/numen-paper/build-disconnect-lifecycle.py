"""Backport the verified Numen lifecycle fix to the exact installed compatibility baseline."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import os
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
for name in ('server', 'jdk', 'output'):
    parser.add_argument('--' + name, type=Path, required=True)
args = parser.parse_args()
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
baseline = args.server / 'plugins/numen_api-paper-1.21.1-0.1.4.jar'
assert sha(baseline) == 'b3cf763f68fb4729e1001149c267ee378a6cc55b1c91f97bb9222f80782ff35a', 'Unreviewed Numen baseline'
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=False)
source = Path(__file__).resolve().parent / 'patches/DisconnectLifecyclePatch.java'
dependencies = [args.server / f'libraries/org/ow2/asm/{name}/9.10.1/{name}-9.10.1.jar' for name in ('asm', 'asm-tree', 'asm-analysis')]
assert all(path.is_file() for path in dependencies)
cp = os.pathsep.join(map(str, dependencies))
subprocess.run([str(args.jdk/'bin/javac.exe'), '-proc:none', '--release', '21', '-cp', cp, '-d', str(out), str(source)], check=True)
entry = 'com/dwinovo/numen/api/entity/CompanionFactory.class'
with zipfile.ZipFile(baseline) as original:
    (out/'before.class').write_bytes(original.read(entry))
subprocess.run([str(args.jdk/'bin/java.exe'), '-cp', str(out)+os.pathsep+cp, 'DisconnectLifecyclePatch', str(out/'before.class'), str(out/'after.class')], check=True)
target = out/'numen_api-paper-1.21.1-0.1.4-qd-youer3.jar'
with zipfile.ZipFile(baseline) as original, zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as candidate:
    descriptor = original.read('paper-plugin.yml')
    assert descriptor.count(b"version: '0.1.4-qd-youer2'") == 1
    for info in original.infolist():
        data = original.read(info.filename)
        if info.filename == entry:
            data = (out/'after.class').read_bytes()
        elif info.filename == 'paper-plugin.yml':
            data = descriptor.replace(b"version: '0.1.4-qd-youer2'", b"version: '0.1.4-qd-youer3'")
        candidate.writestr(copy.copy(info), data)
with zipfile.ZipFile(baseline) as original, zipfile.ZipFile(target) as candidate:
    assert set(original.namelist()) == set(candidate.namelist())
    changed = [name for name in original.namelist() if original.read(name) != candidate.read(name)]
    assert set(changed) == {entry, 'paper-plugin.yml'}
    preserved = len(original.namelist()) - len(changed)
receipt = {'artifact': target.name, 'sha256': sha(target), 'apiSha256': sha(baseline), 'sourceSha256': sha(source),
           'changedEntries': changed, 'otherEntriesPreserved': preserved, 'productionChanged': False,
           'fullUpstreamUpgrade': False, 'upstreamIssue': 'https://github.com/Dwinovo/minecraft-numen/issues/163'}
(out/'build.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt))
