"""Download and verify the Java 17, Forge and Numen versions for this lab."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import urllib.request
import zipfile

from prepare_pack import CDNS, USER_AGENT, digest, fetch, relative_path


def remote(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=60).read()


def main(output, server_cache):
    output = Path(output).resolve()
    artifacts = output / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    CDNS.update({"github.com", "maven.minecraftforge.net"})
    def java():
        metadata_url = "https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse"
        metadata = json.loads(remote(metadata_url))[0]
        package = metadata["binary"]["package"]
        archive_path = artifacts / package["name"]
        fetch(package["link"], archive_path, {"sha256": package["checksum"]}, package["size"])
        target = output / "java"
        target.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive_path) as archive:
            for item in archive.infolist():
                relative_path(item.filename)
                if (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Unexpected Java archive symlink")
            archive.extractall(target)
        candidates = list(target.glob("*/bin/java.exe"))
        if len(candidates) != 1:
            raise ValueError("Java archive did not contain exactly one runtime")
        result = {"java": str(candidates[0]), "java_sha256": digest(candidates[0]), "archive_sha256": package["checksum"], "source": metadata_url, "version": metadata["version"]["openjdk_version"]}
        print(json.dumps({"event": "java_ready", "version": result["version"]}), flush=True)
        return result
    def numen():
        # The Maven jar is a modular compile artifact. Players need the official
        # release's -all distribution, which nests the matching numen_api engine.
        base = "https://github.com/Dwinovo/minecraft-numen/releases/download/v0.1.4.1-1.20.1-beta/"
        name = "numen-forge-1.20.1-0.1.4.1-all.jar"
        expected_sha256 = "e8b95d53bc524cc5d4326edfcbedc76aa2ce9dee0fa5db2f30a962d4797c5ea4"
        target = artifacts / name
        fetch(base + name, target, {"sha256": expected_sha256})
        with zipfile.ZipFile(target) as jar:
            if "META-INF/mods.toml" not in jar.namelist():
                raise ValueError("Official artifact is not the Forge distribution")
            embedded = [name for name in jar.namelist() if name.startswith("META-INF/jarjar/") and name.endswith(".jar") and "numen" in name]
            if len(embedded) != 1:
                raise ValueError("Official runtime must contain its matching Numen engine")
            if jar.testzip() is not None:
                raise ValueError("Invalid Numen archive")
        print(json.dumps({"event": "numen_ready", "version": "0.1.4.1", "bytes": target.stat().st_size}), flush=True)
        return {"path": str(target), "sha256": digest(target), "source": base + name, "version": "0.1.4.1", "upstream_source_commit": "a97fe04aec3b3077ae679181e315d69fba5347d9", "embedded_api": embedded[0]}
    def forge():
        name = "forge-1.20.1-47.4.10-installer.jar"
        url = "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.10/" + name
        sha1 = remote(url + ".sha1").decode("ascii").strip().split()[0]
        if not re.fullmatch("[a-f0-9]{40}", sha1):
            raise ValueError("Invalid official Forge checksum")
        target = artifacts / name
        if not target.exists():
            if server_cache:
                with zipfile.ZipFile(server_cache) as archive:
                    target.write_bytes(archive.read(name))
            else:
                target.write_bytes(remote(url))
        if digest(target, "sha1") != sha1:
            raise ValueError("Cached installer differs from the Forge publisher's checksum")
        print(json.dumps({"event": "forge_installer_ready", "version": "47.4.10"}), flush=True)
        return {"path": str(target), "sha1": sha1, "sha256": digest(target), "source": url}
    with ThreadPoolExecutor(max_workers=3) as pool:
        j, n, f = pool.submit(java), pool.submit(numen), pool.submit(forge)
        result = {"java": j.result(), "numen": n.result(), "forge": f.result()}
    (output / "runtime-lock.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"event": "runtime_ready", "record": str(output / "runtime-lock.json")}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--server-cache", type=Path, help="Optional old archive containing this exact Forge installer; bytes are still verified against Forge")
    args = parser.parse_args()
    main(args.output, args.server_cache)
