"""Read-only game inventory worker for the existing Python sidecar image.

Only fixed Docker container-inspect GETs are implemented. No Docker CLI, exec,
model calls or lifecycle operations run here. The socket is administrative at
the OS level; its read-only mount alone is not an HTTP permission boundary.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import http.client
import json
from pathlib import Path
import socket
import tempfile
import time
import urllib.request

import operations
import qwenpaw_inventory
from operations_inventory_lock import inventory_lock

ROOT = Path(__file__).resolve().parents[1]
HEALTH = ROOT/'server/panel-state/inventory-health.json'
INTERVAL = 120
MAX_INSPECT_BYTES = 2 * 1024 * 1024


class DockerConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=5)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


class DockerInventory:
    def __init__(self, allowed, connection= DockerConnection):
        self.allowed = frozenset(allowed)
        self.connection = connection
        self.cache = {}

    def inspect(self, name):
        if name not in self.allowed or not operations.NAME.fullmatch(name):
            raise ValueError('unregistered_inventory_container')
        if name in self.cache:
            return self.cache[name]
        client = self.connection()
        try:
            client.request('GET', '/containers/' + name + '/json')
            response = client.getresponse()
            data = response.read(MAX_INSPECT_BYTES + 1)
            if response.status == 404:
                self.cache[name] = None
                return None
            if response.status != 200 or len(data) > MAX_INSPECT_BYTES:
                raise ValueError('docker_inspect_unavailable')
            raw = json.loads(data)
            if not isinstance(raw, dict) or not isinstance(raw.get('State'), dict):
                raise ValueError('docker_inspect_invalid')
            config = raw.get('Config', {})
            state = raw['State']
            labels = config.get('Labels', {}) or {}
            # Drop environment, mounts, commands and all other private data
            # before even retaining the observation in this round's cache.
            self.cache[name] = {
                'state': state.get('Status', 'unknown'), 'running': state.get('Running') is True,
                'health': (state.get('Health') or {}).get('Status', ''),
                'project': labels.get('com.docker.compose.project'),
                'service': labels.get('com.docker.compose.service'),
                'restart': raw.get('HostConfig', {}).get('RestartPolicy', {}).get('Name', ''),
                'id': raw.get('Id'), 'startedAt': state.get('StartedAt'),
                'image': config.get('Image'), 'imageId': raw.get('Image'),
            }
            return self.cache[name]
        finally:
            client.close()

    def operations_states(self, names):
        result = {}
        for name in names:
            try:
                value = self.inspect(name)
                result[name] = value or {'state': 'absent', 'health': 'not-applicable', 'project': None, 'restart': None}
            except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
                result[name] = {'state': 'unavailable', 'health': 'unknown', 'project': None, 'restart': None}
        return result

    def qwen_state(self, name):
        if name != 'qiandengji-qwenpaw-1':
            return {}  # Other runtimes are intentionally outside this worker.
        value = self.inspect(name)
        if value is None:
            return {}
        return {'state': value['health'] if value['running'] and value['health'] else value['state'],
                'image': value['image'], 'imageId': value['imageId']}


@contextmanager
def adapters(observations):
    original_inspect = operations.inspect_containers
    original_tts = operations.probe_shared_tts
    original_container = qwenpaw_inventory._container
    original_collect = qwenpaw_inventory.collect_qwenpaw_inventory
    original_publisher = operations._INVENTORY_PUBLISHER

    def current_inventory(*, project_root):
        result = original_collect(project_root=project_root, user_home=Path('/unmounted-non-game-home'))
        result['runtimes'] = [row for row in result['runtimes'] if row['id'] == 'qiandengji']
        result['agents'] = [row for row in result['agents'] if row['runtimeId'] == 'qiandengji']
        result['issues'] = [row for row in result['issues']
            if not row.get('code', '').startswith(('host_', 'shadow_'))
            and row.get('code') not in ('runtime_versions_differ', 'legacy_access_review')]
        return result

    def tts_open(url, timeout):
        if url != 'http://127.0.0.1:8100/health':
            raise ValueError('unregistered_inventory_endpoint')
        return urllib.request.urlopen('http://tts:8100/health', timeout=timeout)

    operations.inspect_containers = observations.operations_states
    operations.probe_shared_tts = lambda: original_tts(tts_open)
    qwenpaw_inventory._container = observations.qwen_state
    qwenpaw_inventory.collect_qwenpaw_inventory = current_inventory
    operations._INVENTORY_PUBLISHER = True
    try:
        yield
    finally:
        operations.inspect_containers = original_inspect
        operations.probe_shared_tts = original_tts
        qwenpaw_inventory._container = original_container
        qwenpaw_inventory.collect_qwenpaw_inventory = original_collect
        operations._INVENTORY_PUBLISHER = original_publisher


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False, suffix='.tmp') as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, ensure_ascii=False)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def collect_once(root=ROOT):
    registry = operations.read_registry(root)
    allowed = ['qiandengji-' + row['id'] + '-1' for row in registry['services']]
    allowed.extend(row['container'] for row in registry['externalServices'])
    with inventory_lock(root, wait_seconds=10) as acquired:
        if not acquired:
            raise RuntimeError('inventory_busy')
        with adapters(DockerInventory(allowed)):
            value = operations.collect_snapshot(root)
            operations.write_snapshot(value, root)
        # Health proves publication finished, independently of monitored health.
        # An unavailable MC must remain red in operations.json, not kill this
        # collector and create a circular health dependency.
        atomic_json(root/'server/panel-state/inventory-health.json', {
            'schema': 1, 'service': 'inventory', 'ok': True, 'updatedAt': time.time(),
            'intervalSeconds': INTERVAL, 'publishedAt': value['generatedAt'],
            'currentServices': value['checks']['currentServices'], 'modelCalls': 0,
        })
    return value


def healthy(path=HEALTH, now=None):
    try:
        if path.stat().st_size > 8192:
            return False
        value = json.loads(path.read_text('utf-8'))
        stamp = value.get('updatedAt')
        return (value.get('schema') == 1 and value.get('service') == 'inventory'
                and value.get('ok') is True and type(stamp) in (int, float)
                and 0 <= (time.time() if now is None else now) - stamp <= INTERVAL * 2 + 30)
    except (OSError, ValueError, TypeError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    if args.health:
        return 0 if healthy() else 1
    while True:
        started = time.monotonic()
        try:
            value = collect_once()
            print(json.dumps({'ok': True, 'publishedAt': value['generatedAt'],
                              'currentServices': value['checks']['currentServices']}), flush=True)
        except Exception as error:
            print(json.dumps({'ok': False, 'errorType': type(error).__name__}), flush=True)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(max(1, INTERVAL - (time.monotonic() - started)))


if __name__ == '__main__':
    raise SystemExit(main())
