"""Exact local filesystem paths without depending on a host EXE's MAX_PATH flag."""

import os
import time
from pathlib import Path


def replace_prepared(temporary, destination, *, clock=time, platform=None, capture=None):
    """Retry only a prepared atomic rename briefly denied by a Windows reader.

    No serialization, dispatch, receipt callback or freshness update is repeated.
    A persistent error retains its first traceback and leaves the old file intact.
    """
    platform = os.name if platform is None else platform
    deadline = clock.monotonic() + .250
    failures, first_trace = [], None
    for delay in (0, .005, .010, .020, .040, .080, .080):
        if delay:
            remaining = deadline - clock.monotonic()
            if remaining <= 0:
                break
            clock.sleep(min(delay, remaining))
            if clock.monotonic() >= deadline:
                break
        try:
            temporary.replace(destination)
            return
        except OSError as error:
            candidate = platform == "nt" and getattr(error, "winerror", None) in {5, 32}
            if not failures and not candidate:
                raise
            if not failures:
                first_trace = error.__traceback__
            failures.append(error)
            if not candidate:
                break
    if capture is not None:
        for error in failures:
            capture(error)
    raise failures[0].with_traceback(first_trace)


def verification_path(path: Path) -> Path:
    """Keep file identity and use Windows' extended path form for verification."""
    if os.name != "nt":
        return path
    value = os.path.abspath(path)
    if value.startswith("\\\\?\\"):
        return Path(value)
    if value.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + value[2:])
    return Path("\\\\?\\" + value)
