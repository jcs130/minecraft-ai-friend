"""Verify/build the isolated controller integration, optionally install its client-only JARs.

Downloads are pinned official Modrinth CDN files and checked against two hashes.
This never modifies content-mods.json, exports, server mods, source Minecraft,
options.txt, or a player's existing controller mapping/configuration.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "vendor/controller-cache"


def verify(path: Path, row: dict) -> None:
    raw = path.read_bytes()
    if len(raw) != row["size"] or any(hashlib.new(algorithm, raw).hexdigest() != row[algorithm]
                                      for algorithm in ("sha256", "sha512")):
        raise ValueError("Pinned artifact checksum mismatch: " + path.name)
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError("Corrupt archive: " + path.name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Fetch missing pinned official files")
    parser.add_argument("--build", action="store_true", help="Compile local client control mod")
    parser.add_argument("--install-client", action="store_true", help="Copy these three verified JARs into this D project's client/mods")
    args = parser.parse_args()
    cfg = json.loads((ROOT / "config/controller-support.json").read_text("utf-8"))
    CACHE.mkdir(parents=True, exist_ok=True)
    files = []
    for row in cfg["official_mods"]:
        path = CACHE / row["filename"]
        if not path.is_file():
            if not args.download:
                raise FileNotFoundError(str(path) + "; use --download")
            if not row["url"].startswith("https://cdn.modrinth.com/data/"):
                raise ValueError("Only official pinned Modrinth CDN downloads are permitted")
            request = urllib.request.Request(row["url"], headers={"User-Agent": "QiandengJi-controller-setup/1.0"})
            raw = urllib.request.urlopen(request, timeout=60).read()
            if len(raw) != row["size"] or hashlib.sha512(raw).hexdigest() != row["sha512"]:
                raise ValueError("Download checksum mismatch: " + row["filename"])
            path.write_bytes(raw)
        verify(path, row)
        files.append({"mod_id": row["mod_id"], "filename": path.name, "cache_path": path.relative_to(ROOT).as_posix(),
                      "sha256": row["sha256"], "size_bytes": row["size"], "source_url": row["url"], "client_only": True})
    if args.build:
        subprocess.run([sys.executable, str(ROOT / cfg["local_mod"]["build"])], check=True, cwd=ROOT)
    local = CACHE / cfg["local_mod"]["filename"]
    record = json.loads((ROOT / "world/client-controls-src/build-record.json").read_text("utf-8"))
    if hashlib.sha256(local.read_bytes()).hexdigest() != record["sha256"]:
        raise ValueError("Local JAR does not match its build record")
    files.append({"mod_id": cfg["local_mod"]["mod_id"], "filename": local.name,
                  "cache_path": local.relative_to(ROOT).as_posix(), "sha256": record["sha256"], "size_bytes": local.stat().st_size,
                  "source_build": cfg["local_mod"]["build"], "client_only": True})
    if args.install_client:
        mods = ROOT / "client/mods"
        assert mods.resolve().is_relative_to(ROOT.resolve())
        mods.mkdir(parents=True, exist_ok=True)
        for row in files:
            destination = mods / row["filename"]
            if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != row["sha256"]:
                raise FileExistsError("Refuse to overwrite a different client mod: " + destination.name)
            if not destination.exists():
                shutil.copy2(ROOT / row["cache_path"], destination)
    manifest = {"schema_version": 1, "minecraft": "1.21.1", "neoforge": "21.1.248", "client_only": True,
                "files": files, "installed_client": args.install_client, "physical_controller_verified": False,
                "shared_content_manifest_modified": False, "server_modified": False}
    (ROOT / "manifests/controller-support.lock.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verified_jars": len(files), "installed_client": args.install_client,
                      "manifest": "manifests/controller-support.lock.json"}))


if __name__ == "__main__":
    main()
