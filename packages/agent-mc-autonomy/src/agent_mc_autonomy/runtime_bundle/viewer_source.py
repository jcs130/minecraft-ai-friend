"""Bind exact public viewer source members independently of a bundle inventory."""

from __future__ import annotations

import os
from pathlib import Path

from .manifest import checked_path, digest, fail, read_json, relative_path


def pinned_viewer_files(pin: dict) -> dict:
    record = pin["external_viewer"]["source_inventory"]
    source = Path(__file__).parent.parent / "core_distribution/viewer-source.json"
    if record["file"] != "viewer-source.json" or digest(source) != record["sha256"]:
        fail("viewer_source_pin_mismatch")
    value = read_json(source, 128 * 1024)
    if (value["schema"] != "agent-mc-viewer-source/v1" or value["sourceRevision"] != pin["external_viewer"]["source_revision"]
            or not 1 <= len(value["files"]) == record["files"] <= 2000):
        fail("viewer_source_pin_mismatch")
    for name in value["files"]:
        relative_path(name)
    return value["files"]


def source_projection(files: dict, prefix: str = "") -> dict:
    """All viewer-root files except installed node_modules trees; assets live elsewhere."""
    return {name[len(prefix):]: row for name, row in files.items()
            if name.startswith(prefix) and "node_modules" not in name[len(prefix):].split("/")[:-1]}


def verify_viewer_input(viewer_root: Path, pin: dict) -> None:
    """Distributor preflight, before any destination creation or large-file copy."""
    expected, actual = pinned_viewer_files(pin), {}
    root = Path(viewer_root).absolute()
    checked = set()
    try:
        checked_path(root.parent, root.name, checked)
        for directory, dirs, names in os.walk(root):
            dirs[:] = [name for name in dirs if name != "node_modules"]
            for name in dirs + names:
                relative = (Path(directory) / name).relative_to(root).as_posix()
                file = checked_path(root, relative, checked)
                if name in names:
                    if relative not in expected:
                        fail("viewer_source_mismatch")
                    actual[relative] = {"bytes": file.stat().st_size, "sha256": digest(file)}
        if actual != expected:
            fail("viewer_source_mismatch")
    except OSError:
        fail("viewer_source_unavailable")


def verify_viewer_inventory(files: dict, viewer_directory: str, pin: dict) -> None:
    prefix = Path(viewer_directory).parent.as_posix() + "/"
    if source_projection(files, prefix) != pinned_viewer_files(pin):
        fail("viewer_source_mismatch")
