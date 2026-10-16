"""Read-only validation of the immutable, explicitly selected offline runtime."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import stat
import sys
from pathlib import Path

SCHEMA = "agent-mc-runtime-bundle/v1"
MANIFEST = "runtime-manifest.json"
INVENTORY = "runtime-files.json"
MAX_JSON = 32 * 1024 * 1024
MAX_FILES = 100_000
SHA = re.compile(r"[a-f0-9]{64}\Z")
NODE_VERSION = "22.22.1"
REGISTRY_SHA256 = "55893d269459e1e05387903c77b2db877d7cece875ed31a5a6a2f965822ea546"


class BundleError(ValueError):
    """A selected bundle cannot safely supply runtime defaults."""


def fail(code: str) -> None:
    raise BundleError(f"runtime_bundle_{code}: unpack the complete matching offline package and run prepare.cmd again")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_json(path: Path, limit: int = MAX_JSON) -> dict:
    try:
        with path.open("rb") as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            fail("metadata_too_large")
        value = json.loads(data)
        if not isinstance(value, dict):
            fail("metadata_invalid")
        return value
    except (OSError, ValueError, RecursionError) as error:
        if isinstance(error, BundleError):
            raise
        fail("metadata_unavailable")


def relative_path(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 1024:
        fail("path_invalid")
    for part in value.split("/"):
        if (not part or part in {".", ".."} or part[-1:] in {".", " "}
                or re.search(r'[\\:*?"<>|\x00-\x1f]', part)
                or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?", part)):
            fail("path_invalid")
    return value


def checked_path(root: Path, name: str, checked: set[Path] | None = None) -> Path:
    result = root
    for part in relative_path(name).split("/"):
        result = result / part
        if checked is not None and result in checked:
            continue
        try:
            info = result.lstat()
        except OSError:
            fail("input_missing")
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            fail("link_forbidden")
        if checked is not None:
            checked.add(result)
    return result


def source_pin() -> dict:
    return read_json(Path(__file__).parent.parent / "core_distribution/source.json")


def verify_bundle(root: Path, *, expected_manifest_sha256: str | None = None, full: bool = True) -> dict:
    """Check bounded metadata; full=True additionally verifies every payload byte."""
    root = Path(root).absolute()
    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        fail("platform_unsupported_windows_x64_required")
    if not root.is_dir():
        fail("root_missing")
    if root.is_symlink() or getattr(root.lstat(), "st_file_attributes", 0) & 0x400:
        fail("link_forbidden")
    manifest_path = checked_path(root, MANIFEST)
    manifest = read_json(manifest_path, 65536)
    manifest_hash = digest(manifest_path)
    if expected_manifest_sha256 is not None and manifest_hash != expected_manifest_sha256:
        fail("manifest_hash_mismatch")
    if (manifest.get("schema") != SCHEMA or manifest.get("platform") != "win32"
            or manifest.get("architecture") != "x64" or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,79}", str(manifest.get("id", "")))):
        fail("manifest_incompatible")
    pin = source_pin()
    checked: set[Path] = set()
    try:
        node, core, viewer, resources = (manifest[k] for k in ("node", "core", "viewer", "resources"))
        browser = manifest["browser"]
        if (node["version"] != NODE_VERSION or core["version"] != pin["version"]
                or core["sourceRevision"] != pin["source_revision"]
                or viewer["sourceRevision"] != pin["external_viewer"]["source_revision"]
                or viewer["sourceSha256"] != pin["external_viewer"]["source_receipt"]["sourceSha256"]
                or resources["minecraftVersion"] != "1.21.1"
                or node["sha256"] != pin["offline_node"]["executable_sha256"]
                or browser["sha256"] != pin["offline_browser"]["executable_sha256"]
                or browser["revision"] != pin["offline_browser"]["revision"]
                or browser["version"] != pin["offline_browser"]["browserVersion"]
                or browser["playwrightVersion"] != "1.63.0"
                or resources["registrySha256"] != REGISTRY_SHA256):
            fail("source_mismatch")
        inventory = manifest["inventory"]
        if (inventory["path"] != INVENTORY or not SHA.fullmatch(str(inventory["sha256"]))
                or type(inventory["files"]) is not int or not 1 <= inventory["files"] <= MAX_FILES):
            fail("inventory_invalid")
        required = [node["path"], browser["path"], browser["license"], core["directory"] + "/package.json", viewer["directory"] + "/package.json",
                    viewer["directory"] + "/tools/native-world-preview-host.mjs", resources["catalog"], resources["appearanceCatalog"],
                    resources["assetDirectory"] + "/registry/block-states.jsonl", resources["assetDirectory"] + "/public/sounds/manifest.json",
                    resources["assetDirectory"] + "/native-assets.json",
                    "prepare.cmd", "prepare.mjs", "source.json", *manifest["licenses"]]
        if not isinstance(manifest["licenses"], list) or not 1 <= len(manifest["licenses"]) <= 100:
            fail("licenses_invalid")
        for name in [INVENTORY, *required]:
            if not checked_path(root, name, checked).is_file():
                fail("required_input_missing")
        if not full:
            return {**manifest, "manifestSha256": manifest_hash, "integrityVerified": False}
        if digest(root / INVENTORY) != inventory["sha256"]:
            fail("inventory_hash_mismatch")
        files = read_json(root / INVENTORY)
        if not isinstance(files, dict) or not 1 <= len(files) <= MAX_FILES:
            fail("inventory_invalid")
        if len(files) != inventory["files"]:
            fail("inventory_invalid")
        folded, total = set(), 0
        for name, row in files.items():
            relative_path(name)
            if name.casefold() in folded or name.casefold() in {MANIFEST, INVENTORY}:
                fail("path_collision")
            folded.add(name.casefold())
            if not isinstance(row, dict) or type(row.get("bytes")) is not int or not 0 <= row["bytes"] <= 512 * 1024 * 1024 or not SHA.fullmatch(str(row.get("sha256", ""))):
                fail("inventory_invalid")
            total += row["bytes"]
            if total > 8 * 1024**3:
                fail("inventory_too_large")
            target = checked_path(root, name, checked)
            if not target.is_file() or target.stat().st_size != row["bytes"] or digest(target) != row["sha256"]:
                fail("file_hash_mismatch")
        if (not manifest["licenses"] or any(name not in files for name in required)
                or files[node["path"]]["sha256"] != node["sha256"] or files[browser["path"]]["sha256"] != browser["sha256"]):
            fail("required_input_missing")
        # Reject unlisted executable/module additions and directory aliases too.
        seen = set()
        for directory_name, dirs, names in os.walk(root):
            directory = Path(directory_name)
            for name in dirs + names:
                relative = (directory / name).relative_to(root).as_posix()
                checked_path(root, relative, checked)
                if relative.casefold() in seen:
                    fail("path_collision")
                seen.add(relative.casefold())
                if len(seen) > MAX_FILES * 3:
                    fail("inventory_too_large")
                if name in names and relative not in {MANIFEST, INVENTORY} and relative not in files:
                    fail("unlisted_file")
        catalog = read_json(root / resources["catalog"], 65536)
        expected = {"schemaVersion": 1, "packs": [{"id": "vanilla-1.21.1", "minecraftVersion": "1.21.1", "registry": "vanilla",
                    "registrySha256": resources["registrySha256"], "assetDirectory": resources["assetDirectory"]}]}
        if catalog != expected or digest(root / resources["assetDirectory"] / "registry/block-states.jsonl") != resources["registrySha256"]:
            fail("catalog_mismatch")
        # An omitted resource is still missing even if someone rewrites the file inventory.
        for suffix, expected_hash in pin["offline_resources"].items():
            if files.get(suffix, {}).get("sha256") != expected_hash:
                fail("resource_source_mismatch")
        for prefix, table, key in [
            (resources["assetDirectory"], resources["assetDirectory"] + "/native-assets.json", "assets"),
            (resources["assetDirectory"] + "/public/sounds", resources["assetDirectory"] + "/public/sounds/manifest.json", "fileMetadata"),
            (str(Path(resources["appearanceCatalog"]).parent).replace("\\", "/"), resources["appearanceCatalog"], "assets"),
        ]:
            rows = read_json(root / table)[key]
            if not isinstance(rows, dict) or len(rows) > MAX_FILES:
                fail("resource_inventory_invalid")
            for name, row in rows.items():
                item = files.get(prefix + "/" + relative_path(name), {})
                if item.get("sha256") != row["sha256"] or item.get("bytes") != row["bytes"]:
                    fail("resource_inventory_incomplete")
        from ..core_distribution.install import verify_runtime
        verify_runtime(root / core["directory"])
    except (KeyError, TypeError, OSError) as error:
        raise BundleError("runtime_bundle_manifest_invalid: unpack the complete matching offline package") from error
    return {**manifest, "manifestSha256": manifest_hash, "integrityVerified": True}
