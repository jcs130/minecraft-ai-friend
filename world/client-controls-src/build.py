"""Build the small client mod against the existing official Minecraft/NeoForge cache.

No server files or original Minecraft instance files are changed. Output is a
deterministic JAR under the project's private controller cache.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MOD_VERSION = "0.1.2"


def classpath(minecraft: Path, profile: str, neoforge: str, cache: Path) -> list[Path]:
    version = json.loads((minecraft / f"versions/{profile}/{profile}.json").read_text("utf-8-sig"))
    parent = version.get("inheritsFrom")
    layers = [version]
    if parent:
        layers.insert(0, json.loads((minecraft / f"versions/{parent}/{parent}.json").read_text("utf-8-sig")))
    libs = minecraft / "libraries"
    selected = [libs / f"net/neoforged/neoforge/{neoforge}/neoforge-{neoforge}-client.jar",
                libs / "net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-srg.jar",
                libs / f"net/neoforged/neoforge/{neoforge}/neoforge-{neoforge}-universal.jar"]
    for entry in (entry for layer in layers for entry in layer["libraries"]):
        if entry.get("rules"):
            allowed = False
            for rule in entry["rules"]:
                if rule.get("os", {}).get("name", "windows") == "windows":
                    allowed = rule.get("action") == "allow"
            if not allowed:
                continue
        artifact = entry.get("downloads", {}).get("artifact")
        if artifact and "natives-" not in entry.get("name", ""):
            selected.append(libs / artifact["path"])
    selected += [cache / "controlify-3.0.1+lts+1.21.1-neoforge.jar",
                 cache / "yet_another_config_lib_v3-3.8.2+1.21.1-neoforge.jar"]
    selected = list(dict.fromkeys(selected))
    missing = [str(p) for p in selected if not p.is_file()]
    if missing:
        raise FileNotFoundError("Missing official build dependencies: " + ", ".join(missing))
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minecraft", type=Path, default=Path(os.environ["APPDATA"]) / ".minecraft")
    parser.add_argument("--profile", default="Rapid Optimization")
    parser.add_argument("--neoforge", default="21.1.248")
    parser.add_argument("--controller-cache", type=Path, default=ROOT / "vendor/controller-cache")
    parser.add_argument("--javac", type=Path, default=Path(r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\javac.exe"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--record", type=Path)
    args = parser.parse_args()
    dependencies = classpath(args.minecraft, args.profile, args.neoforge, args.controller_cache)
    sources = sorted((HERE / "src").rglob("*.java"))
    # A fresh directory avoids stale class files entering the artifact.
    import tempfile
    target = (args.output or ROOT / f"vendor/controller-cache/qiandeng-controls-{MOD_VERSION}.jar").resolve()
    parent = target.parent
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="classes-", dir=parent) as temporary:
        classes = Path(temporary)
        options = ["-proc:none", "--release", "21", "-encoding", "UTF-8",
                   "-cp", os.pathsep.join(str(path.resolve()) for path in dependencies),
                   "-d", str(classes), *map(str, sources)]
        argfile = classes.parent / (classes.name + ".args")
        try:
            argfile.write_text("\n".join('"' + arg.replace("\\", "/") + '"' for arg in options), encoding="utf-8")
            subprocess.run([str(args.javac), "@" + str(argfile)], check=True)
        finally:
            argfile.unlink(missing_ok=True)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for folder in [classes, HERE / "resources"]:
                for path in sorted(folder.rglob("*")):
                    if not path.is_file():
                        continue
                    info = zipfile.ZipInfo(path.relative_to(folder).as_posix(), (1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, path.read_bytes())
        with zipfile.ZipFile(target) as archive:
            assert archive.testzip() is None
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    record = {"minecraft": "1.21.1", "neoforge": args.neoforge, "java_release": 21,
              "jar": target.name, "sha256": digest(target),
              "sources": {p.relative_to(HERE).as_posix(): digest(p)
                          for p in sorted([HERE / "build.py", *sources, *(HERE / "resources").rglob("*")]) if p.is_file()},
              "classpath": [{"path": str(p), "sha256": digest(p)} for p in dependencies]}
    if args.record:
        args.record.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"jar": str(target), "sha256": record["sha256"], "sources": len(sources)}))


if __name__ == "__main__":
    main()
