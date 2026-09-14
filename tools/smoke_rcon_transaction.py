"""Old/new native RCON concurrency in one disposable, isolated Minecraft world."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import struct
import subprocess
import threading
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def run(args, timeout=90, check=True):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-3000:] or result.stdout[-3000:])
    return result


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def frame(rid, kind, text):
    payload = text.encode('utf-8')
    return struct.pack('<iii', len(payload) + 10, rid, kind) + payload + b'\0\0'


def exact(sock, size):
    result = b''
    while len(result) < size:
        part = sock.recv(size - len(result))
        if not part:
            raise EOFError('qa_rcon_closed')
        result += part
    return result


def receive(sock):
    size, = struct.unpack('<i', exact(sock, 4))
    if not 10 <= size <= 1048576:
        raise ValueError('qa_invalid_frame')
    data = exact(sock, size)
    if data[-2:] != b'\0\0':
        raise ValueError('qa_invalid_terminator')
    return (*struct.unpack('<ii', data[:8]), data[8:-2].decode('utf-8'))


def command(port, password, text):
    with socket.create_connection(('127.0.0.1', port), timeout=15) as sock:
        sock.settimeout(15)
        sock.sendall(frame(1, 3, password))
        if receive(sock) != (1, 2, ''):
            raise ValueError('qa_auth_failed')
        sock.sendall(frame(2, 2, text))
        parts = []
        for _ in range(256):
            rid, kind, value = receive(sock)
            if (rid, kind) == (2, 0):
                parts.append(value)
                if len(parts) == 1:
                    sock.sendall(frame(3, 0, ''))
            elif (rid, kind, value) == (3, 0, 'Unknown request 0') and parts:
                return ''.join(parts)
            else:
                raise ValueError('qa_reply_id_or_end_mismatch')
        raise ValueError('qa_reply_unbounded')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-isolated', action='store_true', required=True)
    parser.add_argument('--build-record', type=Path, required=True)
    args = parser.parse_args()
    record = json.loads(args.build_record.read_text('utf-8'))
    candidate = Path(record['jar'])
    if sha(candidate) != record['sha256'] or record.get('deployed') is not False:
        raise ValueError('candidate_record_invalid')
    if any(sha(ROOT / name) != digest for name, digest in record['sourceFiles'].items()):
        raise ValueError('candidate_sources_changed')
    base_jar = ROOT / 'server/mc/mods/botgate.jar'
    if sha(base_jar) != record['baseSha256']:
        raise ValueError('production_base_changed')
    identity = uuid.uuid4().hex[:12]
    folder = ROOT / 'runtime' / ('rcon-transaction-qa-' + identity)
    data = folder / 'data'
    (data / 'mods').mkdir(parents=True)
    print(json.dumps({'stage': 'preparing', 'folder': str(folder)}), flush=True)
    for mod in (ROOT / 'server/mc/mods').glob('*.jar'):
        shutil.copyfile(mod, data / 'mods' / mod.name)
    spec = importlib.util.spec_from_file_location('rcon_qa_build_classpath', ROOT / 'world/botgate-src/build.py')
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    classes = folder / 'qa-classes'
    classes.mkdir()
    source = ROOT / 'world/botgate-src/tests/RconReplyQa.java'
    driver = ROOT / 'world/botgate-src/tests/RconConcurrentClient.java'
    quote = lambda value: '"' + str(value).replace('\\', '/') + '"'
    javac_args = folder / 'javac.args'
    javac_args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8',
        '-cp', quote(build.full_cp(ROOT / 'server/mc/libraries')), '-d', quote(classes), quote(source), quote(driver)]), 'utf-8')
    run([build.JAVAC, '@' + str(javac_args)])
    with zipfile.ZipFile(data / 'mods/qiandeng-rcon-qa.jar', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in classes.rglob('*.class'):
            archive.write(path, path.relative_to(classes).as_posix())
        archive.writestr('META-INF/neoforge.mods.toml', 'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="qiandeng_rcon_reply_qa"\nversion="0.0.1"\ndisplayName="Isolated RCON reply QA"\n')
    password = secrets.token_hex(24)
    (data / 'eula.txt').write_text('eula=true\n', 'ascii')
    (data / 'server.properties').write_text('\n'.join(['level-name=qa-world', 'level-type=minecraft:flat',
        'online-mode=false', 'enforce-secure-profile=false', 'enable-rcon=true', 'rcon.port=25575',
        'rcon.password=' + password, 'view-distance=2', 'simulation-distance=2', 'difficulty=peaceful',
        'spawn-protection=0', 'max-tick-time=120000', 'allow-flight=true', '']), 'ascii')
    image = run(['docker', 'image', 'inspect', 'itzg/minecraft-server:java21', '--format', '{{.Id}}']).stdout.strip()
    compose = {'services': {'mc': {'image': image,
        'entrypoint': ['java', '-Xms1G', '-Xmx3G', '@libraries/net/neoforged/neoforge/21.1.248/unix_args.txt', 'nogui'],
        'working_dir': '/data', 'environment': {'QD_QA_FIXTURE': 'isolated-rcon-transaction'},
        'volumes': [f'{data.as_posix()}:/data', f'{(ROOT / "server/mc/libraries").as_posix()}:/data/libraries:ro'],
        'networks': ['qa'], 'stop_grace_period': '60s'}},
        'networks': {'qa': {'internal': True}}}
    compose_path = folder / 'compose.json'
    compose_path.write_text(json.dumps(compose), 'utf-8')
    base = ['docker', 'compose', '-p', 'qiandeng-rcon-qa-' + identity, '-f', str(compose_path)]
    checks, details = {}, {}

    def qa_client(mode, value=None):
        cp = '/data/mods/qiandeng-rcon-qa.jar:/data/libraries/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar'
        argv = [*base, 'exec', '-T', 'mc', 'java', '-cp', cp,
                'dev.qiandeng.rconqa.RconConcurrentClient', mode]
        if value is not None:
            argv.append(value)
        return json.loads(run(argv, timeout=90).stdout)

    def command(port, password, text):
        return qa_client('single', text)['raw']

    def boot():
        run([*base, 'up', '-d'], timeout=180)
        port = None  # Driver executes only inside this exact isolated container.
        deadline = time.monotonic() + 360
        while time.monotonic() < deadline:
            try:
                if command(port, password, 'qdrconqa status').startswith('QD_RCON_COUNTS '):
                    return port
            except (OSError, EOFError, ValueError, RuntimeError):
                pass
            time.sleep(3)
        raise RuntimeError('qa_native_boot_failed')

    def concurrent(port, label):
        rows = qa_client('concurrent', label)['rows']
        counts_raw = command(port, password, 'qdrconqa status')
        counts = json.loads(counts_raw.removeprefix('QD_RCON_COUNTS '))
        return {'total': len(rows), 'exact': sum(r['exact'] for r in rows),
                'everyCommandExecutedOnce': all(counts.get(row['token']) == 1 for row in rows),
                'rows': rows, 'counts': counts}

    try:
        old_port = boot()
        details['old'] = concurrent(old_port, 'old')
        checks['old_native_race_reproduced'] = details['old']['exact'] < details['old']['total']
        checks['old_commands_not_replayed'] = details['old']['everyCommandExecutedOnce']
        (folder / 'old-server.log').write_text(run([*base, 'logs', '--no-color']).stdout, 'utf-8')
        run([*base, 'stop', '-t', '60', 'mc'], timeout=100)
        shutil.copyfile(candidate, data / 'mods/botgate.jar')
        new_port = boot()
        details['new'] = concurrent(new_port, 'new')
        checks['new_all_native_replies_exact'] = details['new']['exact'] == details['new']['total'] == 96
        checks['new_commands_execute_once'] = details['new']['everyCommandExecutedOnce']
        failure = command(new_port, password, 'qdrconqa echo throw-once')
        after = command(new_port, password, 'qdrconqa echo after-error')
        counts = json.loads(command(new_port, password, 'qdrconqa status').removeprefix('QD_RCON_COUNTS '))
        details['exception'] = {'reply': failure, 'nextReply': after,
                                'failedCount': counts.get('throw-once'), 'nextCount': counts.get('after-error')}
        checks['native_error_releases_transaction'] = after == 'QD_RCON_REPLY after-error\n'
        checks['failed_command_not_replayed'] = counts.get('throw-once') == counts.get('after-error') == 1
        denied = qa_client('auth')
        counts = json.loads(command(new_port, password, 'qdrconqa status').removeprefix('QD_RCON_COUNTS '))
        checks['native_auth_preserved'] = denied['authDenied'] and denied['commandDenied'] and 'unauthorized' not in counts
        checks['production_jar_unchanged'] = sha(base_jar) == record['baseSha256']
    except Exception as error:
        details['failure'] = {'type': type(error).__name__, 'message': str(error)[-3000:]}
        checks['execution_completed'] = False
    finally:
        (folder / 'server-final.log').write_text(run([*base, 'logs', '--no-color'], check=False).stdout, 'utf-8')
        removed = run([*base, 'down', '--timeout', '60'], timeout=120, check=False)
        checks['isolated_services_removed'] = removed.returncode == 0 and not run([*base, 'ps', '-a', '-q'], check=False).stdout.strip()
    report = {'schema': 1, 'ok': all(checks.values()), 'checks': checks, 'details': details,
        'candidateSha256': record['sha256'], 'baseSha256': record['baseSha256'],
        'fixtureSha256': sha(source), 'driverSha256': sha(driver), 'toolSha256': sha(__file__), 'image': image,
        'productionActions': 0, 'modelCalls': 0, 'ttsCalls': 0, 'deployed': False}
    report_path = folder / 'report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps({'report': str(report_path), 'ok': report['ok'], 'checks': checks,
                     'oldExact': details.get('old', {}).get('exact'), 'newExact': details.get('new', {}).get('exact')}, ensure_ascii=False), flush=True)
    if not report['ok']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
