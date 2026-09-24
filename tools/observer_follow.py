"""Keep the local Java observer's camera attached to Kirito while its client runs.

Minecraft drops a spectator camera when the target dies, respawns, or is
replaced. This watcher observes both players before issuing a bounded,
idempotent /spectate command; it never moves or changes Kirito.
"""

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import sys
import time

import psutil

from live_spectate import _password

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world' / 'survival'))
from numen_gateway import RconClient  # noqa: E402

WORK = ROOT / 'runtime' / 'observer-client'
CLIENT_STATE = WORK / 'client.json'
FOLLOW_STATE = WORK / 'follow.json'
FOLLOW_LOG = WORK / 'follow.log'
OBSERVER = 'ag_observer'
TARGET = 'Kirito'
POLL_SECONDS = 2
MAX_DISTANCE = 4.0
ATTACH_RETRY_SECONDS = 5
REFRESH_SECONDS = 120
DIMENSION = re.compile(r'^[a-z0-9_.-]+:[a-z0-9_./-]+$')
POSITION = re.compile(r'^\[\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)d?\s*,\s*'
    r'(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)d?\s*,\s*'
    r'(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)d?\s*\]$')


class MemorySecret:
    def __init__(self, value):
        self.value = value

    def read_text(self, **_):
        return self.value


def rcon_client():
    client = RconClient(host='127.0.0.1', port=25577, secret='unused')
    client.secret = MemorySecret(_password())
    return client


def client_process():
    try:
        state = json.loads(CLIENT_STATE.read_text(encoding='utf-8'))
        pid = state['pid']
        if type(pid) is not int or pid <= 0 or state.get('name') != OBSERVER:
            return None
        process = psutil.Process(pid)
        if not process.is_running() or process.name().lower() != 'javaw.exe':
            return None
        started = state.get('startedAt')
        if started is not None and (type(started) not in (int, float)
                or abs(process.create_time() - started) > 2):
            return None
        return process
    except (OSError, ValueError, KeyError, TypeError, psutil.Error):
        return None


def save_state(value):
    WORK.mkdir(parents=True, exist_ok=True)
    temporary = FOLLOW_STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(FOLLOW_STATE)


def log(message):
    WORK.mkdir(parents=True, exist_ok=True)
    with FOLLOW_LOG.open('a', encoding='utf-8') as stream:
        stream.write(datetime.now(timezone.utc).isoformat() + ' ' + message + '\n')


def entity_value(client, name, field):
    answer = client.cmd('data get entity ' + name + ' ' + field).strip()
    marker = name + ' has the following entity data: '
    if answer.startswith(marker):
        return answer[len(marker):]
    if answer == 'No entity was found':
        return None
    raise RuntimeError('Unexpected RCON entity response for ' + name + '/' + field)


def entity_position(client, name):
    value = entity_value(client, name, 'Pos')
    if value is None:
        return None
    match = POSITION.fullmatch(value)
    if not match:
        raise ValueError('Invalid position response for ' + name)
    position = tuple(map(float, match.groups()))
    if not all(math.isfinite(n) for n in position):
        raise ValueError('Non-finite position for ' + name)
    return position


def entity_dimension(client, name):
    value = entity_value(client, name, 'Dimension')
    if value is None:
        return None
    dimension = json.loads(value)
    if not isinstance(dimension, str) or not DIMENSION.fullmatch(dimension):
        raise ValueError('Invalid dimension response for ' + name)
    return dimension


def sample(client):
    target_pos = entity_position(client, TARGET)
    observer_pos = entity_position(client, OBSERVER)
    if target_pos is None or observer_pos is None:
        return {'observerOnline': observer_pos is not None, 'targetOnline': target_pos is not None,
                'observerSpectator': None, 'distance': None, 'dimensionMatch': None}
    spectator = entity_value(client, OBSERVER, 'playerGameType') == '3'
    dimensions_match = entity_dimension(client, TARGET) == entity_dimension(client, OBSERVER)
    return {'observerOnline': True, 'targetOnline': True,
            'observerSpectator': spectator,
            'distance': round(math.dist(target_pos, observer_pos), 3),
            'dimensionMatch': dimensions_match}


def attach(client):
    if entity_value(client, OBSERVER, 'playerGameType') != '3':
        client.cmd('gamemode spectator ' + OBSERVER)
        if entity_value(client, OBSERVER, 'playerGameType') != '3':
            raise RuntimeError('Observer spectator mode was not confirmed')
    # /spectate <same target> may report success without resetting a stale
    # camera. Clear the old target first, then bind the new one.
    client.cmd('execute as ' + OBSERVER + ' run spectate stop')
    result = client.cmd('spectate ' + TARGET + ' ' + OBSERVER).strip()
    if 'Now spectating ' + TARGET not in result:
        raise RuntimeError('Camera reattach was not confirmed: ' + result[:160])
    return result


