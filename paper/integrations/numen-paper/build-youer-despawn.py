"""Adapt one pinned Paper-only Numen call to the deployed Youer ABI. Not a Paper artifact."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import os
import subprocess
import zipfile

p = argparse.ArgumentParser(description=__doc__)
for name in ['server', 'jdk', 'output']:
    p.add_argument('--' + name, type=Path, required=True)
a = p.parse_args()
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
baseline = a.server / 'plugins/numen_api-paper-1.21.1-0.1.4.jar'
assert sha(baseline) == 'f074466b24ce97b3be1646e22875f7310cc6711ed34dd79fb07cbbdfdf07b3df'
assert sha(a.server / 'server.jar') == 'ccb6e44668919d6a5a69aeffbe3fefb71f7c9c6127cc01ea1febc3f20f32fca1', 'This overlay is only reviewed for Youer build 920'
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)
dependencies = [a.server / f'libraries/org/ow2/asm/{name}/9.10.1/{name}-9.10.1.jar'
                for name in ['asm', 'asm-tree', 'asm-analysis']]
assert all(file.is_file() for file in dependencies)
source = Path(__file__).resolve().parent / 'patches/YouerDespawnPatch.java'
cp = os.pathsep.join(map(str, dependencies))
subprocess.run([str(a.jdk / 'bin/javac.exe'), '-proc:none', '--release', '21', '-cp', cp, '-d', str(out), str(source)], check=True)
entry = 'com/dwinovo/numen/api/entity/CompanionFactory.class'
with zipfile.ZipFile(baseline) as before:
    (out / 'before.class').write_bytes(before.read(entry))
subprocess.run([str(a.jdk / 'bin/java.exe'), '-cp', str(out) + os.pathsep + cp, 'YouerDespawnPatch', str(out / 'before.class'), str(out / 'after.class')], check=True)
target = out / 'numen_api-youer-1.21.1-0.1.4-qd1.jar'
with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as after:
    descriptor = before.read('paper-plugin.yml')
    assert descriptor.count(b"version: '0.1.4'") == 1
    for info in before.infolist():
        data = before.read(info.filename)
        if info.filename == entry:
            data = (out / 'after.class').read_bytes()
        elif info.filename == 'paper-plugin.yml':
            data = descriptor.replace(b"version: '0.1.4'", b"version: '0.1.4-qd-youer1'")
        after.writestr(copy.copy(info), data)
with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(target) as after:
    changed = [name for name in before.namelist() if before.read(name) != after.read(name)]
    assert set(before.namelist()) == set(after.namelist()) and set(changed) == {entry, 'paper-plugin.yml'}
receipt = {'artifact': target.name, 'sha256': sha(target), 'baselineSha256': sha(baseline),
           'sourceSha256': sha(source), 'changedEntries': changed,
           'otherEntriesPreserved': len(before.namelist()) - len(changed), 'productionChanged': False}
(out / 'build.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt))
