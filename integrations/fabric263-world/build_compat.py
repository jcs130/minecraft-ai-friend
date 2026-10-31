"""Build a small, deterministic source-owned compatibility mod, never edit vendor JARs."""
import json
import argparse
from pathlib import Path
import subprocess
import shutil
import zipfile

from prepare import HERE, digest, copy_checked

NAME = "maw-fabric263-compat-0.1.0.jar"


def build(cache, java, server, client, replace_built=False, previous=None):
    source = HERE / "compat-src" / "VerifiedCraftMixin.java"
    lock = json.loads((HERE / "pack.lock.json").read_text())
    quest = next(e for e in lock["mods"] if e["slug"] == "justquests")
    if quest["version"] != "fabric-26.3-0.4.5" or digest(cache / quest["filename"], "sha512") != quest["hashes"]["sha512"]:
        raise ValueError("Compatibility source is reviewed only against exact JustQuests 0.4.5 bytes")
    mixins = list((cache / "libraries").rglob("sponge-mixin-*.jar"))
    if len(mixins) != 1:
        raise ValueError("Expected one pinned Fabric Mixin runtime")
    build_dir = cache / "compat-build"
    build_dir.mkdir(parents=True, exist_ok=True)
    classes = build_dir / "classes"
    classes.mkdir(exist_ok=True)
    loader = next((cache / "libraries").rglob("fabric-loader-0.20.1.jar"))
    with zipfile.ZipFile(loader) as z:
        name = next(n for n in z.namelist() if n.endswith(".jar") and "mixinextras" in n)
        extras = build_dir / "mixinextras-compile-only.jar"
        extras.write_bytes(z.read(name))
    cp = ";".join(str(p) for p in [cache / "minecraft-26.3-client.jar", extras, *sorted((cache / "libraries").rglob("*.jar"))])
    compile_cmd = [str(java.with_name("javac.exe")), "-J-Dfile.encoding=UTF-8", "-encoding", "UTF-8", "--release", "25", "-proc:none", "-cp", cp, "-d", str(classes), str(source)]
    compiled = subprocess.run(compile_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (build_dir / "javac.log").write_bytes(compiled.stdout + compiled.stderr)
    if compiled.returncode:
        raise ValueError("Compatibility compilation failed: " + compiled.stderr.decode("utf-8", "replace"))
    metadata = {"schemaVersion": 1, "id": "maw_fabric263_compat", "version": "0.1.0", "name": "My Agent World: Verified Crafting",
                "environment": "*", "mixins": ["maw-fabric263.mixins.json"],
                "depends": {"minecraft": "26.3", "java": ">=25", "fabricloader": ">=0.20.1", "justquests": "=0.4.5"}}
    mixin = {"required": True, "minVersion": "0.8", "package": "dev.myagentworld.fabric263", "compatibilityLevel": "JAVA_25",
             "priority": 500, "mixins": ["VerifiedCraftMixin"], "injectors": {"defaultRequire": 1}}
    files = {"fabric.mod.json": json.dumps(metadata).encode(), "maw-fabric263.mixins.json": json.dumps(mixin).encode()}
    for file in classes.rglob("*.class"):
        files[file.relative_to(classes).as_posix()] = file.read_bytes()
    jar = build_dir / NAME
    with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    for side, root in (("server", server), ("client", client)):
        target = (root / "mods" / NAME).resolve()
        if not target.is_relative_to(root.resolve()):
            raise ValueError("Component target escaped instance")
        if target.exists() and digest(target) != digest(jar):
            if not replace_built or previous is None or digest(target) != previous["sha256"]:
                raise ValueError("Existing built component differs; explicit reviewed replacement required")
            archive = cache / "compat-build" / (side + "-previous-" + previous["sha256"] + ".jar")
            if archive.exists():
                raise ValueError("Archive already exists; inspect prior operation")
            shutil.move(str(target), str(archive))
        copy_checked(jar, target)
    return {"filename": NAME, "sha256": digest(jar), "sourceSha256": digest(source), "sides": ["server", "client"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replace-built", action="store_true")
    args = parser.parse_args()
    config = json.loads((HERE / "deployment.local.json").read_text())
    previous = next((e for e in config.get("localComponents", []) if e["filename"] == NAME), None)
    entry = build(Path(config["cache"]), Path(config["java"]), Path(config["server"]), Path(config["client"]), args.replace_built, previous)
    config["localComponents"] = [entry]
    from prepare import write_json
    write_json(HERE / "deployment.local.json", config)
    print(json.dumps(entry))
