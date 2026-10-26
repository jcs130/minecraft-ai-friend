"""Exact local filesystem paths without depending on a host EXE's MAX_PATH flag."""

import os
from pathlib import Path


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
