"""Pinned runtime selection and exact Linux child cleanup for Drama 3."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import sys
import time


def load_runtime(path: Path) -> dict | None:
    if not path.exists():
        return None
    if path.stat().st_size > 16384:
        raise ValueError('runtime config exceeds 16 KiB')
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    keys = {'schema_version', 'engine_version', 'binary', 'model', 'binary_sha256', 'manifest_sha256'}
    if not isinstance(config, dict) or set(config) != keys or config['schema_version'] != 1:
        raise ValueError('invalid runtime config fields or schema')
    if not re.fullmatch(r'\d+\.\d+\.\d+', str(config['engine_version'])):
        raise ValueError('invalid runtime engine version')
    for key in ('binary_sha256', 'manifest_sha256'):
        if not re.fullmatch(r'[a-f0-9]{64}', str(config[key])):
            raise ValueError('invalid runtime config digest')
    binary, model = Path(config['binary']), Path(config['model'])
    if not binary.is_absolute() or not model.is_absolute():
        raise ValueError('runtime config paths must be absolute')
    with binary.open('rb') as handle:
        binary_hash = hashlib.file_digest(handle, 'sha256').hexdigest()
    if binary_hash != config['binary_sha256']:
        raise ValueError('runtime binary hash mismatch')
    manifest_path = model / 'asset-manifest.json'
    if manifest_path.stat().st_size > 65536:
        raise ValueError('runtime manifest exceeds 64 KiB')
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != config['manifest_sha256']:
        raise ValueError('runtime manifest hash mismatch')
    manifest = json.loads(raw)
    if manifest.get('format') != 'drama-rs-v1':
        raise ValueError('runtime manifest format mismatch')
    for key in ('source_revision', 'converter_revision'):
        if not re.fullmatch(r'[a-f0-9]{40}', str(manifest.get(key, ''))):
            raise ValueError('invalid runtime manifest source revision')
    required = {'globals.safetensors', 'tower.safetensors', 'codec.safetensors', 'tokenizer.json'}
    required.update(f'layer{i:02}.safetensors' for i in range(40))
    files = manifest.get('files')
    if not isinstance(files, list) or len(files) > 64:
        raise ValueError('invalid runtime manifest files')
    seen = set()
    for row in files:
        name = row.get('name', '')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or name in seen:
            raise ValueError('invalid or repeated runtime asset name')
        if type(row.get('bytes')) is not int or row['bytes'] <= 0 or not re.fullmatch(r'[a-f0-9]{64}', row.get('sha256', '')):
            raise ValueError('invalid runtime asset size or hash')
        file = model / name
        if not file.is_file() or file.stat().st_size != row['bytes']:
            raise ValueError('runtime asset missing or resized: ' + name)
        seen.add(name)
    if not required <= seen:
        raise ValueError('runtime manifest lacks required model assets')
    if json.loads((model / 'drama.json').read_text(encoding='utf-8'))['format'] != 'drama-rs-v1':
        raise ValueError('runtime model layout mismatch')
    # Whole-asset hashes are checked when preparing/promoting the candidate.
    # Startup binds that manifest and file sizes without rereading 21 GB of weights.
    return {'binary': str(binary), 'model': str(model), 'identity': {
        'engine_version': config['engine_version'], 'source_repository': 'fishaudio/drama-3',
        'source_revision': manifest['source_revision'], 'converter_revision': manifest['converter_revision'],
        'quantization_format': 'drama-rs-v1', 'manifest_sha256': config['manifest_sha256']}}


def _identity(pid: int, binary: Path, address: str) -> str | None:
    proc = Path('/proc') / str(pid)
    try:
        if (proc / 'exe').resolve(strict=True) != binary:
            return None
        args = (proc / 'cmdline').read_bytes().split(b'\0')
        if b'serve' not in args or b'--addr' not in args:
            return None
        if args[args.index(b'--addr') + 1].decode() != address:
            return None
        # Start time protects against PID reuse between the scan and signaling.
        fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
        return None if fields[0] == 'Z' else fields[19]
    except (FileNotFoundError, PermissionError, IndexError, UnicodeDecodeError):
        return None


def reap_runtime(binary_name: str, address: str, grace: float = 5, kill_wait: float = 15) -> dict:
    if sys.platform != 'linux' or not re.fullmatch(r'127\.0\.0\.1:\d{1,5}', address):
        raise ValueError('cleanup requires Linux and an explicit loopback port')
    binary = Path(binary_name).resolve(strict=True)
    matches = {}
    for proc in Path('/proc').iterdir():
        if proc.name.isdigit():
            identity = _identity(int(proc.name), binary, address)
            if identity is not None:
                matches[int(proc.name)] = identity

    def survivors():
        return {pid: stamp for pid, stamp in matches.items() if _identity(pid, binary, address) == stamp}

    def send(sig):
        for pid in survivors():
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass

    send(signal.SIGTERM)
    deadline = time.monotonic() + grace
    while survivors() and time.monotonic() < deadline:
        time.sleep(.1)
    forced = list(survivors())
    if forced:
        send(signal.SIGKILL)
        deadline = time.monotonic() + kill_wait
        while survivors() and time.monotonic() < deadline:
            time.sleep(.1)
    remaining = list(survivors())
    if remaining:
        raise RuntimeError(f'prior Drama runtime did not exit: {remaining}')
    host, port = address.rsplit(':', 1)
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, int(port)))
        except OSError as exc:
            raise RuntimeError('native port is still occupied: ' + address) from exc
    return {'matched': list(matches), 'forced': forced, 'remaining': remaining, 'native_port_free': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reap', required=True)
    parser.add_argument('--address', required=True)
    args = parser.parse_args()
    print(json.dumps(reap_runtime(args.reap, args.address)), flush=True)
