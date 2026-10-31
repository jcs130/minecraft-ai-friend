"""Verified two-copy cold snapshot of the owned lab, without vendor binaries.

Stop the lab first. Never archive a running world or replace an old snapshot.
Restore into a separate instance, prepare the same lock, then verify it before
pointing any player at the restored copy. Management credentials are excluded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import socket
import time
import zipfile

from manage import settings, validate_server
from prepare import HERE, digest


def assert_stopped(config):
    state = json.loads((Path(config["cache"]) / "server-process.local.json").read_text())
    if state.get("status") != "stopped" or state.get("exitCode") != 0:
        raise ValueError("A verified clean server shutdown is required")
    for port in (config["port"], config["controlPort"]):
        with socket.socket() as sock:
            sock.settimeout(1)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise ValueError("Lab endpoint still listens; refuse a live snapshot")


def selected_files(root):
    root = Path(root).resolve()
    files = {}
    for folder in ("world", "config", "easy_npc"):
        for path in (root / folder).rglob("*"):
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError("Snapshot entry escapes instance: " + str(path))
            if path.is_file():
                files["server/" + path.relative_to(root).as_posix()] = path
    for name in ("server.properties", "eula.txt", "fabric263-lab.json", "ops.json",
                 "whitelist.json", "banned-players.json", "banned-ips.json", "usercache.json"):
        path = root / name
        if path.exists():
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError("Snapshot file escapes instance")
            files["server/" + name] = path
    if not any(name.startswith("server/world/") for name in files):
        raise ValueError("No world files to snapshot")
    return files


def create_snapshot(files, primary, secondary):
    primary, secondary = Path(primary).resolve(), Path(secondary).resolve()
    if primary == secondary or primary.exists() or secondary.exists():
        raise ValueError("Two distinct new snapshot paths are required")
    manifest = {"schemaVersion": 1, "observedAt": time.time(), "cold": True, "files": {}}
    for name, path in sorted(files.items()):
        manifest["files"][name] = {"sha256": digest(path), "bytes": path.stat().st_size}
    primary.parent.mkdir(parents=True, exist_ok=True)
    secondary.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(primary, "x", zipfile.ZIP_DEFLATED) as z:
        for name, path in sorted(files.items()):
            z.write(path, name)
        z.writestr("snapshot-manifest.json", json.dumps(manifest, indent=2))
    with zipfile.ZipFile(primary) as z:
        if z.testzip() is not None:
            raise ValueError("Snapshot ZIP integrity failed; keep it for inspection")
        for name, entry in manifest["files"].items():
            h, count = hashlib.sha256(), 0
            with z.open(name) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(block)
                    count += len(block)
            if h.hexdigest() != entry["sha256"] or count != entry["bytes"]:
                raise ValueError("Snapshot differs from source manifest: " + name)
    with primary.open("rb") as source, secondary.open("xb") as target:
        shutil.copyfileobj(source, target, length=1024 * 1024)
    checksum = digest(primary)
    if digest(secondary) != checksum:
        raise ValueError("Secondary copy differs; keep both for inspection")
    return {"primary": str(primary), "secondary": str(secondary), "sha256": checksum,
            "files": len(files), "bytes": primary.stat().st_size, "cold": True,
            "sourceBytes": sum(entry["bytes"] for entry in manifest["files"].values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--primary", type=Path, required=True)
    parser.add_argument("--secondary", type=Path, required=True)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", args.label) or args.label in (".", ".."):
        parser.error("label must be a plain ASCII snapshot name")
    config = settings()
    validate_server(config)
    assert_stopped(config)
    files = selected_files(config["server"])
    for name in ("pack.spec.json", "pack.lock.json", "starter-quests.json", "compat-src/VerifiedCraftMixin.java"):
        files["deployment/" + name] = HERE / name
    print(json.dumps(create_snapshot(files, args.primary / (args.label + ".zip"), args.secondary / (args.label + ".zip"))))


if __name__ == "__main__":
    main()
