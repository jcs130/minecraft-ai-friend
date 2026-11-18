"""Best-effort atomic publication of a diagnostic heartbeat."""

import json
import logging
import os
from pathlib import Path
import time


_LOG = logging.getLogger(__name__)
_WINDOWS_SHARING_ERRORS = {5, 32, 33}
_RETRY_DELAYS = (0.025, 0.05, 0.10)


class StatusFile:
    """A reader holding an old snapshot must not stop the managed process."""

    def __init__(self, path: Path):
        self.path = path
        self.temp = path.with_name(path.name + ".tmp")
        self.next_warning = 0.0

    def publish(self, value: dict) -> bool:
        try:
            with self.temp.open("w", encoding="utf8") as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            for delay in _RETRY_DELAYS:
                try:
                    os.replace(self.temp, self.path)
                    return True
                except PermissionError as error:
                    if getattr(error, "winerror", None) not in _WINDOWS_SHARING_ERRORS:
                        raise
                    time.sleep(delay)
            os.replace(self.temp, self.path)
            return True
        except PermissionError as error:
            code = getattr(error, "winerror", None)
            if code not in _WINDOWS_SHARING_ERRORS:
                raise
            now = time.monotonic()
            if now >= self.next_warning:
                _LOG.warning("Status update deferred for %s (Windows error %s)", self.path.name, code)
                self.next_warning = now + 60
            return False
