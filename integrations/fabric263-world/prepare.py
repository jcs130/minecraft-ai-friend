"""Resolve and prepare an isolated, pinned Fabric client and server.

No production files, launcher accounts, global Java settings or firewall rules
are read or modified. Only missing files are downloaded. Existing mismatches
are errors; no pack is silently updated or removed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
UA = "MyAgentWorld-Fabric263-Lab/0.1 (+https://github.com/jcs130/minecraft-ai-friend)"


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=90)


def get_json(url):
    with request(url) as response:
        return json.load(response)


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def download(url, target, hashes=None, size=None):
    target = Path(target)
    hashes = hashes or {}

    def verify(path):
        if size is not None and path.stat().st_size != size:
            raise ValueError(f"Size mismatch: {target.name}")
        for algorithm, expected in hashes.items():
            if digest(path, algorithm) != expected:
                raise ValueError(f"{algorithm} mismatch: {target.name}")

    if target.exists():
        verify(target)
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    with request(url) as response, part.open("wb") as f:
        shutil.copyfileobj(response, f, length=1024 * 1024)
    verify(part)
    part.replace(target)
    return target


def safe_child(root, relative):
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f"Path escapes root: {relative}")
    return path


def allowed(rules, features=None):
    if not rules:
        return True
    features = features or {}
    result = False
    for rule in rules:
        system = rule.get("os", {})
        if system.get("name", "windows") != "windows":
            continue
        if "arch" in system and not re.fullmatch(system["arch"], "amd64"):
            continue
        if "version" in system and not re.search(system["version"], "10.0"):
            continue
        if any(features.get(key, False) != value for key, value in rule.get("features", {}).items()):
            continue
        result = rule["action"] == "allow"
    return result


def expand_arguments(items, replacements, features):
    out = []
    for item in items:
        if isinstance(item, dict):
            if not allowed(item.get("rules"), features):
                continue
            values = item["value"]
            values = values if isinstance(values, list) else [values]
        else:
            values = [item]
        for value in values:
            for key, replacement in replacements.items():
                value = value.replace("${" + key + "}", str(replacement))
            if "${" in value:
                raise ValueError("Unresolved launch argument: " + value)
            out.append(value)
    return out


class Resolver:
    def __init__(self, spec):
        self.spec = spec
        self.projects = {}
        self.versions = {}
        self.by_project = {}
        self.root_pins = {}

    def project(self, key):
        if key not in self.projects:
            data = get_json("https://api.modrinth.com/v2/project/" + key)
            self.projects[key] = self.projects[data["id"]] = data
        return self.projects[key]

    def version(self, key):
        if key not in self.versions:
            self.versions[key] = get_json("https://api.modrinth.com/v2/version/" + key)
        return self.versions[key]

    def choose(self, project_id):
        if project_id in self.root_pins:
            return self.version(self.root_pins[project_id])
        query = urllib.parse.urlencode({"game_versions": json.dumps([self.spec["minecraft"]]), "loaders": '["fabric"]'})
        candidates = get_json("https://api.modrinth.com/v2/project/" + project_id + "/version?" + query)
        releases = [v for v in candidates if v["version_type"] == "release"]
        if not releases:
            raise ValueError("No stable Fabric version for required project: " + project_id)
        return releases[0]

    def add(self, version, sides, role):
        if self.spec["minecraft"] not in version["game_versions"] or "fabric" not in version["loaders"]:
            raise ValueError("Version does not support exact game/loader: " + version["id"])
        project = self.project(version["project_id"])
        # Standalone catalogue labels must not drop hard client dependencies.
        sides = set(sides) if role == "dependency" else {s for s in sides if project[s + "_side"] != "unsupported"}
        old = self.by_project.get(project["id"])
        if old:
            if old["versionId"] != version["id"]:
                raise ValueError("Conflicting required versions: " + project["slug"])
            new_sides = sides - set(old["sides"])
            if not new_sides:
                return
            old["sides"] = sorted(set(old["sides"]) | sides)
            sides = new_sides
        else:
            file = next((f for f in version["files"] if f.get("primary")), version["files"][0])
            self.by_project[project["id"]] = {
                "projectId": project["id"], "slug": project["slug"], "versionId": version["id"],
                "version": version["version_number"], "role": role, "sides": sorted(sides),
                "clientSide": project["client_side"], "serverSide": project["server_side"],
                "source": "https://modrinth.com/mod/" + project["slug"], "filename": file["filename"],
                "url": file["url"], "hashes": file["hashes"], "size": file["size"],
                "dependencies": version["dependencies"], "license": project["license"]["id"],
            }
            print("Resolved " + project["slug"] + " " + version["version_number"], flush=True)
        for dep in version["dependencies"]:
            if dep["dependency_type"] != "required":
                continue
            child = self.version(dep["version_id"]) if dep.get("version_id") else (
                self.version(self.by_project[dep["project_id"]]["versionId"])
                if dep.get("project_id") in self.by_project else self.choose(dep["project_id"]))
            self.add(child, sides, "dependency")

    def resolve(self):
        # Seed all root pins before traversing, so a transitive latest never
        # silently overrides a root chosen by the operator.
        for root in self.spec["roots"]:
            self.version(root["versionId"])
        for root in self.spec["roots"]:
            version = self.version(root["versionId"])
            project = self.project(root["slug"])
            if project["id"] != version["project_id"]:
                raise ValueError("Root slug/version mismatch: " + root["slug"])
            self.root_pins[project["id"]] = version["id"]
        for root in self.spec["roots"]:
            self.add(self.version(root["versionId"]), set(root.get("sides", ["client", "server"])), root["role"])
        return sorted(self.by_project.values(), key=lambda e: e["slug"])


def write_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_owned_roots(args):
    for side, root in (("server", args.server), ("client", args.client)):
        marker = root / "fabric263-lab.json"
        if marker.exists():
            data = json.loads(marker.read_text())
            if data.get("game") != "26.3" or data.get("loopbackOnly") is not True:
                raise ValueError("Instance marker does not match the isolated world: " + str(root))
        elif root.exists() and any(root.iterdir()):
            raise ValueError("Refusing an unowned nonempty " + side + " before copying any mods: " + str(root))
    for root in (args.server, args.client):
        root.mkdir(parents=True, exist_ok=True)
        marker = root / "fabric263-lab.json"
        if not marker.exists():
            write_json(marker, {"game": "26.3", "loopbackOnly": True})


def copy_checked(source, target):
    if target.exists():
        if digest(source) != digest(target):
            raise ValueError("Existing file differs: " + str(target))
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def resolve_lock(args, spec):
    lock_path = HERE / "pack.lock.json"
    if lock_path.exists():
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        if lock["specSha256"] != digest(HERE / "pack.spec.json"):
            raise ValueError("Spec changed; explicitly review/recreate the lock")
        if args.rederive_sides:
            derive_locked_sides(lock, spec)
            write_json(lock_path, lock)
        if lock.get("sideRulesVersion") != 2:
            raise ValueError("Old side rules; review and run --rederive-sides without changing versions")
        return lock
    lock = {"schemaVersion": 1, "name": spec["name"], "version": spec["version"],
            "minecraft": spec["minecraft"], "loader": spec["loader"],
            "specSha256": digest(HERE / "pack.spec.json"), "sideRulesVersion": 2,
            "mods": Resolver(spec).resolve(), "external": []}
    for entry in spec["external"]:
        file = download(entry["url"], args.cache / entry["filename"],
                        {"sha256": entry["sha256"]} if entry.get("sha256") else None)
        lock["external"].append({**entry, "hashes": {"sha256": digest(file), "sha512": digest(file, "sha512")}, "size": file.stat().st_size})
    write_json(lock_path, lock)
    return lock


def derive_locked_sides(lock, spec):
    by_project = {entry["projectId"]: entry for entry in lock["mods"]}
    by_version = {entry["versionId"]: entry for entry in lock["mods"]}
    for entry in lock["mods"]:
        entry["sides"] = []

    def visit(entry, sides):
        added = set(sides) - set(entry["sides"])
        if not added:
            return
        entry["sides"] = sorted(set(entry["sides"]) | added)
        for dep in entry["dependencies"]:
            if dep["dependency_type"] == "required":
                child = by_version[dep["version_id"]] if dep.get("version_id") else by_project[dep["project_id"]]
                visit(child, added)

    for root in spec["roots"]:
        entry = by_version[root["versionId"]]
        sides = [side for side in root.get("sides", ["server", "client"]) if entry[side + "Side"] != "unsupported"]
        visit(entry, sides)
    lock["sideRulesVersion"] = 2


def prepare_mods(args, lock):
    entries = lock["mods"] + lock["external"]
    def fetch(entry):
        return entry, download(entry["url"], args.cache / entry["filename"], entry["hashes"], entry["size"])
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for entry, cached in pool.map(fetch, entries):
            for side, root in (("server", args.server), ("client", args.client)):
                if side in entry["sides"]:
                    copy_checked(cached, root / "mods" / entry["filename"])
    print("Verified and copied all locked mods", flush=True)


def prepare_java(args):
    meta_path = args.cache / "java25-source.json"
    if not meta_path.exists():
        data = get_json("https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&heap_size=normal&image_type=jdk&jvm_impl=hotspot&os=windows&vendor=eclipse")[0]
        write_json(meta_path, data)
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    package = data["binary"]["package"]
    archive = download(package["link"], args.cache / package["name"], {"sha256": package["checksum"]}, package["size"])
    jdk_root = args.cache / "java25"
    with zipfile.ZipFile(archive) as z:
        java = jdk_root / z.namelist()[0].split("/")[0] / "bin" / "java.exe"
        if not java.exists():
            for name in z.namelist():
                safe_child(jdk_root, name)
            z.extractall(jdk_root)
    return java


def prepare_server(args, spec, java):
    args.server.mkdir(parents=True, exist_ok=True)
    marker = args.server / "fabric263-lab.json"
    if not marker.exists() and (args.server / "server.properties").exists():
        raise ValueError("Refusing to adopt an existing server")
    write_json(marker, {"game": spec["minecraft"], "loader": spec["loader"], "loopbackOnly": True})
    props = args.server / "server.properties"
    if not props.exists():
        props.write_text("server-ip=127.0.0.1\nserver-port=" + str(args.port) + "\nonline-mode=false\nenforce-secure-profile=false\n"
                         "enable-rcon=false\nenable-query=false\nwhite-list=false\nmax-players=8\nview-distance=6\nsimulation-distance=5\n"
                         "difficulty=normal\ngamemode=survival\nspawn-protection=16\nlevel-name=world\n"
                         "motd=My Agent World | Living Adventures | Fabric 26.3 LAB\n", encoding="utf-8")
    if args.accept_eula:
        (args.server / "eula.txt").write_text("# Accepted by operator for this isolated server.\neula=true\n", encoding="utf-8")
    launcher_url = f"https://meta.fabricmc.net/v2/versions/loader/{spec['minecraft']}/{spec['loader']}/{spec['installer']}/server/jar"
    launcher = download(launcher_url, args.cache / "fabric-server-launch.jar")
    copy_checked(launcher, args.server / "fabric-server-launch.jar")
    return {"launcherUrl": launcher_url, "launcherSha256": digest(launcher)}


def prepare_client(args, spec):
    manifest = get_json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
    item = next(v for v in manifest["versions"] if v["id"] == spec["minecraft"])
    base_file = download(item["url"], args.cache / "minecraft-version.json", {"sha1": item["sha1"]})
    base = json.loads(base_file.read_text(encoding="utf-8"))
    profile = get_json(f"https://meta.fabricmc.net/v2/versions/loader/{spec['minecraft']}/{spec['loader']}/profile/json")
    write_json(args.cache / "fabric-profile.json", profile)
    jobs = []
    classpath = []
    native_archives = []
    seen = set()
    for lib in profile["libraries"] + base["libraries"]:
        if not allowed(lib.get("rules")):
            continue
        key = ":".join(lib["name"].split(":")[:2] + lib["name"].split(":")[3:])
        if key in seen:
            continue
        seen.add(key)
        artifact = lib.get("downloads", {}).get("artifact")
        if not artifact:
            group, name, version, *classifier = lib["name"].split(":")
            path = group.replace(".", "/") + f"/{name}/{version}/{name}-{version}" + ("-" + classifier[0] if classifier else "") + ".jar"
            artifact = {"path": path, "url": lib.get("url", "https://libraries.minecraft.net/") + path}
        target = safe_child(args.cache / "libraries", artifact["path"])
        jobs.append((artifact["url"], target, {"sha1": artifact["sha1"]} if artifact.get("sha1") else None, artifact.get("size")))
        classpath.append(str(target))
        if "natives-windows" in lib["name"]:
            native_archives.append(target)
        classifier = lib.get("natives", {}).get("windows")
        if classifier:
            native = lib["downloads"]["classifiers"][classifier.replace("${arch}", "64")]
            target = safe_child(args.cache / "libraries", native["path"])
            jobs.append((native["url"], target, {"sha1": native["sha1"]}, native.get("size")))
            native_archives.append(target)
    game = base["downloads"]["client"]
    game_jar = args.cache / "minecraft-26.3-client.jar"
    jobs.append((game["url"], game_jar, {"sha1": game["sha1"]}, game["size"]))
    classpath.append(str(game_jar))
    index = base["assetIndex"]
    asset_file = download(index["url"], args.cache / "assets" / "indexes" / (index["id"] + ".json"), {"sha1": index["sha1"]}, index["size"])
    assets = json.loads(asset_file.read_text(encoding="utf-8"))
    for obj in assets["objects"].values():
        h = obj["hash"]
        target = args.cache / "assets" / "objects" / h[:2] / h
        jobs.append((f"https://resources.download.minecraft.net/{h[:2]}/{h}", target, {"sha1": h}, obj["size"]))
    jobs = list({str(job[1]): job for job in jobs}.values())
    print(f"Preparing {len(jobs)} verified game/library/asset files", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for n, _ in enumerate(pool.map(lambda job: download(*job), jobs), 1):
            if n % 500 == 0:
                print(f"Game resources {n}/{len(jobs)}", flush=True)
    natives = args.cache / "natives"
    natives.mkdir(parents=True, exist_ok=True)
    for archive in native_archives:
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                if name.lower().endswith(".dll"):
                    target = natives / Path(name).name
                    if not target.exists():
                        target.write_bytes(z.read(name))
    args.client.mkdir(parents=True, exist_ok=True)
    options = args.client / "options.txt"
    if not options.exists():
        options.write_text("lang:zh_cn\npauseOnLostFocus:false\nfullscreen:false\nrenderDistance:6\nsimulationDistance:5\nmaxFps:45\n", encoding="utf-8")
    return {"base": str(base_file), "profile": str(args.cache / "fabric-profile.json"), "classpath": classpath,
            "assets": str(args.cache / "assets"), "assetIndex": index["id"], "natives": str(natives),
            "minecraftVersionSha1": item["sha1"], "clientSha1": game["sha1"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--server", type=Path, required=True)
    ap.add_argument("--client", type=Path, required=True)
    ap.add_argument("--cache", type=Path, required=True)
    ap.add_argument("--port", type=int, default=39781)
    ap.add_argument("--control-port", type=int, default=39782)
    ap.add_argument("--accept-eula", action="store_true")
    ap.add_argument("--resolve-only", action="store_true")
    ap.add_argument("--rederive-sides", action="store_true", help="Recompute sides from existing dependency pins; never selects new versions")
    args = ap.parse_args()
    for name in ("server", "client", "cache"):
        setattr(args, name, getattr(args, name).resolve())
    if len({args.server, args.client, args.cache}) != 3 or any(a.is_relative_to(b) for a in (args.server, args.client, args.cache) for b in (args.server, args.client, args.cache) if a != b):
        raise ValueError("Server, client and cache must be separate directories")
    spec = json.loads((HERE / "pack.spec.json").read_text(encoding="utf-8"))
    if not args.resolve_only:
        validate_owned_roots(args)
    args.cache.mkdir(parents=True, exist_ok=True)
    lock = resolve_lock(args, spec)
    if args.resolve_only:
        print(json.dumps({"mods": len(lock["mods"]), "external": len(lock["external"])}))
        return
    java = prepare_java(args)
    print("Prepared private Java 25: " + str(java), flush=True)
    prepare_mods(args, lock)
    server_meta = prepare_server(args, spec, java)
    client_meta = prepare_client(args, spec)
    from build_compat import build
    local_components = [build(args.cache, java, args.server, args.client)]
    local = {"schemaVersion": 1, "server": str(args.server), "client": str(args.client), "cache": str(args.cache),
             "port": args.port, "controlPort": args.control_port, "java": str(java),
             "packLockSha256": digest(HERE / "pack.lock.json"), "serverMetadata": server_meta, "clientMetadata": client_meta,
             "localComponents": local_components}
    write_json(HERE / "deployment.local.json", local)
    print(json.dumps({"prepared": True, "mods": len(lock["mods"]), "external": len(lock["external"]), "port": args.port}))


if __name__ == "__main__":
    main()
