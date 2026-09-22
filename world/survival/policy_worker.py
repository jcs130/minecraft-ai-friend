"""A single inference slot; no gateway, lease, state files or world effects."""
import copy
import threading
import time


class PolicyWorker:
    def __init__(self, factory):
        self.factory = factory
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._request = None
        self._result = None
        self._busy = False
        self._closed = False
        self._serial = 0
        self._thread = None

    def submit(self, *args):
        with self._lock:
            if self._busy or self._closed:
                return None
            self._serial += 1
            token = self._serial
            self._request = (token, copy.deepcopy(args))
            self._result = None
            self._busy = True
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name='survivor-policy', daemon=True)
                self._thread.start()
            self._wake.set()
            return token

    def poll(self, token):
        with self._lock:
            if self._result and self._result[0] == token:
                return copy.deepcopy(self._result[1])
        return None

    def _run(self):
        policy = None
        try:
            while True:
                self._wake.wait()
                with self._lock:
                    if self._closed:
                        return
                    token, args = self._request
                    self._request = None
                    self._wake.clear()
                started = time.monotonic()
                try:
                    if policy is None:
                        policy = self.factory()
                    result = policy.choose(*args)
                except Exception as error:
                    result = {'ok': False, 'code': 'policy_unavailable', 'errorType': type(error).__name__}
                result['workerMs'] = round((time.monotonic() - started) * 1000, 2)
                with self._lock:
                    self._result = (token, result)
                    self._busy = False
        finally:
            if policy is not None:
                policy.close()

    def close(self):
        with self._lock:
            self._closed = True
            self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=3)


def same_body(before, after, now):
    """Reject changed premises; the main thread alone can consume a classification."""
    stamp = after.get('observedAt')
    if (after.get('ok') is not True or type(stamp) not in (int, float)
            or not 0 <= now * 1000 - stamp <= 5000):
        return False
    for key in ('bodyUuid', 'dimension', 'navigationEpoch', 'gameMode', 'hp', 'hunger',
                'air', 'inWater', 'inLava', 'counts', 'equipment'):
        if before.get(key) != after.get(key):
            return False
    if after.get('task', {}).get('busy') is not False:
        return False
    if before.get('task') != after.get('task'):
        return False
    try:
        distance = sum((before['position'][k] - after['position'][k]) ** 2 for k in ('x', 'y', 'z'))
        return distance <= .25  # Tiny passive pushes are not a new route decision.
    except (KeyError, TypeError):
        return False
