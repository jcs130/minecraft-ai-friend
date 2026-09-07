"""Cross-process lock for one inventory publication/health verification window.

The lock file is persistent. Its existence does not mean busy: ownership belongs
to the OS, and is released on close or process death. Never delete this file.
"""
from contextlib import contextmanager
import errno
import os
from pathlib import Path
import time


@contextmanager
def inventory_lock(root, wait_seconds=0):
    if isinstance(wait_seconds, bool) or not 0 <= wait_seconds <= 100:
        raise ValueError('Lock wait must be between zero and 100 seconds')
    path = Path(root) / 'runtime/operations-inventory.lock'
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open('a+b')
    acquired = False
    try:
        if os.name == 'nt':
            import msvcrt
            # Windows byte-range locks may extend past EOF; writing into an
            # already-held byte would itself fail, so no initialization write.
            def lock():
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            def unlock():
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            def lock():
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            def unlock():
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                lock()
                acquired = True
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                    raise
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                time.sleep(min(0.1, remaining))
        yield acquired
    finally:
        try:
            if acquired:
                unlock()
        finally:
            handle.close()
