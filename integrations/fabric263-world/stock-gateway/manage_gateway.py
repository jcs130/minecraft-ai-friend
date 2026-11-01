"""Own and supervise the loopback stock gateway without controlling the game JVM."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
PRODUCTION = ['gateway.cjs', 'backend.cjs', 'chunks.cjs', 'projection.cjs', 'queries.cjs']
NATIVE = ['native_registry.cjs', 'native_protocol.cjs', 'mod_configuration.cjs', 'views.cjs', 'menus.cjs']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def alive(pid):
    try:
        import ctypes
        ctypes.windll.kernel32.OpenProcess.restype = ctypes.c_void_p
        ctypes.windll.kernel32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        ctypes.windll.kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259
    except (TypeError, ValueError):
        return False


def listening(port):
    with socket.socket() as connection:
        connection.settimeout(0.3)
        return connection.connect_ex(('127.0.0.1', port)) == 0


def validate(config):
    if config.get('labOnly') is not True or config.get('bindHost') != '127.0.0.1' or config.get('backendHost') != '127.0.0.1':
        raise ValueError('No public offline gateway')
    if config['bindPort'] != 39785 or config['stockPort'] != 39786 or config['backendPort'] not in (39781, 39783):
        raise ValueError('Unexpected lab port assignment')
    for key in ('runDir', 'runtime', 'node', 'java', 'viaJar', 'backendDeployment'):
        if not Path(config[key]).is_absolute():
            raise ValueError('Absolute path required: ' + key)
    lock = json.loads((HERE / 'proxy.lock.json').read_text())
    if digest(Path(config['viaJar'])) != lock['sha256']:
        raise ValueError('Proxy artifact changed')
    runtime = Path(config['runtime'])
    receipt = json.loads((runtime / 'build-receipt.json').read_text())
    if digest(runtime / 'package-lock.json') != receipt['npmLockSha256']:
        raise ValueError('Prepared server protocol dependency lock changed')
    deployment = json.loads(Path(config['backendDeployment']).read_text())
    body = json.loads((HERE / 'body-component.lock.json').read_text())
    if deployment['port'] != config['backendPort'] or body not in deployment['localComponents']:
        raise ValueError('Read bridge is not registered in the selected backend')
    if digest(Path(deployment['server']) / 'mods' / body['filename']) != body['sha256']:
        raise ValueError('Selected backend addon hash mismatch')
    return Path(config['runDir'])


def start(config, config_file):
    root = validate(config)
    if root.exists():
        owner = json.loads((root / 'owner.json').read_text())
        if owner['configSha256'] != digest(config_file):
            raise ValueError('Existing run belongs to another configuration')
        state = json.loads((root / 'process-state.local.json').read_text())
        if alive(state.get('supervisorPid')):
            raise ValueError('Owned supervisor still running')
    for port in (config['bindPort'], config['stockPort']):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
    if not root.exists():
        root.mkdir(parents=True)
        write(root / 'owner.json', {'kind': 'fabric263-stock-loopback', 'configSha256': digest(config_file)})
        frozen = root / 'release'
        entries = {}
        for folder, names in (('stock-gateway', PRODUCTION), ('mineflayer', NATIVE)):
            for name in names:
                source = HERE / name if folder == 'stock-gateway' else HERE.parent / folder / name
                target = frozen / folder / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                entries[target.relative_to(frozen).as_posix()] = digest(target)
        write(root / 'release-manifest.json', entries)
        gateway = {**config, 'statusFile': str(root / 'sessions.local.json')}
        write(root / 'gateway.local.json', gateway)
    with (root / 'supervisor.log').open('ab') as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'supervise', str(config_file)],
                                 cwd=root, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
    return {'status': 'starting', 'supervisorPid': child.pid, 'runDir': str(root)}


def supervise(config, config_file):
    root = validate(config)
    owner = json.loads((root / 'owner.json').read_text())
    if owner['configSha256'] != digest(config_file):
        raise ValueError('Owned configuration changed')
    for name, expected in json.loads((root / 'release-manifest.json').read_text()).items():
        if digest(root / 'release' / name) != expected:
            raise ValueError('Frozen gateway source changed')
    state = {'status': 'starting', 'ready': False, 'supervisorPid': os.getpid(), 'startedAt': time.time(), 'bootId': str(uuid.uuid4())}
    state_file = root / 'process-state.local.json'
    write(state_file, state)
    via_dir = root / 'via'; via_dir.mkdir(exist_ok=True)
    commands = [
        [config['node'], str(root / 'release/stock-gateway/gateway.cjs'), str(root / 'gateway.local.json')],
        [config['java'], '-Xms64m', '-Xmx512m', '-Djava.awt.headless=true', '-jar', config['viaJar'], 'cli',
         '--bind-address', '127.0.0.1:' + str(config['stockPort']), '--target-address', '127.0.0.1:' + str(config['bindPort']),
         '--target-version', '26.3', '--proxy-online-mode', 'false', '--auth-method', 'NONE', '--simple-voice-chat-support', 'false',
         '--ignore-protocol-translation-errors', 'false', '--suppress-client-protocol-errors', 'false',
         '--fake-accept-resource-packs', 'false', '--fix-fabric-particle-api', 'false', '--log-ips', 'false']
    ]
    children = []
    logs = []
    try:
        for label, command in zip(('node', 'via'), commands):
            log = (root / (label + '.log')).open('ab'); logs.append(log)
            child = subprocess.Popen(command, cwd=via_dir if label == 'via' else root, stdin=subprocess.PIPE,
                                     stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
            children.append(child); state[label + 'Pid'] = child.pid; write(state_file, state)
        while True:
            if any(child.poll() is not None for child in children):
                state.update(status='failed', ready=False, reason='owned_child_exited_no_automatic_action_replay'); break
            request = root / 'stop.request'
            if request.exists() and json.loads(request.read_text()).get('bootId') == state['bootId']:
                sessions = json.loads((root / 'sessions.local.json').read_text())
                if sessions['activeCount']:
                    state.update(status='stop_refused_clients_online', ready=True); write(state_file, state)
                else:
                    state.update(status='stopping', ready=False); break
            else:
                deployment = json.loads(Path(config['backendDeployment']).read_text())
                backend_state = json.loads((Path(deployment['cache']) / 'server-process.local.json').read_text())
                frontend_ready = state.get('ready') or all(listening(port) for port in (config['bindPort'], config['stockPort']))
                ready = frontend_ready and backend_state.get('ready') and alive(backend_state.get('pid'))
                state.update(status='ready' if ready else 'starting', ready=ready)
            write(state_file, state)
            time.sleep(1)
    finally:
        write(state_file, state)
        for child, command in zip(children, (b'{"kind":"shutdown"}\n', b'stop\n')):
            if child.poll() is None:
                try:
                    child.stdin.write(command); child.stdin.flush()
                except (BrokenPipeError, OSError):
                    pass
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.terminate(); child.wait(timeout=10)
        for log in logs:
            log.close()
        if state.get('status') != 'failed': state.update(status='stopped', ready=False)
        state['exitCodes'] = [child.returncode for child in children]
        state['stoppedAt'] = time.time(); write(state_file, state)
        with (root / 'lifecycle.jsonl').open('a', encoding='utf-8') as history:
            history.write(json.dumps(state) + '\n')


def status(config):
    root = Path(config['runDir'])
    file = root / 'process-state.local.json'
    if not file.exists(): return {'status': 'not_started', 'ready': False}
    value = json.loads(file.read_text())
    value['running'] = alive(value.get('supervisorPid')) and time.time() - file.stat().st_mtime < 5
    sessions = root / 'sessions.local.json'
    value['activeCount'] = json.loads(sessions.read_text())['activeCount'] if sessions.exists() else None
    if not value['running']: value['ready'] = False
    return value


def stop(config):
    root = Path(config['runDir'])
    if not status(config)['running']: return status(config)
    sessions = json.loads((root / 'sessions.local.json').read_text())
    from datetime import datetime
    if time.time() - datetime.fromisoformat(sessions['observedAt'].replace('Z', '+00:00')).timestamp() > 3:
        raise ValueError('Session state is stale; no safe empty-gateway stop')
    if sessions['activeCount']: raise ValueError('Clients online; disconnect them before stopping the gateway')
    write(root / 'stop.request', {'bootId': status(config)['bootId']})
    return {'status': 'stop_requested', 'ready': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'supervise', 'status', 'stop']); parser.add_argument('config', type=Path)
    args = parser.parse_args(); file = args.config.resolve(); config = json.loads(file.read_text(encoding='utf-8'))
    if args.action == 'start': print(json.dumps(start(config, file)))
    elif args.action == 'supervise': supervise(config, file)
    elif args.action == 'status': print(json.dumps(status(config)))
    else: print(json.dumps(stop(config)))
