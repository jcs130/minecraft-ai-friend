"""Run a genuine Better Combat Java renderer against the loopback fixture."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import zipfile


def build_probe(jdk, libraries, mods, probe):
    sources = Path(__file__).resolve().parent
    entries = sorted(libraries.rglob('*.jar'))
    patched = [p for p in entries if p.name.startswith('neoforge-') and p.name.endswith('-client.jar')]
    args = ['--release', '21', '-encoding', 'UTF-8', '-proc:none',
            '-cp', os.pathsep.join(map(str, [*patched, *entries, *sorted(mods.glob('*.jar'))])),
            '-d', str(probe), str(sources / 'ClientProbe.java')]
    argfile = probe.parent / 'compile-client.args'
    argfile.write_text('\n'.join('"' + entry.replace('\\', '/') + '"' for entry in args), encoding='utf-8')
    subprocess.run([str(jdk / 'javac.exe'), '@' + str(argfile)], check=True)
    with zipfile.ZipFile(mods / 'combat-client-probe.jar', 'w', zipfile.ZIP_DEFLATED) as jar:
        jar.write(sources / 'client.mods.toml', 'META-INF/neoforge.mods.toml')
        for item in sorted(probe.rglob('*.class')):
            jar.write(item, item.relative_to(probe).as_posix())


def run(a):
    if (a.server / '.better-combat-crossplay-test').read_text() != 'SYNTHETIC_ONLY' or not re.fullmatch(r'BCQA[A-Za-z]{1,11}', a.name):
        raise ValueError('Use a disposable loopback account and server')
    port = int(json.loads((a.server / 'ready.json').read_text())['javaPort'])
    a.output.mkdir(parents=True)
    (a.output / '.better-combat-crossplay-test').write_text('SYNTHETIC_ONLY')
    mods = a.output / 'mods'
    mods.mkdir()
    for path in (a.server / 'mods').glob('*.jar'):
        if path.name.startswith(('bettercombat-', 'cloth-config-', 'player-animation-lib-')):
            shutil.copyfile(path, mods / path.name)
    jdk = a.jdk / 'bin'
    build_probe(jdk, a.libraries, mods, a.output / 'classes')
    params = json.loads(a.launcher_manifest.read_bytes())['arguments']
    for key, value in {
        '--username': a.name, '--gameDir': str(a.output), '--uuid': '01234567-0123-4123-8123-0123456789ab',
        '--accessToken': 'qa-offline', '--clientId': '', '--xuid': '0', '--userType': 'legacy', '--width': '800', '--height': '600',
    }.items():
        params[params.index(key) + 1] = value
    params = [p for p in params if not p.startswith(('-Xmx', '-Xms', '-Dqiandeng.camera.'))]
    if any(p.startswith(('--quickPlay', '-javaagent:')) for p in params):
        raise ValueError('Supply a plain runtime launch manifest')
    params += ['--quickPlayMultiplayer', f'127.0.0.1:{port}']
    (a.output / 'options.txt').write_text('version:3955\nonboardAccessibility:false\nrenderDistance:4\npauseOnLostFocus:false\n')
    with (a.output / 'client-console.log').open('wb') as stdout:
        proc = subprocess.Popen([str(jdk / 'java.exe'), '-Xmx1600m', '-XX:ActiveProcessorCount=2', *params],
                                cwd=a.output, stdout=stdout, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            deadline = time.monotonic() + 720
            while proc.poll() is None and not (a.output / 'stop').exists() and time.monotonic() < deadline:
                time.sleep(.4)
        finally:
            if proc.poll() is None:
                proc.terminate()
            proc.wait(timeout=12)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('server', 'launcher-manifest', 'libraries', 'jdk', 'output'):
        p.add_argument('--' + name, required=True, type=lambda value: Path(value).resolve())
    p.add_argument('--name', required=True)
    run(p.parse_args())
