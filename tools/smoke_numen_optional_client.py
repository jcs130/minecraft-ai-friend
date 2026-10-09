"""Finite isolated Numen handshake A/B test; no model calls or production actions."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time

from build_numen_optional_client import NAME
from build_society_bridge import NUMEN_NAME, NUMEN_SHA
from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, REPO, sha256


def run(root, output, node, java):
    output = output.resolve()
    research = (root / 'research').resolve()
    if research not in output.parents or output.exists():
        raise ValueError('Choose a fresh evidence directory inside this runtime/research')
    with socket.socket() as check:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            check.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        check.bind(('0.0.0.0', 28978))
    output.mkdir(parents=True)
    server = output / 'minimal-server'
    mods = server / 'mods'
    mods.mkdir(parents=True)
    original = root / 'server/mods' / NUMEN_NAME
    assert sha256(original) == NUMEN_SHA
    shutil.copyfile(original, mods / NUMEN_NAME)
    shutil.copyfile(root / 'server/eula.txt', server / 'eula.txt')
    properties = '\n'.join(('server-ip=127.0.0.1', 'server-port=28978', 'online-mode=false',
        'enforce-secure-profile=false', 'enable-rcon=false', 'enable-query=false',
        'max-players=4', 'spawn-protection=0', 'view-distance=3', 'simulation-distance=3',
        'difficulty=peaceful', 'gamemode=survival', 'level-name=world-numen-optional',
        'level-type=minecraft:flat', 'level-seed=1009', 'spawn-monsters=false',
        'motd=Isolated Numen optional-client QA', 'sync-chunk-writes=true', ''))
    (server / 'server.properties').write_text(properties, encoding='utf-8')
    source_args = root / 'server/libraries/net/neoforged/neoforge/21.1.248/win_args.txt'
    library_dir = (root / 'server/libraries').as_posix()
    arguments = source_args.read_text(encoding='utf-8').replace('libraries/', library_dir + '/')
    arguments = arguments.replace('-DlibraryDirectory=libraries', '-DlibraryDirectory=' + library_dir)
    (server / 'qa-args.txt').write_text(arguments, encoding='utf-8')
    report = {'schemaVersion': 1, 'scope': 'Numen-only independent world; vanilla protocol A/B',
              'modelCalls': 0, 'productionWorldActions': 0, 'officialNumenSha256': NUMEN_SHA,
              'realJavaGPanelTested': False, 'actualPhoneTested': False, 'phases': {}, 'ok': False}
    for mode in ('baseline', 'optional'):
        if mode == 'optional':
            shutil.copyfile(root / 'build/numen-optional-client' / NAME, mods / NAME)
        ready, finished, lines = threading.Event(), threading.Event(), []
        process = subprocess.Popen([str(java), '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8',
            '-Dstderr.encoding=UTF-8', '-Xms256m', '-Xmx1024m', '@qa-args.txt', 'nogui'],
            cwd=server, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding='utf-8', errors='replace', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        client = None
        with (output / f'{mode}-server.log').open('w', encoding='utf-8') as log:
            def capture():
                for line in process.stdout:
                    lines.append(line); log.write(line); log.flush()
                    if 'Done (' in line:
                        ready.set()
                finished.set()
            reader = threading.Thread(target=capture, daemon=True)
            reader.start()
            try:
                deadline = time.monotonic() + 180
                while not ready.is_set() and not finished.is_set() and time.monotonic() < deadline:
                    time.sleep(.3)
                if not ready.is_set():
                    raise RuntimeError(f'{mode}: isolated server not ready; inspect preserved log')
                env = dict(os.environ)
                env['NODE_PATH'] = str(root / 'gateway/permanent/node/node_modules')
                client = subprocess.Popen([str(node), str(REPO / 'tools/smoke_numen_optional_client.cjs'),
                    mode, str(output), '28978'], env=env, cwd=REPO,
                    stdout=(output / f'{mode}-client.log').open('w', encoding='utf-8'), stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                phase = {'pid': process.pid, 'serverReady': True}
                if mode == 'optional':
                    deadline = time.monotonic() + 30
                    ready_file = output / 'optional-client-ready.json'
                    while not ready_file.exists() and client.poll() is None and time.monotonic() < deadline:
                        time.sleep(.3)
                    if not ready_file.exists():
                        raise RuntimeError('Vanilla client did not see the native Numen body')
                    move = ('local s=numen.status.self(); local p=numen.route.plan({to={x=math.floor(s.pos.x)+2,'
                            'z=math.floor(s.pos.z)},costs={dig=false,place=false}}); '
                            'if not p.ok then error(p.why) end; local r=numen.move.go(p); '
                            'print("MAW_OPTIONAL_MOVE_OK",r.pos.x,r.pos.y,r.pos.z)')
                    process.stdin.write('numen drive MawOptBody ' + move + '\n'); process.stdin.flush()
                    deadline = time.monotonic() + 15
                    while not any(line.startswith('MAW_OPTIONAL_MOVE_OK\t') for line in lines) and time.monotonic() < deadline:
                        time.sleep(.2)
                    phase['serverLuaMoveWithoutClient'] = any(line.startswith('MAW_OPTIONAL_MOVE_OK\t') for line in lines)
                    start = time.monotonic()
                    process.stdin.write('numen drive MawOptBody print(numen.api.help("numen.status"))\n'); process.stdin.flush()
                    while not any('client_capability_unavailable' in line for line in lines) and time.monotonic() - start < 8:
                        time.sleep(.1)
                    phase['clientOnlyCallExplicitFailure'] = any('client_capability_unavailable' in line for line in lines)
                    phase['clientOnlyCallSeconds'] = round(time.monotonic() - start, 3)
                    (output / 'release-client.json').write_text('{}', encoding='utf-8')
                client.wait(timeout=50)
                phase['clientExitCode'] = client.returncode
                phase['client'] = json.loads((output / f'{mode}-client.json').read_text(encoding='utf-8'))
                report['phases'][mode] = phase
                if not phase['client']['ok']:
                    raise RuntimeError(f'{mode}: client expectation failed; inspect preserved evidence')
            finally:
                if client is not None and client.poll() is None:
                    (output / 'release-client.json').write_text('{}', encoding='utf-8')
                    try:
                        client.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        client.terminate(); client.wait(timeout=10)
                        report['clientForcedTermination'] = True
                if process.poll() is None:
                    process.stdin.write('stop\n'); process.stdin.flush()
                    try:
                        process.wait(timeout=50)
                    except subprocess.TimeoutExpired:
                        process.terminate(); process.wait(timeout=10)
                        report['serverForcedTermination'] = True
                reader.join(timeout=5)
                report.setdefault('serverExitCodes', {})[mode] = process.returncode
                (output / 'acceptance.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    optional = report['phases']['optional']
    report['ok'] = (optional['serverLuaMoveWithoutClient'] and optional['clientOnlyCallExplicitFailure']
                    and optional['clientOnlyCallSeconds'] < 3 and all(x == 0 for x in report['serverExitCodes'].values())
                    and not report.get('serverForcedTermination') and not report.get('clientForcedTermination'))
    (output / 'acceptance.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--java', type=Path, default=DEFAULT_JAVA)
    args = parser.parse_args()
    result = run(args.root.resolve(), args.output, args.node, args.java)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
