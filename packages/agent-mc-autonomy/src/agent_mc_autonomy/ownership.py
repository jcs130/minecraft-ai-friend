"""Process-scoped account lease, automatically released after a crash."""

import os
from contextlib import contextmanager
from pathlib import Path


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
