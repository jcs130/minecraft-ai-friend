"""Build a one-method candidate from the exact deployed .27; never installs it."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, zipfile

PIN = 'ad40b4e32a46ef69cb0e73798b501d638d8eb237eec0ea198b7cf0d2c65ba8f8'
ENTRY = 'org/afuhome/agentfriend/AgentFriendPlugin.class'

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['base', 'server', 'jdk', 'output']:
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    assert hashlib.sha256(a.base.read_bytes()).hexdigest() == PIN, 'Unreviewed baseline'
    assert not a.output.exists(), 'New output required'
    assert a.server.resolve() not in a.output.resolve().parents, 'Never build into a server directory'
    build = a.output.parent / (a.output.stem + '.build')
    build.mkdir(parents=True, exist_ok=False)
    asm = next((a.server / 'libraries/org/ow2/asm/asm').glob('9.7.1/asm-9.7.1.jar'))
    source = Path(__file__).with_name('PatchCompassBounds.java')
    subprocess.run([str(a.jdk / 'bin/javac.exe'), '-encoding', 'UTF-8', '-proc:none', '-cp', str(asm), '-d', str(build), str(source)], check=True)
    with zipfile.ZipFile(a.base) as old:
        (build / 'before.class').write_bytes(old.read(ENTRY))
    subprocess.run([str(a.jdk / 'bin/java.exe'), '-cp', str(build) + os.pathsep + str(asm), 'PatchCompassBounds', str(build / 'before.class'), str(build / 'after.class')], check=True)
    unchanged = 0
    with zipfile.ZipFile(a.base) as old, zipfile.ZipFile(a.output, 'x', zipfile.ZIP_DEFLATED) as out:
        assert len(old.namelist()) == len(set(old.namelist()))
        for info in old.infolist():
            data = old.read(info)
            if info.filename == ENTRY:
                data = (build / 'after.class').read_bytes()
            elif info.filename == 'plugin.yml':
                assert data.count(b'0.4.47.27-vortex') == 1
                data = data.replace(b'0.4.47.27-vortex', b'0.4.47.28-vortex')
            else:
                unchanged += 1
            out.writestr(info, data)
    with zipfile.ZipFile(a.base) as old, zipfile.ZipFile(a.output) as new:
        assert old.namelist() == new.namelist()
        assert all(old.read(n) == new.read(n) for n in old.namelist() if n not in [ENTRY, 'plugin.yml'])
    proof = dict(baseSha256=PIN, sha256=hashlib.sha256(a.output.read_bytes()).hexdigest(), unchangedEntries=unchanged, changedMethods=['fillCompass'], productionChanged=False)
    a.output.with_suffix('.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(proof))

if __name__ == '__main__':
    main()
