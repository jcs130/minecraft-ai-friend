"""Install the verified client explicitly; importing this module does no I/O."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent
SOURCE = json.loads((SOURCE_DIR / "source.json").read_text(encoding="utf-8"))


def runtime_entry(directory: Path) -> Path:
    return directory / "node_modules" / "agent-mc-world" / "bin" / "minecraft-agent-mcp.mjs"


def verify_runtime(directory: Path) -> Path:
    entry = runtime_entry(directory)
    manifest = entry.parent.parent / "package.json"
    if not entry.is_file() or not manifest.is_file():
        raise ValueError("backend_missing: install the pinned backend first (see README).")
    package = json.loads(manifest.read_text(encoding="utf-8"))
    if (package.get("name"), package.get("version")) != (SOURCE["name"], SOURCE["version"]):
        raise ValueError("backend_version_mismatch: the installed client differs from backend/source.json.")
    build = package.get("nekoBuild", {})
    if (build.get("sourceRevision") != SOURCE["source_revision"] or build.get("profile") != "headless"
            or build.get("patches") != SOURCE["patches"]):
        raise ValueError("backend_build_mismatch: install the documented independent headless build.")
    root = manifest.parent.resolve()
    receipt = json.loads((root / "dist/neko-headless.json").read_text(encoding="utf-8"))
    if (receipt.get("sourceRevision") != SOURCE["source_revision"] or receipt.get("bundledViewer") is not False
            or receipt.get("patches") != SOURCE["patches"]):
        raise ValueError("backend_build_mismatch: incorrect source or viewer profile.")
    for item in receipt["files"]:
        target = (root / item["file"]).resolve()
        if not target.is_relative_to(root) or not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("backend_build_mismatch: a compiled file differs from its build receipt.")
    return entry


def verify_archive(path: Path) -> None:
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != SOURCE["sha256"]:
        raise ValueError("backend_archive_hash_mismatch: refusing to install unverified bytes.")


def prepare(directory: Path, archive: Path | None = None) -> Path:
    """Use a dedicated destination. npm lifecycle scripts and Cortico are unnecessary."""
    directory = directory.expanduser().resolve()
    if directory == SOURCE_DIR or directory in SOURCE_DIR.parents:
        raise ValueError("Choose a separate backend destination, not the plugin source directory.")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    node = shutil.which("node")
    if not npm or not node:
        raise ValueError("Node.js 22+ and npm must be installed first.")
    version = subprocess.check_output([node, "--version"], text=True, timeout=10).strip()
    if int(version.removeprefix("v").split(".")[0]) < 22:
        raise ValueError("The pinned client requires Node.js 22+.")
    # Avoid modifying an unrelated npm project or an existing runtime version.
    manifest = directory / "package.json"
    expected = (SOURCE_DIR / "package.json").read_bytes()
    if manifest.exists() and manifest.read_bytes() != expected:
        raise ValueError("Destination contains another npm project; choose an empty directory.")
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / SOURCE["archive"]
    if archive is not None:
        verify_archive(archive)
        if archive.resolve() != target:
            shutil.copyfile(archive, target)
    elif not target.exists():
        raise ValueError("backend_archive_required: build the pinned source and supply --archive; no upstream release is assumed.")
    verify_archive(target)
    for filename in ("package.json", "package-lock.json"):
        shutil.copyfile(SOURCE_DIR / filename, directory / filename)
    subprocess.run(
        [npm, "ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"],
        cwd=directory, check=True, timeout=600,
    )
    if (directory / "node_modules" / "cortico").exists():
        raise ValueError("Unexpected Cortico runtime dependency.")
    return verify_runtime(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--archive", type=Path, help="Hash-verified headless archive produced by backend/build.py")
    arguments = parser.parse_args()
    print(prepare(arguments.destination, arguments.archive))


if __name__ == "__main__":
    main()
