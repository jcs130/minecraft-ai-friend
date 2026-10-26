"""Probe an official VortexRPG JAR on a fresh, loopback-only Paper copy.

No production configurations, player files, credentials or worlds are copied.
The child is stopped in finally, even when initialization fails.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import socket
import subprocess
import time
import zipfile

import yaml


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--stage', type=Path, required=True)
    p.add_argument('--jar', type=Path, required=True)
    p.add_argument('--java', type=Path, required=True)
    p.add_argument('--port', type=int, default=25928)
    p.add_argument('--client', type=Path)
    p.add_argument('--resume', action='store_true')
    p.add_argument('--compat-sha512', help='Explicit hash of a locally built compatibility candidate; never used for production')
    a = p.parse_args()
    stage = a.stage.resolve()
    if stage.parent != Path('E:/MC/staging').resolve() or (stage.exists() and not a.resume):
        raise ValueError('Use a new directory immediately inside E:/MC/staging')
    if not 25926 <= a.port <= 25930:
        raise ValueError('Only isolated probe ports 25926..25930 are allowed')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', a.port))
    expected = '736888d27b7d5e1de2a039c276984ef67be50f47c4fc78f7e3db2973fb60c5e171801a3a9fdf8d2b8ae27ee7327d5240abcaa71e79120e7abd0592e75592d501'
    if a.compat_sha512:
        if len(a.compat_sha512) != 128 or any(c not in '0123456789abcdef' for c in a.compat_sha512):
            raise ValueError('Candidate SHA512 must be explicit lowercase hexadecimal')
        expected = a.compat_sha512
    if hashlib.sha512(a.jar.read_bytes()).hexdigest() != expected:
        raise ValueError('Probe requires verified official 1.2.2-alpha Paper/Folia JAR')
    if a.resume:
        if 'motd=VORTEX_COMPATIBILITY_QA_ONLY' not in (stage / 'server.properties').read_text():
            raise ValueError('Only the same QA save may resume')
    else:
        stage.mkdir()
        for name in ('server.jar', 'eula.txt', 'libraries', 'versions', 'cache'):
            src, dst = a.source / name, stage / name
            if src.is_dir():
                shutil.copytree(src, dst)
            elif src.is_file():
                shutil.copy2(src, dst)
        plugin = stage / 'plugins/VortexRPG'
        plugin.mkdir(parents=True)
        shutil.copy2(a.jar, plugin.parent / a.jar.name)
        with zipfile.ZipFile(a.jar) as z:
            config = yaml.safe_load(z.read('config.yml'))
        # Isolate automatic terrain generation, networking and unsolicited activity.
        config['fracture-realm']['enabled'] = False
        config['fracture-gateway']['enabled'] = False
        config['fracture-gateway']['auto-create-primary'] = False
        config['fracture-gateway']['auto-create-return'] = False
        config['smart-systems']['director']['enabled'] = False
        config['npc']['base-url'] = 'http://127.0.0.1:1/disabled-test-only'
        (plugin / 'config.yml').write_text(yaml.safe_dump(config, sort_keys=False), encoding='utf8')
        bstats = stage / 'plugins/bStats'
        bstats.mkdir()
        (bstats / 'config.yml').write_text('enabled: false\n', encoding='utf8')
        props = {
            'server-ip': '127.0.0.1', 'server-port': str(a.port),
            'online-mode': 'false', 'enforce-secure-profile': 'false',
            'level-name': 'qa_world', 'level-type': 'minecraft:flat',
            'generator-settings': json.dumps({'biome': 'minecraft:plains', 'layers': [
                {'block': 'minecraft:bedrock', 'height': 1},
                {'block': 'minecraft:dirt', 'height': 2},
                {'block': 'minecraft:grass_block', 'height': 1}]}),
            'generate-structures': 'false', 'spawn-protection': '0',
            'view-distance': '3', 'simulation-distance': '3',
            'max-players': '2', 'enable-rcon': 'false', 'enable-query': 'false',
            'enable-command-block': 'false', 'sync-chunk-writes': 'true',
            'allow-nether': 'false', 'motd': 'VORTEX_COMPATIBILITY_QA_ONLY',
        }
        (stage / 'server.properties').write_text('\n'.join(k+'='+v for k,v in props.items())+'\n', encoding='utf8')
    result = {'artifact': a.jar.name, 'sha512': expected, 'port': a.port,
              'productionModified': False, 'ready': False}
    logfile = stage / ('probe-cold-console.log' if a.resume else 'probe-console.log')
    proc = None
    try:
        with logfile.open('w', encoding='utf8') as log:
            proc = subprocess.Popen([str(a.java), '-Xms512M', '-Xmx1024M',
                '-XX:ActiveProcessorCount=2', '-Dfile.encoding=UTF-8',
                '-jar', 'server.jar', '--nogui'], cwd=stage,
                stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline and proc.poll() is None:
                time.sleep(1)
                text = logfile.read_text(encoding='utf8', errors='replace')
                if 'Done (' in text:
                    result['ready'] = True
                    proc.stdin.write('plugins\nversion VortexRPG\n'); proc.stdin.flush()
                    time.sleep(3)
                    if a.client:
                        client = subprocess.run(['node', str(a.client), str(a.port), str(stage / ('client-cold-result.json' if a.resume else 'client-result.json')), 'cold' if a.resume else 'seed'],
                            cwd=stage, capture_output=True, text=True, encoding='utf8', errors='replace', timeout=65)
                        result['clientExitCode'] = client.returncode
                        result['clientOutput'] = client.stdout[-1000:]
                        result['clientError'] = client.stderr[-1000:]
                    break
            if not result['ready']:
                result['startupStatus'] = 'exited' if proc.poll() is not None else 'timeout'
            else:
                text = logfile.read_text(encoding='utf8', errors='replace')
                if 'Error occurred while enabling VortexRPG' in text:
                    result['startupStatus'] = 'plugin_enable_failed'
                elif any(s in text for s in ('Unhandled exception in task', 'NoSuchFieldError', 'NoSuchMethodError')):
                    result['startupStatus'] = 'plugin_runtime_failed'
                else:
                    result['startupStatus'] = 'inspect_log'
    finally:
        if proc is not None and proc.poll() is None:
            try:
                proc.stdin.write('stop\n'); proc.stdin.flush(); proc.wait(timeout=35)
            except (OSError, subprocess.TimeoutExpired):
                proc.terminate()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=10)
        result['exitCode'] = proc.returncode if proc else None
        text = logfile.read_text(encoding='utf8', errors='replace') if logfile.exists() else ''
        lines = text.splitlines()
        runtime_errors = [line for line in lines if 'ERROR' in line or 'NoSuchFieldError' in line or 'NoSuchMethodError' in line]
        result['runtimeErrorCount'] = sum('ERROR' in line for line in runtime_errors)
        if runtime_errors:
            result['startupStatus'] = 'plugin_runtime_failed'
        result['diagnostics'] = [line for line in lines if any(s in line for s in (
            'VortexRPG', 'NoSuch', 'ClassNotFound', 'ERROR', 'Caused by:', 'Done ('))][-70:]
        (stage / ('probe-cold-result.json' if a.resume else 'probe-result.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
        print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
