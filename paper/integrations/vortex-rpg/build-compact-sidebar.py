"""Hide native sidebar ordering numbers; retain every other deployed JAR entry.

The separate compact layout is in config-candidates/vortex-native/config.yml.
This builder only writes a new output directory, never a production target.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import zipfile

PIN = '47bb884059ff15af6e3286727587256ea4ff34b2386bf91aa2f0d2e1dd2a7a56'
ENTRY = 'io/vortexcore/ui/ScoreboardService.class'
p = argparse.ArgumentParser()
p.add_argument('--base', type=Path, required=True)
p.add_argument('--libraries', type=Path, required=True)
p.add_argument('--jdk', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(a.base) == PIN, 'Unreviewed RPG base; do not overwrite or repatch it'
a.output.mkdir(parents=True, exist_ok=False)
source = Path(__file__).parent / 'native-patches/CompactSidebarPatch.java'
classes = a.output / 'classes'
classes.mkdir()
asm = [a.libraries / 'org/ow2/asm' / name / '9.10.1' / (name + '-9.10.1.jar')
       for name in ['asm', 'asm-tree']]
assert all(path.is_file() for path in asm), 'Reviewed ASM toolchain missing'
cp = os.pathsep.join(map(str, asm))
subprocess.run([str(a.jdk / 'bin/javac.exe'), '--release', '21', '-encoding', 'UTF-8',
                '-cp', cp, '-d', str(classes), str(source)], check=True)
before = a.output / 'scoreboard.before.class'
after = a.output / 'scoreboard.after.class'
with zipfile.ZipFile(a.base) as original:
    before.write_bytes(original.read(ENTRY))
subprocess.run([str(a.jdk / 'bin/java.exe'), '-cp', os.pathsep.join([str(classes), cp]),
                'CompactSidebarPatch', str(before), str(after)], check=True)
target = a.output / 'VortexRPG-1.2.2-alpha-compact-sidebar-r1.jar'
retained = 0
with zipfile.ZipFile(a.base) as original, zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as output:
    for info in original.infolist():
        output.writestr(info, after.read_bytes() if info.filename == ENTRY else original.read(info.filename))
with zipfile.ZipFile(a.base) as original, zipfile.ZipFile(target) as output:
    assert original.namelist() == output.namelist()
    for entry in original.namelist():
        if entry != ENTRY:
            assert original.read(entry) == output.read(entry), 'Unrelated entry changed: ' + entry
            retained += 1
report = {'baseSha256': PIN, 'sha256': sha(target), 'changedEntries': [ENTRY],
          'otherEntriesRetained': retained, 'productionChanged': False,
          'configurationChange': 'scoreboard title and four display lines only'}
(a.output / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
