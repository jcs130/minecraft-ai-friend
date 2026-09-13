"""Restore the fixed, historical viewer baseline from local Git objects only.

Default --check is read-only. --restore creates missing files and refuses the
entire operation if an existing file differs. This restores the pre-patch
baseline, not generated mod assets or local verification reports. Outputs must
be vendor/modern-viewer or an isolated directory below runtime/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "7e2b4e19f07cacab903f88e5b785487b9deae225"
PREFIX = "packaging/docker/modern-viewer/"
MANIFEST = "manifests/modern-viewer-source.json"
DEFAULT_OUTPUT = "vendor/modern-viewer"
MAX_ASSET_BYTES = 32 * 1024 * 1024
ASSETS = (
    "character-assets/characters/kirito-black-swordsman-statue.bak.glb",
    "character-assets/characters/kirito-black-swordsman.glb",
    "character-assets/characters/naruto-uzumaki-shippuden.glb",
    "character-assets/characters/sasuke-uchiha.glb",
    "character-assets/skins/kirito.png",
    "character-assets/skins/naruto.png",
    "mesher.js", "mesherWasm.js", "minecraft-renderer.js",
    "minecraft-renderer.js.meta.json", "modern-viewer.js",
    "npc-portraits/anime-professions-b-v2.png",
    "npc-portraits/core-trio-anime-v2.png",
    "npc-portraits/guild-receptionist-lan-fullbody-v3.png",
    "npc-portraits/guofeng-a.png",
    "npc-portraits/named-travellers-fullbody-v3.png",
    "npc-portraits/professions-a.png",
    "npc-portraits/professions-b.png",
    "npc-portraits/village-special-cast-anime-v2.png",
    "threeWorker.js", "viewer.css", "wasm_mesher_bg.wasm",
)
EXCLUDED_GENERATED = {"mod-assets/mod-blocks-mcdata.json", "mod-assets/mod-pack.json"}


class RestoreError(ValueError):
    pass


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def reject_links(path: Path) -> None:
    for node in (path, *path.parents):
        if node.is_symlink() or getattr(node, "is_junction", lambda: False)():
            raise RestoreError("Linked output paths are not allowed")


def output_path(root: Path, value: str | Path) -> Path:
    root = root.resolve()
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    reject_links(path)
    path = path.resolve()
    if path != root / DEFAULT_OUTPUT and not (
            path.is_relative_to(root / "runtime") and path != root / "runtime"):
        raise RestoreError("Output must be vendor/modern-viewer or below project runtime/")
    if path.exists() and not path.is_dir():
        raise RestoreError("Output is not a directory")
    return path


def manifest_rows(value: dict) -> dict[str, dict]:
    if not isinstance(value, dict) or value.get("schema") != 1 or not isinstance(value.get("files"), list):
        raise RestoreError("Unexpected viewer provenance schema")
    rows = {}
    for row in value["files"]:
        if not isinstance(row, dict):
            raise RestoreError("Invalid viewer provenance row")
        name = row.get("path")
        if not isinstance(name, str) or name in rows or name not in (*ASSETS, *EXCLUDED_GENERATED):
            raise RestoreError("Unknown or duplicate asset in viewer provenance")
        if (type(row.get("bytes")) is not int or not 0 < row["bytes"] <= MAX_ASSET_BYTES
                or not isinstance(row.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])):
            raise RestoreError("Invalid viewer provenance size or SHA256")
        rows[name] = row
    if not set(ASSETS).issubset(rows):
        raise RestoreError("Viewer provenance is missing a required baseline asset")
    return {name: rows[name] for name in ASSETS}


def git_blob(root: Path, name: str) -> bytes:
    # Neither the caller nor the manifest may select another ref or source path.
    if name not in ASSETS:
        raise RestoreError("Asset outside fixed baseline allowlist")
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "cat-file", "blob", f"{COMMIT}:{PREFIX}{name}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RestoreError("Local Git object read failed; no network fetch was attempted") from None
    if result.returncode:
        raise RestoreError("Fixed baseline Git object is unavailable; fetch the preserved history separately")
    return result.stdout


def prepare(root: Path, output: str | Path, manifest: dict, read_blob=git_blob):
    destination = output_path(root, output)
    rows = manifest_rows(manifest)
    payloads = {}
    # Validate EVERY source before even creating an output directory.
    for name, row in rows.items():
        raw = read_blob(root, name)
        if not isinstance(raw, bytes) or len(raw) != row["bytes"] or sha(raw) != row["sha256"]:
            raise RestoreError("Baseline SHA256 or size mismatch: " + name)
        payloads[name] = raw
    missing, changed = [], []
    for name, raw in payloads.items():
        target = destination / name
        reject_links(target)
        for parent in target.parents:
            if parent.exists() and not parent.is_dir():
                raise RestoreError("Output parent is not a directory")
            if parent == destination:
                break
        if not target.exists():
            missing.append(name)
        elif not target.is_file() or target.read_bytes() != raw:
            changed.append(name)
    return destination, payloads, {
        "schema": 1, "sourceCommit": COMMIT, "sourcePrefix": PREFIX,
        "output": destination.relative_to(root.resolve()).as_posix(),
        "sourceValidated": True, "assetCount": len(ASSETS),
        "unchangedCount": len(ASSETS) - len(missing) - len(changed),
        "missing": missing, "changed": changed, "restored": [],
    }


def restore(destination: Path, payloads: dict[str, bytes], report: dict) -> dict:
    if report["changed"]:
        return {**report, "ok": False, "code": "existing_files_differ"}
    for name in report["missing"]:
        target = destination / name
        reject_links(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        reject_links(target)
        try:
            # Exclusive create also refuses a file introduced after preflight.
            with target.open("xb") as handle:
                handle.write(payloads[name])
            report["restored"].append(name)
        except FileExistsError:
            if target.is_file() and target.read_bytes() == payloads[name]:
                continue
            raise RestoreError("Output changed after preflight: " + name) from None
        if target.read_bytes() != payloads[name]:
            raise RestoreError("New output failed byte verification: " + name)
    return {**report, "ok": True, "code": "baseline_restored"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="Read-only baseline check (default)")
    modes.add_argument("--restore", action="store_true", help="Create only missing, verified baseline files")
    parser.add_argument("--output", default=DEFAULT_OUTPUT,
                        help="Default vendor/modern-viewer; isolated checks may use runtime/<name>")
    args = parser.parse_args(argv)
    report = {"schema": 1, "sourceCommit": COMMIT, "mode": "restore" if args.restore else "check"}
    try:
        manifest = json.loads((ROOT / MANIFEST).read_text(encoding="utf-8-sig"))
        destination, payloads, checked = prepare(ROOT, args.output, manifest)
        report.update(checked)
        if args.restore:
            report.update(restore(destination, payloads, report))
        else:
            report.update(ok=not report["missing"] and not report["changed"], code="baseline_check")
    except (RestoreError, OSError, ValueError) as error:
        report.update(ok=False, code="restore_failed", error=str(error) if isinstance(error, RestoreError)
                      else type(error).__name__)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
