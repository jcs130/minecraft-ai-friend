"""Own the LAN Bedrock bridge independently of the existing world supervisor.

Geyser-ViaProxy -> ViaVersion -> a dedicated compatibility gate. This provides
protocol access, not native mod rendering or specialized mod UI support.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import time

import maw_service as service

ROOT = Path(r'E:\QiandengJiSocietyLab')
UDP_PORT, GATE_PORT, TCP_PORT, HEALTH_PORT = 28988, 28994, 28995, 28996
LAN_ADDRESS = '192.168.3.163'
MAGIC = bytes.fromhex('00ffff00fefefefefdfdfdfd12345678')
ARTIFACTS = {
    'ViaProxy-3.4.14.jar': '2894bbfb2f4342f8fde887af6c689313efd5b0e46a8006775eea0e21e2948ab5',
    'plugins/Geyser-ViaProxy.jar': 'b3b39ada8f56a44f018d5e405874cbb2152527fab0240603309831e89e5e95c7',
}


def geyser_config(address: str = LAN_ADDRESS) -> str:
    if address not in (LAN_ADDRESS, '127.0.0.1'):
        raise ValueError('Only the home LAN interface or loopback is supported')
    return f'''# Managed by maw_bedrock_service.py; no WAN/signaling exposure.
bedrock:
  address: {address}
  port: {UDP_PORT}
  transport: raknet
  clone-remote-port: false
  signaling:
    mode: none
java:
  auth-type: offline
motd:
  primary-motd: My Agent World
  secondary-motd: NeoForge LAN visitor
  passthrough-motd: false
  max-players: 4
  passthrough-player-counts: false
gameplay:
  server-name: My Agent World
  show-coordinates: true
  enable-custom-content: true
  enable-integrated-pack: true
  force-resource-packs: true
default-locale: zh_cn
log-player-ip-addresses: false
saved-user-logins: []
advanced:
  java:
    use-direct-connection: false
  bedrock:
    validate-bedrock-login: true
    use-haproxy-protocol: false
    use-waterdogpe-forwarding: false
enable-metrics: false
debug-mode: false
config-version: 8
'''


def decode_pong(data: bytes, stamp: int) -> dict:
    if (len(data) < 35 or data[0] != 0x1c or data[1:9] != struct.pack('>q', stamp)
            or data[17:33] != MAGIC or len(data) != 35 + struct.unpack('>H', data[33:35])[0]):
        raise ValueError('Invalid or mismatched RakNet Pong')
    fields = data[35:].decode('utf-8').split(';')
    if len(fields) < 12 or fields[0] != 'MCPE' or not fields[2].isdigit():
        raise ValueError('Invalid Bedrock advertisement')
    return {'motd': fields[1], 'protocol': int(fields[2]), 'version': fields[3],
            'online': int(fields[4]), 'maxPlayers': int(fields[5]), 'port': int(fields[10])}


def bedrock_probe(host: str = LAN_ADDRESS, port: int = UDP_PORT) -> dict:
    stamp = time.time_ns() // 1000000
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(1.5)
        sock.connect((host, port))
        sock.send(b'\x01' + struct.pack('>q', stamp) + MAGIC + struct.pack('>q', 0x4d41574252494447))
        data = sock.recv(4096)
    result = decode_pong(data, stamp)
    if result['port'] != port or result['motd'] != 'My Agent World' or result['maxPlayers'] != 4:
        raise ValueError('Unexpected Bedrock endpoint identity')
    return result


def check_udp_owner(port: int, pid: int, address: str) -> None:
    if os.name != 'nt':
        return
    from ctypes import wintypes as w
    class Row(ctypes.Structure):
        _fields_ = [('address', w.DWORD), ('port', w.DWORD), ('pid', w.DWORD)]
    api = ctypes.WinDLL('iphlpapi', use_last_error=True).GetExtendedUdpTable
    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(w.DWORD), w.BOOL, w.ULONG, ctypes.c_int, w.ULONG]
    api.restype = w.DWORD
    size = w.DWORD()
    result = api(None, ctypes.byref(size), False, 2, 1, 0)
    if result not in (0, 122):
        raise OSError('UDP owner table unavailable')
    buffer = ctypes.create_string_buffer(max(size.value, 4))
    if api(buffer, ctypes.byref(size), False, 2, 1, 0):
        raise OSError('UDP owner table unavailable')
    matches = []
    for index in range(w.DWORD.from_buffer(buffer).value):
        row = Row.from_buffer(buffer, 4 + index * ctypes.sizeof(Row))
        if socket.ntohs(row.port & 0xffff) == port and row.pid == pid:
            matches.append(socket.inet_ntoa(struct.pack('=I', row.address)))
    if matches != [address]:
        raise RuntimeError('Bedrock listener ownership/address mismatch')
    class Row6(ctypes.Structure):
        _fields_ = [('address', ctypes.c_ubyte * 16), ('scope', w.DWORD), ('port', w.DWORD), ('pid', w.DWORD)]
    size = w.DWORD()
    result = api(None, ctypes.byref(size), False, 23, 1, 0)
    if result not in (0, 122):
        raise OSError('IPv6 UDP owner table unavailable')
    buffer = ctypes.create_string_buffer(max(size.value, 4))
    if api(buffer, ctypes.byref(size), False, 23, 1, 0):
        raise OSError('IPv6 UDP owner table unavailable')
    for index in range(w.DWORD.from_buffer(buffer).value):
        row = Row6.from_buffer(buffer, 4 + index * ctypes.sizeof(Row6))
        if socket.ntohs(row.port & 0xffff) == port and row.pid == pid:
            raise RuntimeError('Unexpected IPv6 Bedrock listener')


def load_config(path: Path, *, root: Path = ROOT) -> dict:
    raw = service.read_json(path)
    if raw != {'schemaVersion': 1, 'lanAddress': LAN_ADDRESS, 'udpPort': UDP_PORT}:
        raise ValueError('Expected the fixed LAN bridge configuration')
    directory = (root / 'bedrock').resolve()
    main_path = root/'services/service.json'
    main = service.read_json(main_path)
    gate_source = next(row for row in main['services'] if row['id'] == 'gate' and row['port'] == 28977)
    gate_command = list(gate_source['command'])
    if gate_command[-3:] != ['28977', '127.0.0.1', '28976']:
        raise ValueError('Unexpected original gateway route')
    gate_command[-3] = str(GATE_PORT)
    gate_env = {**gate_source['env'], 'GATE_LISTEN_HOST': '127.0.0.1',
        'GATE_NATIVE_VIEWER': '0', 'GATE_BEDROCK_PROJECTION': '1',
        'GATE_CACHE_FILE': str(directory/'knowledge.json'),
        'GATE_FAILURE_CAPTURE_FILE': str(directory/'protocol-failures.jsonl')}
    gate_env.pop('GATE_LAN_SUBNET', None)
    expected_files = {directory / name: sha for name, sha in ARTIFACTS.items()}
    expected_files[directory / 'plugins/Geyser/config.yml'] = hashlib.sha256(geyser_config().encode()).hexdigest()
    resources = directory/'plugins/Geyser'
    if (resources/'resource-contract.json').exists():
        import maw_bedrock_resources as resource_builder
        contract = resource_builder.validate(resources, deployed=True)
        expected_files[resources/'resource-contract.json'] = hashlib.sha256((resources/'resource-contract.json').read_bytes()).hexdigest()
        for name, subdirectory in [(resource_builder.PACK, 'packs'), (resource_builder.MAPPINGS, 'custom_mappings'),
                                   (resource_builder.CATALOG, '')]:
            expected_files[resources/subdirectory/name] = contract['files'][name]['sha256']
        if hashlib.sha256(Path(gate_env['GATE_IDMAP_FILE']).read_bytes()).hexdigest() != contract['inputs']['idmapSha256']:
            raise ValueError('Bedrock resources do not match the native item projection')
        gate_env['GATE_BEDROCK_ITEMS_FILE'] = str(resources/resource_builder.CATALOG)
    stat = path.stat()
    stamps = {path: (stat.st_size, stat.st_mtime_ns)}
    stat = main_path.stat(); stamps[main_path] = (stat.st_size, stat.st_mtime_ns)
    for file, expected in expected_files.items():
        if not file.is_file() or file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Bridge artifact/configuration mismatch: {file.name}')
        stat = file.stat(); stamps[file] = (stat.st_size, stat.st_mtime_ns)
    def validate():
        if {file.name for file in (directory/'plugins').glob('*.jar')} != {'Geyser-ViaProxy.jar'}:
            raise ValueError('Unexpected bridge plugin')
        for file, stamp in stamps.items():
            stat = file.stat()
            if (stat.st_size, stat.st_mtime_ns) != stamp:
                raise ValueError('Bridge files changed; stop and validate before resuming')
    java = service.DEFAULT_JAVA
    if not java.is_file():
        raise ValueError('Existing Java 21 runtime is required')
    command = [str(java), '-Djava.net.preferIPv4Stack=true', '-Xms128M', '-Xmx512M', '-jar',
        str(directory / 'ViaProxy-3.4.14.jar'), 'cli', '--target-address', f'127.0.0.1:{GATE_PORT}',
        '--target-version', '1.21.1', '--auth-method', 'NONE', '--bind-address', f'127.0.0.1:{TCP_PORT}',
        '--wildcard-domain-handling', 'NONE']
    return {'serverDir': str(directory), 'runtimeDir': str(directory / 'ops'), 'gamePort': TCP_PORT,
        'healthPort': HEALTH_PORT, 'validator': validate,
        'networkExposure': {'mode': 'lan', 'address': LAN_ADDRESS, 'udpPort': UDP_PORT,
                            'subnet': '192.168.3.0/24', 'javaListenHost': '127.0.0.1'},
        'services': [{'id': 'compat_gate', 'command': gate_command, 'cwd': gate_source['cwd'], 'env': gate_env,
            'host': '127.0.0.1', 'listenHost': '127.0.0.1', 'port': GATE_PORT, 'dependsOn': [],
            'readiness': 'minecraft', 'startupTimeoutSeconds': 150, 'stopMode': 'stdin', 'stopText': '{"kind":"shutdown"}'},
            {'id': 'bedrock', 'command': command, 'cwd': str(directory), 'env': {},
            'host': '127.0.0.1', 'listenHost': '127.0.0.1', 'port': TCP_PORT, 'dependsOn': ['compat_gate'],
            'readiness': 'minecraft', 'startupTimeoutSeconds': 150, 'stopMode': 'stdin', 'stopText': 'stop'}]}


class BedrockChild(service.Child):
    def tick(self):
        super().tick()
        if self.ready and self.spec['id'] == 'bedrock':
            try:
                check_udp_owner(UDP_PORT, self.process.pid, LAN_ADDRESS)
                self.metrics['bedrock'] = bedrock_probe()
            except Exception as error:
                self.ready = False
                self.problem = 'bedrock_readiness_failed: ' + str(error)
                if time.monotonic() - self.started > self.spec['startupTimeoutSeconds']:
                    self.stop()


class BedrockSupervisor(service.Supervisor):
    def apply(self, request):
        if request.get('action') == 'console':
            raise ValueError('Bridge console access is not exposed')
        return super().apply(request)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('plan', 'run', 'status', 'pause', 'resume', 'stop', 'shutdown'))
    parser.add_argument('--config', type=Path, default=ROOT/'services/bedrock.json')
    parser.add_argument('--request-id')
    args = parser.parse_args()
    config = load_config(args.config)
    if args.action == 'plan':
        print(json.dumps({'ok': True, 'udp': f'{LAN_ADDRESS}:{UDP_PORT}',
            'upstream': f'127.0.0.1:{GATE_PORT}', 'health': f'127.0.0.1:{HEALTH_PORT}',
            'javaProxy': f'127.0.0.1:{TCP_PORT}', 'artifactHashesVerified': True,
            'serverDir': config['serverDir'], 'runtimeDir': config['runtimeDir'],
            'healthPort': HEALTH_PORT, 'services': [{'id': 'bedrock', 'port': TCP_PORT}],
            'actualBedrockLoginVerified': False}))
    elif args.action == 'run':
        BedrockSupervisor(config, validator=config['validator'], child_factory=BedrockChild).run()
    elif args.action == 'status':
        value = service.read_json(Path(config['runtimeDir'])/'health.json')
        value['heartbeatFresh'] = 0 <= time.time()-value.get('heartbeatEpoch', 0) <= 15
        value['healthy'] = value.get('healthy') is True and value['heartbeatFresh']
        print(json.dumps(value))
    else:
        request = {'action': args.action}
        if args.request_id:
            request['requestId'] = args.request_id
        print(json.dumps(service.submit(config, request)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'reason': f'{type(error).__name__}: {error}'}))
        sys.exit(1)