def watch():
    process = client_process()
    if process is None:
        save_state({'active': False, 'reason': 'client_closed', 'checkedAt': time.time()})
        return 0
    client = rcon_client()
    recoveries = 0
    last_attempt = 0.0
    target_was_offline = True
    observer_was_offline = True
    errors = 0
    log('watcher started for client PID ' + str(process.pid))
    while client_process() is not None:
        now = time.time()
        try:
            observed = sample(client)
            if observed['observerOnline'] and observed['targetOnline']:
                needs_attach = (target_was_offline or observer_was_offline
                    or observed['observerSpectator'] is not True
                    or observed['dimensionMatch'] is not True
                    or observed['distance'] > MAX_DISTANCE
                    or now - last_attempt >= REFRESH_SECONDS)
                if needs_attach and now - last_attempt >= ATTACH_RETRY_SECONDS:
                    reason = ('target_returned' if target_was_offline else
                        'observer_returned' if observer_was_offline else
                        'mode_changed' if observed['observerSpectator'] is not True else
                        'dimension_changed' if observed['dimensionMatch'] is not True else
                        'drift' if observed['distance'] > MAX_DISTANCE else 'periodic_refresh')
                    before = observed['distance']
                    last_attempt = now
                    attach(client)
                    time.sleep(0.25)
                    observed = sample(client)
                    verified = (observed['observerOnline'] and observed['targetOnline']
                        and observed['observerSpectator'] is True
                        and observed['dimensionMatch'] is True
                        and observed['distance'] <= MAX_DISTANCE)
                    if verified:
                        recoveries += 1
                    log(('reattached' if verified else 'reattach_unconfirmed')
                        + ' reason=' + reason + ' distance_before=' + str(before)
                        + ' distance_after=' + str(observed['distance']))
                target_was_offline = False
                observer_was_offline = False
            elif not observed['targetOnline']:
                target_was_offline = True
            elif not observed['observerOnline']:
                observer_was_offline = True
            save_state({'active': True, 'pid': os.getpid(), 'clientPid': process.pid,
                'checkedAt': time.time(), 'target': TARGET, 'recoveries': recoveries,
                'lastAttemptAt': last_attempt, **observed})
            errors = 0
        except (OSError, ValueError, RuntimeError) as error:
            errors += 1
            log('poll error=' + type(error).__name__ + ' consecutive=' + str(errors))
            save_state({'active': True, 'pid': os.getpid(), 'clientPid': process.pid,
                'checkedAt': time.time(), 'target': TARGET, 'recoveries': recoveries,
                'lastError': type(error).__name__})
        # A server restart may outlast the scheduler's finite crash retries.
        # Keep watching the client and reconnect when RCON becomes available.
        time.sleep(POLL_SECONDS if errors == 0 else min(30, 2 ** min(errors, 5)))
    save_state({'active': False, 'reason': 'client_closed', 'checkedAt': time.time(),
                'recoveries': recoveries})
    log('watcher stopped because client closed')
    return 0


def check():
    process = client_process()
    if process is None:
        print(json.dumps({'ok': True, 'active': False, 'reason': 'client_closed'}))
        return 0
    try:
        state = json.loads(FOLLOW_STATE.read_text(encoding='utf-8'))
        age = time.time() - state.get('checkedAt', 0)
        observed = sample(rcon_client())
        ok = (state.get('active') is True and state.get('clientPid') == process.pid
            and 0 <= age <= 10 and observed['observerOnline'] is True
            and (observed['targetOnline'] is False or (observed['dimensionMatch'] is True
                and observed['observerSpectator'] is True
                and observed['distance'] <= MAX_DISTANCE)))
        print(json.dumps({'ok': ok, 'active': state.get('active'),
            'heartbeatAgeSeconds': round(age, 2), 'recoveries': state.get('recoveries'),
            **observed}))
        return 0 if ok else 1
    except (OSError, ValueError, TypeError) as error:
        print(json.dumps({'ok': False, 'error': type(error).__name__}))
        return 1


if __name__ == '__main__':
    try:
        action = sys.argv[1] if len(sys.argv) > 1 else 'check'
        sys.exit(watch() if action == 'watch' else check() if action == 'check' else 2)
    except Exception as error:
        log('watcher fatal=' + type(error).__name__)
        raise
