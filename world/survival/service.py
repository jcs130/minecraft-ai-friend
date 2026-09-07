"""One supervised container: native QwenPaw backend plus the durable body loop."""
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

STATE = Path('/state/survival')


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    if not (STATE / 'control.json').exists():
        write_json(STATE / 'control.json', {'schema': 1, 'enabled': False})
    # Separate from the short action mutex. A second scheduler cannot own this body.
    with (STATE / 'service.lock').open('a+b') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        proc = subprocess.Popen(['qwenpaw', 'app', '--host', '0.0.0.0', '--port', '8088', '--log-level', 'info'])
        running = True
        def stop(signum, frame):
            nonlocal running
            running = False
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        controller = Controller(skills=SkillLibrary(STATE / 'skills'))
        try:
            deadline = time.monotonic() + 180
            while running and proc.poll() is None:
                try:
                    with urllib.request.urlopen('http://127.0.0.1:8088/api/healthz', timeout=3) as response:
                        if json.load(response).get('status') == 'ok':
                            break
                except Exception:
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError('qwen_startup_timeout')
                time.sleep(2)
            while running and proc.poll() is None:
                started = time.monotonic()
                try:
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
                controller.pause('qwen_backend_exited')
                raise RuntimeError('qwen_backend_exited')
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
