"""Process-scoped account lease, automatically released after a crash."""

import errno
import os
from contextlib import contextmanager
from pathlib import Path


def session_is_owned(directory: Path):
    """Probe an existing account lease without creating state or claiming a body.

    Contention proves a held lease, not the freshness of its owner's snapshot.
    Callers must check both; a PID or an old status file alone is insufficient.
    """
    try:
        handle = (directory / "owner.lock").open("r+b")
    except FileNotFoundError:
        return False
    with handle:
        if os.fstat(handle.fileno()).st_size == 0:
            return False
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno in {errno.EACCES, errno.EAGAIN}:
                return True
            raise
        if os.name == "nt":
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return False


@contextmanager
def session_lease(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    # Never unlink this file: waiters must lock the same inode on POSIX.
    with (directory / "owner.lock").open("a+b") as handle:
        if os.fstat(handle.fileno()).st_size == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError("session_in_use: this server/account already has a controller in this data directory") from None
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
