"""Provision a dedicated vanilla/Fabric camera; never installs or launches another Agent brain."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.parse
import urllib.request
import uuid
import zipfile

MC, LOADER = "1.21.1", "0.16.13"


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Qiandengji-Native-Camera/0.1"}), timeout=40) as response:
        return json.load(response)


def digest(path, algorithm):
    result = hashlib.new(algorithm)
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def fetch(url, target, expected=None, algorithm="sha1"):
    target = Path(target)
    if target.is_file() and expected and digest(target, algorithm) == expected:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".downloading")
    urllib.request.urlretrieve(url, temporary)
    if expected and digest(temporary, algorithm) != expected:
        raise RuntimeError("Downloaded artifact checksum mismatch: " + target.name)
    temporary.replace(target)
    return target


def allowed(rules):
    if not rules:
        return True
    result = False
    for rule in rules:
        system = rule.get("os", {})
        if system.get("name", "windows") != "windows" or system.get("arch", "x86_64") not in ("x86_64", "amd64") or rule.get("features"):
            continue
        result = rule["action"] == "allow"
    return result


def modrinth(project, version=None, *, shader=False):
    parameters = {"game_versions": json.dumps([MC])}
    if not shader:
        parameters["loaders"] = json.dumps(["fabric"])
    versions = get_json("https://api.modrinth.com/v2/project/" + project + "/version?" + urllib.parse.urlencode(parameters))
    rows = [row for row in versions if not version or version in row["version_number"]]
    if not rows:
        raise RuntimeError("Matching native artifact unavailable: " + project)
    row = rows[0]
    file = next((item for item in row["files"] if item.get("primary")), row["files"][0])
    return {"project": project, "version": row["version_number"], **file}


def provision(root, java, cached_mods, username):
    root = Path(root).resolve()
    if (root / "launch.json").exists():
        raise RuntimeError("Instance already provisioned; inspect its lock rather than replacing it")
    root.mkdir(parents=True, exist_ok=True)
    for folder in ("libraries", "mods", "assets/indexes", "assets/objects", "natives", "shaderpacks", "config", "diagnostics"):
        (root / folder).mkdir(parents=True, exist_ok=True)
    manifest = get_json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
    source = next(item for item in manifest["versions"] if item["id"] == MC)
    meta_file = fetch(source["url"], root / "minecraft-version.json", source["sha1"])
    minecraft = json.loads(meta_file.read_text())
    loader = get_json(f"https://meta.fabricmc.net/v2/versions/loader/{MC}/{LOADER}/profile/json")
    libraries = []
    artifacts = []
    for item in minecraft["libraries"]:
        if not allowed(item.get("rules")):
            continue
        artifact = item.get("downloads", {}).get("artifact")
        if not artifact:
            continue
        path = root / "libraries" / artifact["path"]
        if not path.resolve().is_relative_to(root / "libraries"):
            raise RuntimeError("Invalid library path")
        libraries.append(path)
        artifacts.append((artifact["url"], path, artifact["sha1"]))
    for item in loader["libraries"]:
        parts = item["name"].split(":")
        group, name, version = parts[:3]
        suffix = "-" + parts[3] if len(parts) == 4 else ""
        relative = "/".join([group.replace(".", "/"), name, version, name + "-" + version + suffix + ".jar"])
        url = item.get("url", "https://maven.fabricmc.net/").rstrip("/") + "/" + relative
        path = root / "libraries" / relative
        libraries.append(path)
        artifacts.append((url, path, None))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda row: fetch(*row), artifacts))
    client = minecraft["downloads"]["client"]
    client_file = fetch(client["url"], root / "minecraft-client.jar", client["sha1"])
    index = minecraft["assetIndex"]
    asset_index = fetch(index["url"], root / "assets/indexes" / (index["id"] + ".json"), index["sha1"])
    assets = json.loads(asset_index.read_text())["objects"]
    # Camera needs fonts/languages/icons. Music and vanilla sound recordings
    # are optional; SVC carries its own live audio and Opus transport.
    selected = {value["hash"] for name, value in assets.items() if not name.startswith("minecraft/sounds/")}
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda sha: fetch(f"https://resources.download.minecraft.net/{sha[:2]}/{sha}", root / "assets/objects" / sha[:2] / sha, sha), selected))
    for path in libraries:
        if "natives-windows" not in path.name or "arm64" in path.name or "x86." in path.name:
            continue
        with zipfile.ZipFile(path) as archive:
            for entry in archive.infolist():
                if entry.filename.lower().endswith(".dll"):
                    (root / "natives" / Path(entry.filename).name).write_bytes(archive.read(entry))
    copied = []
    for name in ("fabric-api-0.115.4+1.21.1.jar", "yesstevemodel-fabric-1.21.1-2.4.1-release.jar"):
        source_path = Path(cached_mods) / name
        with zipfile.ZipFile(source_path) as archive:
            json.loads(archive.read("fabric.mod.json"))
        shutil.copy2(source_path, root / "mods" / name)
        copied.append({"name": name, "sha256": digest(source_path, "sha256")})
    mods = [modrinth("iris", "1.8.8"), modrinth("sodium", "0.6.13"), modrinth("forge-config-api-port", "21.1.6"), modrinth("simple-voice-chat", "2.6.27")]
    for row in mods:
        fetch(row["url"], root / "mods" / row["filename"], row["hashes"]["sha512"], "sha512")
    shader = modrinth("makeup-ultra-fast-shaders", shader=True)
    fetch(shader["url"], root / "shaderpacks" / shader["filename"], shader["hashes"]["sha512"], "sha512")
    (root / "config/iris.properties").write_text("enableShaders=true\nshaderPack=" + shader["filename"] + "\n", encoding="utf-8")
    (root / "options.txt").write_text("version:3955\nrenderDistance:6\nsimulationDistance:4\nmaxFps:30\npauseOnLostFocus:false\nfov:0.0\nguiScale:2\nsoundCategory_master:0.0\n", encoding="utf-8")
    value = hashlib.md5(("OfflinePlayer:" + username).encode()).digest()
    offline = uuid.UUID(bytes=value, version=3)
    arguments = ["-Xms512M", "-Xmx2G", "-Dfile.encoding=UTF-8", "-Djava.library.path=" + str(root / "natives"), "-Dorg.lwjgl.librarypath=" + str(root / "natives"), "-cp", os.pathsep.join(map(str, libraries + [client_file])), loader["mainClass"], "--username", username, "--version", loader["id"], "--gameDir", str(root), "--assetsDir", str(root / "assets"), "--assetIndex", index["id"], "--uuid", str(offline), "--accessToken", "0", "--userType", "legacy", "--versionType", "release", "--width", "1536", "--height", "1536"]
    (root / "launch.json").write_text(json.dumps({"java": str(Path(java).resolve()), "arguments": arguments, "instance": str(root), "offlineUuidIsUnverifiedUntilJoined": str(offline)}, indent=2))
    (root / "source-lock.json").write_text(json.dumps({"minecraft": MC, "loader": LOADER, "minecraftMetadata": source, "copiedMods": copied, "downloadedMods": mods, "shader": shader, "assetsDownloaded": len(selected), "soundAssetsIncluded": False}, indent=2))
    print(json.dumps({"prepared": str(root), "minecraft": MC, "loader": LOADER, "nativeLibraries": len(libraries), "assets": len(selected), "launched": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--instance", required=True)
    parser.add_argument("--java", required=True)
    parser.add_argument("--cached-mods", required=True)
    parser.add_argument("--username", default="GoddessLensQA")
    args = parser.parse_args()
    if not args.username.isascii() or not args.username.replace("_", "").isalnum() or len(args.username) > 16:
        raise ValueError("A valid Minecraft account name is required")
    provision(args.instance, args.java, args.cached_mods, args.username)
