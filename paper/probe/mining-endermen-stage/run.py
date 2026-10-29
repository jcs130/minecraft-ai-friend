"""Fresh loopback fixture for real mining receipts and Enderman load policy.

Copies no production world, player data, credentials or plugin configuration.
The child always receives a normal stop, including when the probe fails.
"""
import argparse
import json
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--stage', type=Path, required=True)
    p.add_argument('--client', type=Path, required=True)
    p.add_argument('--vortex', type=Path)
    p.add_argument('--resume', action='store_true', help='Cold-load the same QA save after a successful seed run')
    a = p.parse_args()
    stage = a.stage.resolve()
    if stage.parent != Path('E:/MC/staging').resolve() or not stage.name.startswith('mining-endermen-'):
        raise ValueError('Fresh direct child of E:/MC/staging required')
    if stage.exists() and not a.resume:
        raise ValueError('Use --resume only for the previous isolated fixture')
    if a.resume and 'motd=MINING_ENDERMAN_ISOLATED_QA' not in (stage / 'server.properties').read_text():
        raise ValueError('Refusing non-QA server')
    for port in (25929, 25930):
        with socket.socket() as s:
            s.bind(('127.0.0.1', port))
    source = Path('E:/MC/server')
    if not a.resume:
        prepare(stage, source, a)
    result = {'productionModified': False, 'ready': False, 'phase': 'cold' if a.resume else 'seed'}
    proc = None
    logfile = stage / ('probe-cold-console.log' if a.resume else 'probe-console.log')
    try:
        with logfile.open('w', encoding='utf8') as log:
            proc = subprocess.Popen(['E:/MC/jdk/jdk-21.0.12.1+1/bin/java.exe',
                '-Xms512M', '-Xmx1024M', '-XX:ActiveProcessorCount=2',
                '-Dfile.encoding=UTF-8', '-jar', 'server.jar', '--nogui'], cwd=stage,
                stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline and proc.poll() is None:
                time.sleep(1)
                if 'Done (' in logfile.read_text(encoding='utf8', errors='replace'):
                    result['ready'] = True
                    client = subprocess.run(['node', str(a.client.resolve()), str(stage), result['phase']],
                        capture_output=True, text=True, encoding='utf8', errors='replace', timeout=180)
                    result.update(clientExitCode=client.returncode, output=client.stdout[-3500:], error=client.stderr[-1500:])
                    break
    finally:
        if proc is not None and proc.poll() is None:
            proc.stdin.write('stop\n'); proc.stdin.flush()
            try:
                proc.wait(timeout=40)
            except subprocess.TimeoutExpired:
                proc.terminate(); proc.wait(timeout=10)
        result['exitCode'] = proc.returncode if proc else None
        (stage / ('probe-cold-result.json' if a.resume else 'probe-result.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps(result, ensure_ascii=True))


def prepare(stage, source, a):
    stage.mkdir()
    for name in ('server.jar', 'eula.txt', 'libraries', 'versions', 'cache'):
        src, dst = source / name, stage / name
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    plugins = stage / 'plugins'
    plugins.mkdir()
    for name in ('Denizen-1.3.1-b7074-paper1211.jar', 'ViaVersion.jar', 'ViaBackwards.jar'):
        shutil.copy2(source / 'plugins' / name, plugins / name)
    script = Path(__file__).resolve().parents[2] / 'content/world-life/Denizen/qd_enderman_despawn.dsc'
    scripts = plugins / 'Denizen/scripts'
    scripts.mkdir(parents=True)
    shutil.copy2(script, scripts / script.name)
    if a.vortex:
        shutil.copy2(a.vortex, plugins / a.vortex.name)
    props = {'server-ip': '127.0.0.1', 'server-port': 25929, 'online-mode': 'false',
        'enforce-secure-profile': 'false', 'level-name': 'world', 'level-type': 'minecraft:flat',
        'generate-structures': 'false', 'spawn-protection': 0, 'view-distance': 3,
        'simulation-distance': 3, 'max-players': 2, 'enable-rcon': 'true',
        'rcon.port': 25930, 'rcon.password': secrets.token_urlsafe(24),
        'broadcast-rcon-to-ops': 'false', 'enable-query': 'false', 'allow-nether': 'false',
        'motd': 'MINING_ENDERMAN_ISOLATED_QA',
        'generator-settings': json.dumps({'biome': 'minecraft:plains', 'layers': [
            {'block': 'minecraft:bedrock', 'height': 1},
            {'block': 'minecraft:dirt', 'height': 2},
            {'block': 'minecraft:grass_block', 'height': 1}]})}
    (stage / 'server.properties').write_text('\n'.join(f'{k}={v}' for k,v in props.items())+'\n', encoding='utf8')


if __name__ == '__main__':
    main()
