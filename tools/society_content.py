"""Pinned server-only RPG content. Install only into a stopped, explicitly named world.

Never resets terrain or overwrites existing economy settings/player progress.
Third-party archives stay in runtime/downloads, outside Git.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import urllib.request

from society_lab import DEFAULT_ROOT, REPO, safe_root, sha256

LOCK = REPO / "manifests/society-rpg-content.lock.json"
PACK = REPO / "world/society-datapacks/maw_life"


def artifacts():
    return json.loads(LOCK.read_text(encoding="utf-8"))["artifacts"]


def verify(server: Path, world: str) -> dict:
    if Path(world).name != world or world in (".", ".."):
        raise ValueError("world must be one directory name")
    for row in artifacts():
        p = server / ("mods" if row["kind"] == "mod" else world + "/datapacks") / row["name"]
        if not p.is_file() or sha256(p) != row["sha256"]:
            raise ValueError(f"Pinned RPG artifact differs: {p}")
    target = server / world / "datapacks/maw_life"
    expected = {p.relative_to(PACK): sha256(p) for p in PACK.rglob("*") if p.is_file()}
    actual = {p.relative_to(target): sha256(p) for p in target.rglob("*") if p.is_file()}
    if not expected or actual != expected:
        raise ValueError(f"Owned RPG datapack differs: {target}")
    # Economy settings are operator-editable; do not hash-lock balances or price edits.
    for name in ("config/economycraft/config.json", "config/economycraft/prices.json", "config/moogs_paths.json"):
        json.loads((server / name).read_text(encoding="utf-8"))
    return {"ok": True, "thirdPartyArtifacts": 7, "quests": len(json.loads((REPO / "config/maw-life-content.json").read_text(encoding="utf-8"))["quests"]), "world": world}


def install(root: Path, server: Path, world: str, cache: Path) -> dict:
    from build_society_bridge import ensure_server_stopped
    if root not in server.resolve().parents or root not in cache.resolve().parents:
        raise ValueError("Server and artifact cache must stay inside runtime root")
    if Path(world).name != world or world in (".", ".."):
        raise ValueError("world must be one directory name")
    ensure_server_stopped(server)
    cache.mkdir(parents=True, exist_ok=True)
    for row in artifacts():
        downloaded = cache / row["name"]
        if not downloaded.is_file():
            req = urllib.request.Request(row["url"], headers={"User-Agent": "MyAgentWorld-content/1"})
            with urllib.request.urlopen(req, timeout=90) as response:
                raw = response.read(64 * 1024 * 1024 + 1)
            if len(raw) > 64 * 1024 * 1024:
                raise ValueError("Artifact exceeds 64 MiB")
            downloaded.write_bytes(raw)
        if sha256(downloaded) != row["sha256"]:
            raise ValueError(f"Artifact checksum mismatch: {downloaded}")
        target = server / ("mods" if row["kind"] == "mod" else world + "/datapacks") / row["name"]
        if target.exists() and sha256(target) != row["sha256"]:
            raise ValueError(f"Refusing modified artifact overwrite: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        ensure_server_stopped(server)
        shutil.copyfile(downloaded, target)
    target = server / world / "datapacks/maw_life"
    for source in PACK.rglob("*"):
        if not source.is_file():
            continue
        dest = target / source.relative_to(PACK)
        if dest.exists() and sha256(dest) != sha256(source):
            raise ValueError(f"Refusing modified owned datapack overwrite: {dest}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
    for source, name in [(REPO / "config/maw-economycraft-config.json", "config/economycraft/config.json"),
                         (REPO / "config/maw-economycraft-prices.json", "config/economycraft/prices.json"),
                         (REPO / "config/maw-moogs-paths.json", "config/moogs_paths.json")]:
        dest = server / name
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, dest)
    return verify(server, world)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("install", "verify"))
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--server-dir")
    parser.add_argument("--world", required=True)
    parser.add_argument("--cache")
    args = parser.parse_args()
    root = safe_root(args.root)
    server = Path(args.server_dir).resolve() if args.server_dir else root / "server"
    if root not in server.parents:
        raise ValueError("Server must stay inside runtime root")
    result = verify(server, args.world) if args.mode == "verify" else install(root, server, args.world, Path(args.cache).resolve() if args.cache else root / "downloads")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
