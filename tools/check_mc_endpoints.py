"""Read-only Minecraft status handshake against both isolated entry points."""
from datetime import datetime, timezone
import json
from pathlib import Path
import socket
import struct

ROOT = Path(__file__).resolve().parents[1]


def varint(value):
    value &= 0xffffffff
    out = bytearray()
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return bytes(out)


def read_exact(sock, size):
    out = bytearray()
    while len(out) < size:
        part = sock.recv(size - len(out))
        if not part:
            raise ConnectionError('Status connection closed before a complete response')
        out.extend(part)
    return bytes(out)


def read_varint(sock):
    value = 0
    for shift in range(0, 35, 7):
        byte = read_exact(sock, 1)[0]
        value |= (byte & 127) << shift
        if byte < 128:
            return value
    raise ValueError('Invalid VarInt')


def probe(port):
    host = b'127.0.0.1'
    handshake = b'\x00' + varint(767) + varint(len(host)) + host + struct.pack('>H', port) + b'\x01'
    with socket.create_connection(('127.0.0.1', port), timeout=5) as sock:
        sock.sendall(varint(len(handshake)) + handshake + b'\x01\x00')
        packet_size = read_varint(sock)
        if not 3 <= packet_size <= 1024 * 1024:
            raise ValueError('Unexpected status response size')
        if read_varint(sock) != 0:
            raise ValueError('Not a status response')
        size = read_varint(sock)
        if not 1 <= size <= packet_size - 2:
            raise ValueError('Invalid JSON status length')
        data = json.loads(read_exact(sock, size))
        return {'ok': data['version']['protocol'] == 767,
                'port': port, 'protocol': data['version']['protocol'], 'version': data['version']['name']}


def main():
    checks = {}
    for name, port in [('direct', 25567), ('gate', 25701)]:
        try:
            checks[name] = probe(port)
        except Exception as exc:
            checks[name] = {'ok': False, 'port': port, 'error_type': type(exc).__name__}
    report = {'project': 'qiandengji', 'checked_at': datetime.now(timezone.utc).isoformat(),
              'ok': all(c['ok'] for c in checks.values()), 'checks': checks,
              'scope': 'Real status handshake; player login is checked by the AI smoke'}
    (ROOT / 'reports/mc-endpoints.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
