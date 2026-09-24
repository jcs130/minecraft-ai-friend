"""Launch the project NeoForge client with its own observer name.

Uses the locally installed game libraries and the project's client modpack.
The observer joins the local server directly; no player credentials are used.

Usage: start launches the client and its supervised follow task; follow repairs
an already running client; status checks the live camera and task heartbeat.
Closing the Minecraft client ends the watcher. The scheduled task remains
available for the next launch and exits immediately when no client is running.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid
from zipfile import ZipFile

from observer_follow import attach, rcon_client, sample


ROOT = Path(__file__).resolve().parents[1]
INSTALL = Path(os.environ.get('APPDATA', '')) / '.minecraft'
BASE_VERSION = '1.21.1'
VERSION = 'neoforge-21.1.248'
USERNAME = 'ag_observer'
SERVER = '127.0.0.1:25565'
WORK = ROOT / 'runtime' / 'observer-client'
GAME = ROOT / 'client'
NATIVES = WORK / 'natives'


def java_21():
    candidates = [
        Path(os.environ['JAVA_21_HOME']) / 'bin' / 'javaw.exe'
        if os.environ.get('JAVA_21_HOME') else None,
        Path(r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\javaw.exe'),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    raise RuntimeError('Java 21 javaw.exe is unavailable; set JAVA_21_HOME')


def windows_library(lib):
    name = lib['name']
    if ':natives-' in name and not name.endswith(':natives-windows'):
        return False
    rules = lib.get('rules')
    if not rules:
        return True
    allowed = False
    for rule in rules:
        os_rule = rule.get('os', {})
        if os_rule.get('name', 'windows') != 'windows':
            continue
        if 'arch' in os_rule and not re.search(os_rule['arch'], 'x86_64'):
            continue
        if rule.get('features'):
            continue
        allowed = rule['action'] == 'allow'
    return allowed


def game_files():
    base_manifest = INSTALL / 'versions' / BASE_VERSION / (BASE_VERSION + '.json')
    mod_manifest = INSTALL / 'versions' / VERSION / (VERSION + '.json')
    game_jar = base_manifest.with_suffix('.jar')
    if not base_manifest.is_file() or not mod_manifest.is_file() or not game_jar.is_file():
        raise RuntimeError('Installed Minecraft 1.21.1/NeoForge 21.1.248 is unavailable')
    base = json.loads(base_manifest.read_text(encoding='utf-8'))
    mod = json.loads(mod_manifest.read_text(encoding='utf-8'))
    if base['id'] != BASE_VERSION or base['javaVersion']['majorVersion'] != 21 \
            or mod['id'] != VERSION or mod['inheritsFrom'] != BASE_VERSION:
        raise RuntimeError('Unexpected Minecraft/NeoForge manifest')
    if not (GAME / 'mods' / 'spawn-4.0.7-1.21.1.jar').is_file():
        raise RuntimeError('Project client modpack is unavailable')
    jars = []
    natives = []
    for lib in mod['libraries'] + base['libraries']:
        if not windows_library(lib):
            continue
        artifact = lib.get('downloads', {}).get('artifact')
        if not artifact:
            continue
        jar = INSTALL / 'libraries' / artifact['path']
        if not jar.is_file():
            raise RuntimeError('Missing installed library: ' + artifact['path'])
        jars.append(jar)
        if lib['name'].endswith(':natives-windows'):
            natives.append(jar)
    if not (INSTALL / 'assets' / 'indexes' / (base['assetIndex']['id'] + '.json')).is_file():
        raise RuntimeError('Minecraft asset index is unavailable')
    # Inherited manifests repeat some libraries; NeoForge's module loader
    # rejects duplicate classpath paths even when the files are identical.
    # The patched Minecraft client comes from NeoForge's library entry. Adding
    # the vanilla game JAR creates a duplicate minecraft module at bootstrap.
    return base, mod, list(dict.fromkeys(jars)), natives


def set_option(value, key, setting):
    line = key + ':' + setting
    pattern = re.compile(r'^' + re.escape(key) + r':.*$', re.MULTILINE)
    return pattern.sub(line, value) if pattern.search(value) else value.rstrip('\n') + '\n' + line + '\n'


def prepare():
    base, mod, jars, native_jars = game_files()
    NATIVES.mkdir(parents=True, exist_ok=True)
    options = GAME / 'options.txt'
    if not options.is_file():
        raise RuntimeError('Project client options.txt is unavailable')
    value = options.read_text(encoding='utf-8')
    updated = set_option(value, 'pauseOnLostFocus', 'false')
    if updated != value:
        backup = options.with_name(options.name + '.pre-observer-20260924')
        if not backup.exists():
            shutil.copy2(options, backup)
        options.write_text(updated, encoding='utf-8')
    for jar in native_jars:
        with ZipFile(jar) as archive:
            for name in archive.namelist():
                if name.lower().endswith('.dll'):
                    (NATIVES / Path(name).name).write_bytes(archive.read(name))
    return base, mod, jars


def mod_jvm_args(mod):
    substitutions = {
        '${library_directory}': str(INSTALL / 'libraries'),
        '${classpath_separator}': os.pathsep,
        '${version_name}': VERSION,
    }
    result = []
    for value in mod['arguments']['jvm']:
        for key, replacement in substitutions.items():
            value = value.replace(key, replacement)
        if '${' in value:
            raise RuntimeError('Unresolved NeoForge JVM argument')
        result.append(value)
    return result


def offline_uuid(name):
    digest = hashlib.md5(('OfflinePlayer:' + name).encode('utf-8')).digest()
    return uuid.UUID(bytes=digest, version=3).hex


def online():
    return bool(re.search(r'\b' + re.escape(USERNAME) + r'\b', rcon_client().cmd('list')))


def spectate():
    # Reuse the ID-matching RCON transport and same-target camera repair.
    # A saved spectator mode can produce an empty/no-change command response.
    client = rcon_client()
    result = attach(client)
    observed = sample(client)
    if (not observed['observerOnline'] or not observed['targetOnline']
            or observed['observerSpectator'] is not True
            or observed['dimensionMatch'] is not True or observed['distance'] > 4):
        raise RuntimeError('Observer camera position was not confirmed')
    return result


def ensure_follow():
    import psutil
    state_path = WORK / 'client.json'
    state = json.loads(state_path.read_text(encoding='utf-8'))
    process = psutil.Process(state['pid'])
    if process.name().lower() != 'javaw.exe' or state.get('name') != USERNAME:
        raise RuntimeError('Observer client process identity was not confirmed')
    state['startedAt'] = process.create_time()
    state_path.write_text(json.dumps(state), encoding='utf-8')
    result = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        str(ROOT / 'tools' / 'observer_follow_task.ps1'), '-Python', sys.executable,
        '-Watcher', str(ROOT / 'tools' / 'observer_follow.py')],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
    if result.returncode:
        raise RuntimeError('Could not start observer follow task: ' + result.stderr[-600:])
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        health = subprocess.run([sys.executable, str(ROOT / 'tools' / 'observer_follow.py'), 'check'],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
        if health.returncode == 0 and json.loads(health.stdout).get('active') is True:
            print(health.stdout.strip(), flush=True)
            return
        time.sleep(2)
    raise RuntimeError('Observer follow task did not become healthy; inspect ' + str(WORK / 'follow.log'))


def main(argv):
    action = argv[1] if len(argv) > 1 else 'start'
    if action == 'status':
        return subprocess.call([sys.executable, str(ROOT / 'tools' / 'observer_follow.py'), 'check'])
    if action == 'follow':
        if not online():
            raise RuntimeError('Observer client is offline')
        ensure_follow()
        return 0
    if action not in ('prepare', 'start'):
        print('Usage: python tools/launch_observer_client.py [prepare|start|follow|status]')
        return 2
    base, mod, jars = prepare()
    if action == 'prepare':
        print(json.dumps({'ready': True, 'libraries': len(jars), 'mods': len(list((GAME / 'mods').glob('*.jar'))),
            'options': str(GAME / 'options.txt')}))
        return 0
    if online():
        raise RuntimeError(USERNAME + ' is already online; refusing to duplicate or take over the client')
    args = [str(java_21()), '-Xms1G', '-Xmx4G',
        '-Djava.library.path=' + str(NATIVES), '-Djna.tmpdir=' + str(NATIVES),
        '-Dorg.lwjgl.system.SharedLibraryExtractPath=' + str(NATIVES),
        '-Dio.netty.native.workdir=' + str(NATIVES),
        *mod_jvm_args(mod), '-cp', os.pathsep.join(map(str, jars)), mod['mainClass'],
        '--username', USERNAME, '--version', VERSION,
        '--gameDir', str(GAME), '--assetsDir', str(INSTALL / 'assets'),
        '--assetIndex', base['assetIndex']['id'], '--uuid', offline_uuid(USERNAME),
        '--accessToken', '0', '--clientId', '0', '--xuid', '0',
        '--userType', 'legacy', '--versionType', 'release',
        *mod['arguments']['game'],
        '--width', '1280', '--height', '720',
        '--quickPlayMultiplayer', SERVER]
    launch_log = WORK / 'launch.log'
    with launch_log.open('ab') as output:
        output.write(('\n=== observer launch ' + time.strftime('%Y-%m-%d %H:%M:%S') + ' ===\n').encode())
        output.flush()
        proc = subprocess.Popen(args, cwd=GAME, stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    (WORK / 'client.json').write_text(json.dumps({'pid': proc.pid, 'name': USERNAME}), encoding='utf-8')
    print('Launched observer client PID=' + str(proc.pid), flush=True)
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError('Minecraft client exited; inspect ' + str(GAME / 'logs' / 'latest.log'))
        try:
            if online():
                print(spectate(), flush=True)
                ensure_follow()
                print('Observer is online and spectating Kirito; pauseOnLostFocus=false', flush=True)
                return 0
        except (OSError, TimeoutError, subprocess.SubprocessError):
            pass
        time.sleep(3)
    raise RuntimeError('Observer did not join within 150 seconds; inspect ' + str(GAME / 'logs' / 'latest.log'))


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(1)
