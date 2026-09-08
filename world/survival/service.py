"""Supervise the body loop and MCP endpoint; game QwenPaw owns the actual role."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
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


def main():
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
        controller = Controller(skills=SkillLibrary(STATE / 'skills'),
                                perception=WorldPerception(STATE, public_dir='/public'))
        connection = NativeToolConnection() if os.environ.get('SURVIVOR_QWEN_MODE', 'external') == 'external' else None
        try:
            deadline = time.monotonic() + 180
            while running and proc.poll() is None:
                try:
                    if readiness() and (connection is None or connection.ensure_ready()):
                        break
                except Exception:
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError('survivor_startup_timeout')
                time.sleep(2)
            while running and proc.poll() is None:
                started = time.monotonic()
                try:
                    if connection is not None:
                        connection.ensure_ready()
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
                proc.terminate()
                try:
                    proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)


if __name__ == '__main__':
    main()
