"""Resolve a Modrinth-format SAO pack in a new, isolated directory.

All referenced files are verified against the author's index. This does not
install into a live server, execute the pack's scripts, or accept its EULA.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import time
import urllib.request
from urllib.parse import urlsplit
import zipfile

CDNS = {"cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net", "raw.githubusercontent.com"}
USER_AGENT = "Qiandengji-SAO-compatibility/0.1 (local pack acceptance)"


def digest(path, algorithm="sha256"):
    with Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, algorithm).hexdigest()


def relative_path(name):
    if "\\" in name or ":" in name or "\x00" in name:
        raise ValueError("Invalid portable pack path: " + name)
    result = PurePosixPath(name)
    if result.is_absolute() or ".." in result.parts or not result.parts:
        raise ValueError("Pack path escapes its root: " + name)
    return result


def verify(path, hashes, size=None):
    if not path.is_file() or size is not None and path.stat().st_size != size:
        return False
    if not hashes:
        raise ValueError("A published checksum is required")
    supported = {key: value for key, value in hashes.items() if key in {"sha512", "sha256", "sha1"}}
    if not supported:
        raise ValueError("At least one supported published checksum is required")
    return all(digest(path, key) == value.lower() for key, value in supported.items())


def fetch(url, destination, hashes, size=None):
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.username or parts.password or parts.hostname not in CDNS:
        raise ValueError("Unreviewed pack download origin: " + str(parts.hostname))
    if destination.exists():
        if verify(destination, hashes, size):
            return "verified_existing"
        raise ValueError("Existing destination differs from the pack index: " + destination.name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".download-part")
    for attempt in range(2):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=90) as response, partial.open("wb") as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
            if not verify(partial, hashes, size):
                raise ValueError("Downloaded bytes differ from the pack index: " + destination.name)
            os.replace(partial, destination)
            return "downloaded"
        except (OSError, TimeoutError):
            if attempt:
                raise
            time.sleep(1)
    raise AssertionError("unreachable")


def prepare(pack, cache_zip, output):
    pack, output = Path(pack).resolve(strict=True), Path(output).resolve()
    marker = output / "pack-source.json"
    signature = digest(pack)
    if marker.exists():
        if json.loads(marker.read_text("utf-8"))["sha256"] != signature:
            raise ValueError("Isolated directory belongs to another pack")
    else:
        if (output / "client").exists():
            raise ValueError("Refusing to reuse an unmarked client directory")
        output.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps({"pack": pack.name, "sha256": signature, "minecraft": "1.20.1", "scope": "isolated_testing"}, indent=2), encoding="utf-8")
    client = output / "client"
    client.mkdir(exist_ok=True)
    with zipfile.ZipFile(pack) as archive:
        index = json.loads(archive.read("modrinth.index.json"))
        if index.get("dependencies") != {"minecraft": "1.20.1", "forge": "47.4.10"}:
            raise ValueError("Review a changed pack game or loader before using this lab")
        seen = set()
        for entry in archive.infolist():
            if entry.is_dir() or not entry.filename.startswith("overrides/"):
                continue
            relative = relative_path(entry.filename[len("overrides/"):])
            key = str(relative).casefold()
            if key in seen or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Colliding or symbolic archive entry")
            seen.add(key)
            target = client.joinpath(*relative.parts)
            if not target.is_relative_to(client):
                raise ValueError("Destination escaped client root")
            target.parent.mkdir(parents=True, exist_ok=True)
            content = archive.read(entry)
            if target.exists() and target.read_bytes() != content:
                raise ValueError("Existing override changed: " + str(relative))
            if not target.exists():
                target.write_bytes(content)
        (output / "pack-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    cache_rows = {}
    if cache_zip:
        with zipfile.ZipFile(cache_zip) as cache:
            entries = {entry.filename.casefold(): entry for entry in cache.infolist() if not entry.is_dir()}
            for row in index["files"]:
                key = row["path"].casefold()
                if key not in entries:
                    continue
                content = cache.read(entries[key])
                hashes = row.get("hashes", {})
                if hashes and all(hashlib.new(algorithm, content).hexdigest() == value.lower() for algorithm, value in hashes.items() if algorithm in {"sha512", "sha256", "sha1"}):
                    relative = relative_path(row["path"])
                    target = client.joinpath(*relative.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        target.write_bytes(content)
                    cache_rows[row["path"]] = "verified_cache_zip"
    def resolve(row):
        relative = relative_path(row["path"])
        target = client.joinpath(*relative.parts)
        if row["path"] in cache_rows:
            return {"path": row["path"], "source": cache_rows[row["path"]], "sha256": digest(target), "bytes": target.stat().st_size}
        errors = []
        for url in row.get("downloads", []):
            try:
                source = fetch(url, target, row["hashes"], row.get("fileSize"))
                return {"path": row["path"], "source": source, "sha256": digest(target), "bytes": target.stat().st_size}
            except (OSError, ValueError) as error:
                errors.append(str(error))
        raise ValueError(row["path"] + ": " + "; ".join(errors))
    resolved, failed = [], []
    total = len(index["files"])
    print(json.dumps({"event": "overrides_ready", "files": len(seen), "references": total, "verified_cache_hits": len(cache_rows)}), flush=True)
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = {pool.submit(resolve, row): row["path"] for row in index["files"]}
        for future in as_completed(jobs):
            try:
                resolved.append(future.result())
            except Exception as error:
                failed.append({"path": jobs[future], "error": str(error)})
            done = len(resolved) + len(failed)
            if done % 15 == 0 or done == total:
                print(json.dumps({"event": "pack_download", "complete": len(resolved), "failed": len(failed), "total": total}), flush=True)
    result = {"pack": pack.name, "sha256": signature, "resolved": sorted(resolved, key=lambda item: item["path"]), "failed": failed, "complete": not failed, "mod_jars": len(list((client / "mods").glob("*.jar")))}
    (output / "pack-resolution.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "resolved"}, ensure_ascii=False), flush=True)
    if failed:
        raise RuntimeError("Pack resolution is incomplete; inspect original failures before proceeding")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", required=True, type=Path)
    parser.add_argument("--cache-zip", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    prepare(args.pack, args.cache_zip, args.output)
