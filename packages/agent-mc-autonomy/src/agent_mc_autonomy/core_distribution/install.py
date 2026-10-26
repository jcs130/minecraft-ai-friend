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


def _verification_path(path: Path) -> Path:
    """Read exact Windows files without depending on the host EXE's MAX_PATH manifest."""
    if os.name != "nt":
        return path
    value = os.path.abspath(path)
    if value.startswith("\\\\?\\"):
        return Path(value)
    if value.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + value[2:])
    return Path("\\\\?\\" + value)


def verify_runtime(directory: Path) -> Path:
    entry = runtime_entry(directory)
    filesystem_entry = _verification_path(entry)
    manifest = filesystem_entry.parent.parent / "package.json"
    if not filesystem_entry.is_file() or not manifest.is_file():
        raise ValueError("backend_missing: install the pinned backend first (see README).")
    try:
        package = json.loads(manifest.read_text(encoding="utf-8"))
    except (ValueError, OSError) as error:
        raise ValueError("backend_build_mismatch: invalid package manifest") from error
    if (package.get("name"), package.get("version")) != (SOURCE["name"], SOURCE["version"]):
        raise ValueError("backend_version_mismatch: the installed client differs from backend/source.json.")
    root = manifest.parent.resolve()
    def check_file(name: str, expected: str):
        target = (root / name).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError(f"backend_build_mismatch: missing or invalid build path ({name}). "
                             "Prepare the complete matching runtime again; no verification was skipped.")
        data = target.read_bytes()
        # npm normalizes only a bin's CRLF shebang. All other bytes remain pinned.
        if name.startswith("bin/") and data.startswith(b"#!"):
            first, separator, rest = data.partition(b"\n")
            data = first.removesuffix(b"\r") + separator + rest
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("backend_build_mismatch: a file differs from the pinned canonical build.")
    # Pin the receipts themselves, package exports and executable shims.
    for name, expected in SOURCE["verification"].items():
        check_file(name, expected)
    receipt = json.loads((root / "dist/build.json").read_text(encoding="utf-8"))
    if receipt.get("schema") != "agent-mc-build/v1" or receipt.get("viewer", {}).get("included") is not False:
        raise ValueError("backend_build_mismatch: expected the canonical engine-only build.")
    for item in receipt["files"] + receipt["sourceFiles"]:
        check_file(item["file"], item["sha256"])
    declarations = json.loads((root / "dist/types/manifest.json").read_text(encoding="utf-8"))
    for item in declarations["files"]:
        check_file("dist/types/" + item["file"], item["sha256"])
    return entry


def verify_archive(path: Path) -> None:
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != SOURCE["sha256"]:
        raise ValueError("backend_archive_hash_mismatch: refusing to install unverified bytes.")


def prepare(directory: Path, archive: Path | None = None, *, offline: bool = False) -> Path:
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
        [npm, "ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", *(["--offline"] if offline else [])],
        cwd=directory, check=True, timeout=600,
    )
    if (directory / "node_modules" / "cortico").exists():
        raise ValueError("Unexpected Cortico runtime dependency.")
    return verify_runtime(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--archive", type=Path, help="Hash-verified headless archive produced by backend/build.py")
    parser.add_argument("--offline", action="store_true", help="Require all dependencies already in npm's cache")
    arguments = parser.parse_args()
    print(prepare(arguments.destination, arguments.archive, offline=arguments.offline))


if __name__ == "__main__":
    main()
