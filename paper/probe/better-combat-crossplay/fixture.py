"""Start a disposable Better Combat crossplay server from the isolated Youer fixture."""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import time
import zipfile


def free_port(kind=socket.SOCK_STREAM):
    with socket.socket(socket.AF_INET, kind) as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def compile_probe(jdk, libraries, output):
    source = Path(__file__).resolve().parent
    classes = output / 'classes'
    classes.mkdir()
    jars = sorted(libraries.rglob('*.jar'))
    patched = [p for p in jars if p.name.startswith('neoforge-') and p.name.endswith('-server.jar')]
    args = [str(jdk / 'javac.exe'), '--release', '21', '-encoding', 'UTF-8', '-proc:none',
            '-cp', os.pathsep.join(map(str, [*patched, *jars])), '-d', str(classes), str(source / 'CombatProbe.java')]
    argfile = classes / 'javac.args'
    argfile.write_text('\n'.join('"' + arg.replace('\\', '/') + '"' for arg in args[1:]), encoding='utf-8')
    subprocess.run([args[0], '@' + str(argfile)], check=True)
    with zipfile.ZipFile(output / 'plugins' / 'combat-probe.jar', 'w', zipfile.ZIP_DEFLATED) as probe:
        probe.write(source / 'plugin.yml', 'plugin.yml')
        for path in sorted(classes.rglob('*.class')):
            probe.write(path, path.relative_to(classes).as_posix())


def prepare(base, bridge, jdk, output):
    if (base / '.combat-crossplay-qa').read_text() != 'SYNTHETIC_ONLY':
        raise ValueError('Use the synthetic crossplay template')
    if output.exists() or output.is_relative_to(base) or base.is_relative_to(output):
        raise ValueError('Use a fresh separate fixture directory')
    output.mkdir(parents=True)
    (output / '.better-combat-crossplay-test').write_text('SYNTHETIC_ONLY')
    for name in ('server.jar', 'eula.txt'):
        shutil.copyfile(base / name, output / name)
    shutil.copytree(base / 'libraries', output / 'libraries')
    (output / 'mods').mkdir()
    for path in sorted((base / 'mods').glob('*.jar')):
        if path.name.startswith(('bettercombat-', 'cloth-config-', 'player-animation-lib-', 'proxy-compatible-forge-')):
            shutil.copyfile(path, output / 'mods' / path.name)
    shutil.copyfile(bridge, output / 'mods' / bridge.name)
    (output / 'plugins').mkdir()
    for name in ('Geyser-Spigot.jar', 'ViaVersion.jar', 'ViaBackwards.jar'):
        shutil.copyfile(base / 'plugins' / name, output / 'plugins' / name)
    geyser = output / 'plugins/Geyser-Spigot'
    geyser.mkdir()
    shutil.copytree(base / 'plugins/Geyser-Spigot/packs', geyser / 'packs')
    java_port, rcon_port = free_port(), free_port()
    bedrock_port, rtc_port = free_port(socket.SOCK_DGRAM), free_port(socket.SOCK_DGRAM)
    password = secrets.token_hex(24)
    settings = (base / 'plugins/Geyser-Spigot/config.yml').read_text(encoding='utf-8')
    for key, value in [('address', '127.0.0.1'), ('port', bedrock_port), ('webrtc-port', rtc_port)]:
        settings, count = re.subn(r'(?m)^  ' + key + r':.*$', f'  {key}: {value}', settings, count=1)
        if count != 1:
            raise ValueError(f'Missing Geyser fixture setting {key}')
    settings = settings.replace('validate-bedrock-login: true', 'validate-bedrock-login: false')
    (geyser / 'config.yml').write_text(settings, encoding='utf-8')
    properties = {
        'server-ip': '127.0.0.1', 'server-port': java_port, 'rcon.port': rcon_port, 'rcon.password': password,
        'online-mode': 'false', 'enforce-secure-profile': 'false', 'enable-rcon': 'true',
        'spawn-protection': 0, 'view-distance': 4, 'simulation-distance': 4, 'max-players': 10,
        'level-type': 'minecraft:flat', 'generate-structures': 'false', 'difficulty': 'normal',
        'motd': 'Isolated Better Combat crossplay', 'allow-flight': 'true',
    }
    (output / 'server.properties').write_text(''.join(f'{key}={value}\n' for key, value in properties.items()))
    compile_probe(jdk, output / 'libraries', output)
    return {'javaPort': java_port, 'bedrockPort': bedrock_port, 'rconPort': rcon_port,
            'rconPassword': password, 'syntheticOnly': True}


def run(jdk, output, receipt):
    log = output / 'server-console.log'
    with log.open('wb') as stdout:
        server = subprocess.Popen(
            [str(jdk / 'java.exe'), '-Xms256m', '-Xmx2G', '-XX:ActiveProcessorCount=2', '-Dfile.encoding=UTF-8',
             '-jar', 'server.jar', '--nogui'], cwd=output, stdin=subprocess.PIPE, stdout=stdout,
            stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        try:
            deadline = time.monotonic() + 110
            while 'Done (' not in log.read_text(encoding='utf-8', errors='replace'):
                if server.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError('Fixture failed to start; inspect server-console.log')
                time.sleep(.5)
            server.stdin.write(b'minecraft:gamerule doMobSpawning false\nminecraft:gamerule doImmediateRespawn true\n'
                               b'minecraft:gamerule doDaylightCycle false\nminecraft:time set midnight\n')
            server.stdin.flush()
            time.sleep(.5)
            (output / 'ready.json').write_text(json.dumps(receipt), encoding='utf-8')
            print(f'Fixture running at 127.0.0.1:{receipt["javaPort"]}', flush=True)
            deadline = time.monotonic() + 900
            while server.poll() is None and not (output / 'stop').exists() and time.monotonic() < deadline:
                time.sleep(.5)
        finally:
            if server.poll() is None:
                server.stdin.write(b'stop\n')
                server.stdin.flush()
            server.wait(timeout=55)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('base', 'bridge', 'jdk', 'output'):
        parser.add_argument('--' + name, required=True, type=lambda value: Path(value).resolve())
    args = parser.parse_args()
    bin_dir = args.jdk / 'bin'
    run(bin_dir, args.output, prepare(args.base, args.bridge, bin_dir, args.output))
