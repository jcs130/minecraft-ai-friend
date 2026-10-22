"""Build the external Agent Skill without world files, credentials or viewer assets.

Input: the reviewed SDK 0.4.0 archive built with its official --without-viewer
option. The normal 47 MB viewer-enabled SDK is intentionally not redistributed.
Node dependencies are installed by the recipient with npm ci from the frozen lock.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path, PurePosixPath


REPO = Path(__file__).resolve().parents[1]
SDK_SHA256 = "eb07cc849b4c9633d310183f977422dab782e7cee4aaa6a91c40c837d4cf562d"
ORIGINAL_SDK_SHA256 = "bebf5ad804e008d03da2c1e1a45a9b6cf32d5ec4454cbde31179f4636ac92112"
VERSION = "1.0.0"
SDK_NAME = "agent-mc-world-0.4.0-headless.tgz"


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def json_file(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def inspect_sdk(archive: Path) -> dict:
    if digest(archive) != SDK_SHA256:
        raise ValueError("sdk_sha256_mismatch")
    with tarfile.open(archive, "r:gz") as tar:
        for item in tar.getmembers():
            parts = PurePosixPath(item.name).parts
            if not parts or parts[0] != "package" or ".." in parts or item.issym() or item.islnk():
                raise ValueError("unsafe_sdk_archive")
            if "node_modules" in parts or any(part in parts for part in ("viewer", "client-console", "monitor")):
                raise ValueError("headless_sdk_contains_viewer")
            if Path(item.name).suffix.lower() in (".png", ".jpg", ".webp", ".zip"):
                raise ValueError("headless_sdk_contains_game_assets")
        package = json.load(tar.extractfile("package/package.json"))
        build = json.load(tar.extractfile("package/dist/build.json"))
        if package["version"] != "0.4.0" or build["viewer"]["included"] is not False:
            raise ValueError("headless_sdk_version_mismatch")
    return {"version": "0.4.0", "flavor": "without-viewer", "sha256": SDK_SHA256,
            "originalArchiveSha256": ORIGINAL_SDK_SHA256, "bytes": archive.stat().st_size}


def build(sdk: Path, output: Path, repo: Path = REPO) -> dict:
    sdk = sdk.resolve()
    metadata = inspect_sdk(sdk)
    if output.exists():
        raise ValueError("output_already_exists")
    output.mkdir(parents=True)
    root = output / "qiandengji-agent"
    source = repo / "skills" / root.name
    root.mkdir()
    shutil.copy2(source / "SKILL.md", root / "SKILL.md")
    shutil.copy2(repo / "LICENSE", root / "LICENSE")
    for folder in ("scripts", "references"):
        shutil.copytree(source / folder, root / folder)
    runtime = root / "assets" / "runtime"
    runtime.mkdir(parents=True)
    for path in (source / "assets" / "mcp").glob("*.mjs"):
        shutil.copy2(path, runtime / path.name)
    adapter = repo / "integrations" / "qiandengji-harness"
    (runtime / "qiandengji").mkdir()
    for name in ("entry", "engine", "contract", "protocol", "configuration"):
        shutil.copy2(adapter / (name + ".mjs"), runtime / "qiandengji" / (name + ".mjs"))
    shutil.copy2(sdk, runtime / SDK_NAME)
    package = json.loads((adapter / "body-package.json").read_text(encoding="utf-8"))
    package.update(name="qiandengji-agent-skill-runtime", version=VERSION, engines={"node": ">=22"})
    package["dependencies"]["agent-mc-world"] = f"file:{SDK_NAME}"
    lock = json.loads((adapter / "body-package-lock.json").read_text(encoding="utf-8"))
    lock.update(name=package["name"], version=VERSION)
    lock["packages"][""].update(name=package["name"], version=VERSION, engines=package["engines"], dependencies=package["dependencies"])
    sdk_row = lock["packages"]["node_modules/agent-mc-world"]
    sdk_row["resolved"] = f"file:{SDK_NAME}"
    sdk_row["integrity"] = "sha512-" + base64.b64encode(hashlib.sha512(sdk.read_bytes()).digest()).decode("ascii")
    json_file(runtime / "package.json", package)
    json_file(runtime / "package-lock.json", lock)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    files = [{"path": p.relative_to(root).as_posix(), "sha256": digest(p)}
             for p in sorted(root.rglob("*")) if p.is_file()]
    manifest = {"schemaVersion": 1, "name": root.name, "version": VERSION,
                "sourceRepository": "https://github.com/jcs130/minecraft-ai-friend",
                "baseRevision": revision, "sdk": metadata,
                "game": {"host": "micro.kangqiang.site", "port": 25702, "version": "1.21.1"},
                "portal": "https://mc.kangqiang.site", "files": files}
    json_file(root / "bundle.json", manifest)
    archive = output / f"qiandengji-agent-{VERSION}.zip"
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zip_out:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            info = zipfile.ZipInfo(path.relative_to(output).as_posix(), date_time=(2026, 10, 22, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zip_out.writestr(info, path.read_bytes())
    sha = digest(archive)
    (output / "SHA256SUMS.txt").write_text(f"{sha}  {archive.name}\n", encoding="ascii")
    return {"skill": str(root), "zip": str(archive), "sha256": sha, "bytes": archive.stat().st_size,
            "files": len(files) + 1, "sdk": metadata, "baseRevision": revision,
            "credentialsIncluded": False, "viewerAssetsIncluded": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.sdk, args.out), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
