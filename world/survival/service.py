"""Supervise the body loop and MCP endpoint; game QwenPaw owns the actual role."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time
import urllib.request

from controller import Controller
from numen_gateway import read_json, write_json
from skill_library import SkillLibrary
from perception import WorldPerception
from native_tools import NativeToolConnection

STATE = Path('/state/survival')


def child_command(environ=None):
    env = os.environ if environ is None else environ
    mode = env.get('SURVIVOR_QWEN_MODE', 'external')
    if mode == 'external':
        return ['python', '-u', '/survival/mcp_server.py', '--http']
    if mode != 'embedded':
        raise ValueError('invalid_qwen_mode')
    if (STATE.parent / 'game-migration.json').exists():
        raise ValueError('migrated_role_cannot_run_embedded')
    return ['qwenpaw', 'app', '--host', '0.0.0.0', '--port', '8088', '--log-level', 'info']


def readiness(environ=None):
    env = os.environ if environ is None else environ
    external = env.get('SURVIVOR_QWEN_MODE', 'external') == 'external'
    base = env.get('QWENPAW_API_URL', 'http://qwenpaw:8088/api' if external
                   else 'http://127.0.0.1:8088/api').rstrip('/')
    with urllib.request.urlopen(base + '/healthz', timeout=3) as response:
        value = json.load(response)
    if value.get('status') != 'ok' or 'qd-survivor' not in value.get('agents_loaded', []):
        return False
    if external:
        with urllib.request.urlopen('http://127.0.0.1:8089/livez', timeout=3) as response:
            if json.load(response).get('ok') is not True:
                return False
    return True


def local_readiness(environ=None):
    """Only the owned child gates body-loop startup, never a remote model API."""
    env = os.environ if environ is None else environ
    if env.get('SURVIVOR_QWEN_MODE', 'external') != 'external':
        return readiness(env)
    with urllib.request.urlopen('http://127.0.0.1:8089/livez', timeout=3) as response:
        return json.load(response).get('ok') is True


class QwenConnectionProbe:
    """One bounded, read/driver-reconnect worker; it cannot submit model work.

    This snapshot is diagnostic only. Controller.submit_model still performs
    its own live native-tool check before reserving a decision or action lease.
    Only the main service thread copies diagnostics into controller state.
    """
    def __init__(self, connection, interval=30, clock=time.time):
        self.connection = connection
        self.interval = max(30, interval)
        self.clock = clock
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._status = {'ready': False, 'checkedAt': None, 'warning': 'qwen_probe_pending'}
        self._thread = threading.Thread(target=self._run, name='survivor-qwen-probe', daemon=True)

    def start(self):
        self._thread.start()

    def _run(self):
        while not self._stop.is_set():
            try:
                ready = self.connection.ensure_ready() is True
                warning = None if ready else 'native_survivor_tools_unavailable'
            except Exception as exc:
                ready, warning = False, 'qwen_probe_' + type(exc).__name__
            with self._lock:
                self._status = {'ready': ready, 'checkedAt': int(self.clock() * 1000),
                                'warning': warning}
            # Includes failed probes; no tight retry loop during an outage.
            if self._stop.wait(self.interval):
                break

    def snapshot(self):
        with self._lock:
            value = dict(self._status)
        if self._thread.ident is not None and not self._thread.is_alive() and not self._stop.is_set():
            value.update(ready=False, warning='qwen_probe_stopped')
        return value

    def stop(self):
        self._stop.set()
        # NativeToolConnection has at most four sequential 5-second requests.
        if self._thread.ident is not None:
            self._thread.join(timeout=25)
        return not self._thread.is_alive()


def main():
    # The service defaults to shared Qwen. Make that default explicit for the
    # controller's pre-reservation native-tool check as well as the child.
    os.environ.setdefault('SURVIVOR_QWEN_MODE', 'external')
    STATE.mkdir(parents=True, exist_ok=True)
    if not (STATE / 'control.json').exists():
        write_json(STATE / 'control.json', {'schema': 1, 'enabled': False})
    # Separate from the short action mutex. A second scheduler cannot own this body.
    with (STATE / 'service.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        proc = subprocess.Popen(child_command())
        running = True
        def stop(signum, frame):
            nonlocal running
            running = False
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        from party import SurvivorParty
        controller = Controller(skills=SkillLibrary(STATE / 'skills'),
                                perception=WorldPerception(STATE, public_dir='/public'),
                                party=SurvivorParty() if os.environ.get('PARTY_ENABLED') == '1' else None)
        probe = (QwenConnectionProbe(NativeToolConnection())
                 if os.environ.get('SURVIVOR_QWEN_MODE', 'external') == 'external' else None)
        try:
            deadline = time.monotonic() + 180
            while running and proc.poll() is None:
                try:
                    if local_readiness():
                        break
                except Exception:
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError('survivor_startup_timeout')
                time.sleep(2)
            if probe is not None and running and proc.poll() is None:
                probe.start()
            last_qwen_warning = object()
            while running and proc.poll() is None:
                started = time.monotonic()
                try:
                    if probe is not None:
                        diagnostic = probe.snapshot()
                        controller.data['qwenReadiness'] = diagnostic
                        if diagnostic['warning'] != last_qwen_warning:
                            print(json.dumps({'event': 'qwen_connection', **diagnostic}), flush=True)
                            last_qwen_warning = diagnostic['warning']
                    controller.tick()
                except Exception as exc:
                    # Unknown effects require attention; restart must not spend again.
                    controller.pause('controller_' + type(exc).__name__)
                    try:
                        controller.stop_actions()
                        controller.publish()
                    except Exception:
                        pass
                    print(json.dumps({'event': 'paused', 'errorType': type(exc).__name__}), flush=True)
                delay = max(1, controller.settings['observationSeconds'] - (time.monotonic() - started))
                until = time.monotonic() + delay
                while running and proc.poll() is None and time.monotonic() < until:
                    time.sleep(min(1, max(0.01, until - time.monotonic())))
            if proc.poll() is not None and running:
                controller.pause('survivor_child_exited')
                raise RuntimeError('survivor_child_exited')
        finally:
            try:
                controller.stop_actions()
                controller.data['status'] = 'stopped'
                controller.publish()
            finally:
                if probe is not None and not probe.stop():
                    print(json.dumps({'event': 'qwen_probe_shutdown_timeout'}), flush=True)
                proc.terminate()
                try:
                    proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)


if __name__ == '__main__':
    main()
