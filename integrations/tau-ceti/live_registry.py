"""Prepare a gateway registry once per owned JVM boot, before admitting clients."""
from pathlib import Path
import json
import os
import subprocess
import threading
import uuid


class LiveRegistry:
    def __init__(self, config):
        self.server = Path(config['serverDir'])
        self.runtime = Path(config['runtimeDir'])
        self.template = Path(config['_raw']['agentGateway']['releaseDir'])
        self.script = Path(__file__).with_name('prepare_live_registry.cjs')
        self.pid = None
        self.phase = 'idle'
        self.problem = None
        self.output = None
        self.previous = None
        self.generation = None
        self.job = None

    def tick(self, pid, send):
        complete = self.server / 'dump/maw-registry-ids/complete.json'
        if self.pid != pid:
            self.pid = pid
            self.phase = 'waiting_for_export'
            self.problem = None
            self.output = None
            self.generation = uuid.uuid4().hex
            try: self.previous = complete.read_bytes()
            except OSError: self.previous = None
            # A read-only export is requested once, never repeatedly while its
            # completion is unknown. The server thread owns the actual export.
            try: send('maw_registry dumpids')
            except Exception as error:
                self.phase = 'failed'; self.problem = str(error)
        if self.phase == 'waiting_for_export':
            try:
                data = complete.read_bytes()
                if data == self.previous or len(data) > 4096: return False
                observed = json.loads(data)
                if observed.get('processId') != pid: return False
            except (OSError, ValueError): return False
            self.phase = 'preparing'
            self._start_prepare(pid, self.generation)
        return self.phase == 'ready' and self.pid == pid

    def _start_prepare(self, pid, generation):
        thread = threading.Thread(target=self._prepare, args=(pid, generation), daemon=True,
                                  name='tau-registry-' + str(pid))
        thread.start()

    def _prepare(self, pid, generation):
        directory = self.runtime / 'registries' / (str(pid) + '-' + generation[:8])
        directory.parent.mkdir(parents=True, exist_ok=True)
        try:
            creation = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
            process = subprocess.Popen([str(self.template / 'node.exe'), str(self.script),
                str(self.server / 'dump/maw-registry-ids'), str(self.template), str(directory), str(pid)],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **creation)
            if self.job is not None: self.job.assign(process)
            try: stdout, stderr = process.communicate(timeout=120)
            except subprocess.TimeoutExpired:
                # The child only reads definitions and writes a new private
                # snapshot; it performs no game action and can be cancelled.
                process.kill(); stdout, stderr = process.communicate()
                raise RuntimeError('Registry preparer timed out; gateway remains closed')
            if process.returncode: raise RuntimeError(stderr.decode('utf-8', errors='replace')[-1000:])
            record = json.loads((directory / 'complete.json').read_text(encoding='utf-8'))
            if record.get('serverPid') != pid: raise RuntimeError('Registry snapshot process differs')
            if self.pid == pid and self.generation == generation:
                self.output = directory
                self.phase = 'ready'
        except Exception as error:
            if self.pid == pid and self.generation == generation:
                self.phase = 'failed'; self.problem = str(error)

    def environment(self):
        if self.phase != 'ready' or self.output is None: raise RuntimeError('Current JVM registry is not ready')
        root = self.output
        env = {'GATE_NATIVE_STATES_FILE': str(root / 'block-states.jsonl'),
               'GATE_CACHE_FILE': str(root / 'gateway-cache.json')}
        for key, name in {'GATE_CHANNELS_FILE': 'network-channels.json', 'GATE_COMPONENTS_FILE': 'components.tsv',
            'GATE_PARTICLES_FILE': 'particles.tsv', 'GATE_ENTITY_SERIALIZERS_FILE': 'entity-data-serializers.tsv',
            'GATE_IDMAP_FILE': 'idmap.json', 'GATE_BEDROCK_ITEMS_FILE': 'items.json'}.items(): env[key] = str(root / name)
        return env
