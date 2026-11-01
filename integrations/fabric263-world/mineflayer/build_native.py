"""Compile an optional server-only Fabric native-registry component from source."""
import argparse
import json
from pathlib import Path
import subprocess
import zipfile
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from prepare import digest


def build(cache, java):
    config = json.loads((HERE.parent / "deployment.local.json").read_text())
    lock = json.loads((HERE.parent / "pack.lock.json").read_text())
    api = next(e for e in lock["mods"] if e["slug"] == "fabric-api")
    archive = cache / api["filename"]
    if any(digest(archive, alg) != value for alg, value in api["hashes"].items()):
        raise ValueError("Fabric API bytes differ from lock")
    out = cache / "mineflayer/native-build"
    out.mkdir(parents=True, exist_ok=True)
    deps = []
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if name.endswith(".jar") and any(s in name for s in ("networking-api", "lifecycle-events", "fabric-api-base", "registry-sync")):
                target = out / Path(name).name
                target.write_bytes(z.read(name)); deps.append(target)
    sources = sorted((HERE / "native-src").glob("*.java"))
    import hashlib
    fingerprint = hashlib.sha256(b"".join(p.read_bytes() for p in sources)).hexdigest()
    classes = out / ("classes-" + fingerprint[:16])
    classes.mkdir(exist_ok=True)
    cp = [cache / "minecraft-26.3-client.jar", *deps, *sorted((cache / "libraries").rglob("*.jar"))]
    cmd = [str(java.with_name("javac.exe")), "-J-Dfile.encoding=UTF-8", "-J-Duser.language=en", "-encoding", "UTF-8", "--release", "25", "-proc:none", "-cp", ";".join(map(str, cp)), "-d", str(classes), *map(str, sources)]
    result = subprocess.run(cmd, capture_output=True)
    (out / "javac.log").write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise ValueError(result.stderr.decode("utf-8", "replace"))
    metadata = {"schemaVersion": 1, "id": "maw_native263", "version": "0.1.0", "environment": "server",
                "name": "My Agent World: Native Mineflayer Registry", "license": "MIT",
                "entrypoints": {"main": ["dev.myagentworld.native263.NativeRegistry"]},
                "mixins": ["maw-native263.mixins.json"],
                "depends": {"minecraft": "26.3", "java": ">=25", "fabricloader": ">=0.20.1", "fabric-networking-api-v1": "*", "fabric-lifecycle-events-v1": "*", "village-quest": "=2.6.3"}}
    files = {"fabric.mod.json": json.dumps(metadata).encode(), "maw-native263.mixins.json": json.dumps({
        "required": True, "minVersion": "0.8", "package": "dev.myagentworld.native263.mixin", "compatibilityLevel": "JAVA_25",
        "mixins": ["OutgoingViewsMixin", "InitMenuMixin"], "injectors": {"defaultRequire": 1}}).encode()}
    for file in classes.rglob("*.class"):
        files[file.relative_to(classes).as_posix()] = file.read_bytes()
    jar = out / "maw-native263-0.1.0.jar"
    with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return {"filename": jar.name, "sha256": digest(jar), "sourceSha256": {p.name: digest(p) for p in sources}, "sides": ["server"]}


if __name__ == "__main__":
    config = json.loads((HERE.parent / "deployment.local.json").read_text())
    print(json.dumps(build(Path(config["cache"]), Path(config["java"]))))
