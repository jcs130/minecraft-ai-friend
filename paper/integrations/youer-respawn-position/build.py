from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import zipfile

root = Path(__file__).parent
parser = argparse.ArgumentParser(description='Build the pinned Youer respawn position candidate without installing it.')
for option in ('baseline', 'bootstrap', 'asm-dir', 'jdk', 'output'):
    parser.add_argument('--'+option, type=Path, required=True)
args = parser.parse_args()
jdk = args.jdk / 'bin'
baseline = args.baseline
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
if digest(baseline) != '4541fcdb7e6b7eb37a4a353bc8c4523d8ccfad7fb6ee682dbcfb4b4ad9ff32e4':
    raise ValueError('Unexpected NeoForge baseline SHA256')
if digest(args.bootstrap) != 'ccb6e44668919d6a5a69aeffbe3fefb71f7c9c6127cc01ea1febc3f20f32fca1':
    raise ValueError('Unexpected Youer bootstrap SHA256')
out = args.output.resolve()
out.mkdir()
asm = [args.asm_dir / f'{name}/9.10.1/{name}-9.10.1.jar' for name in ('asm', 'asm-tree')]
classpath = os.pathsep.join(map(str, asm))
subprocess.run([str(jdk/'javac.exe'), '--release', '21', '-cp', classpath, '-d', str(out), str(root/'RespawnPositionPatch.java')], check=True)
entry = 'net/minecraft/server/players/PlayerList.class'
with zipfile.ZipFile(baseline) as archive:
    (out/'original.class').write_bytes(archive.read(entry))
subprocess.run([str(jdk/'java.exe'), '-cp', str(out)+os.pathsep+classpath,
                'RespawnPositionPatch', str(out/'original.class'), str(out/'patched.class')], check=True)
target = out / 'neoforge-21.1.252-server.jar'
with zipfile.ZipFile(baseline) as source, zipfile.ZipFile(target, 'x') as patched:
    for item in source.infolist():
        patched.writestr(item, (out/'patched.class').read_bytes() if item.filename == entry else source.read(item))
with zipfile.ZipFile(baseline) as source, zipfile.ZipFile(target) as patched:
    differences = [name for name in source.namelist() if source.read(name) != patched.read(name)]
    if source.namelist() != patched.namelist() or differences != [entry]:
        raise RuntimeError('Unexpected archive changes')
    proof = {'candidate': target.name, 'baselineSha256': digest(baseline), 'sha256': digest(target),
             'changedEntries': differences, 'unchangedEntries': len(source.namelist())-1}
(out/'build.json').write_text(json.dumps(proof, indent=2)+'\n')
print(json.dumps(proof))
