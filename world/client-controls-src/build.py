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


def classpath(minecraft: Path) -> list[Path]:
    version = json.loads((minecraft / "versions/Rapid Optimization/Rapid Optimization.json").read_text("utf-8-sig"))
    libs = minecraft / "libraries"
    selected = [libs / "net/neoforged/neoforge/21.1.248/neoforge-21.1.248-client.jar",
                libs / "net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-srg.jar",
                libs / "net/neoforged/neoforge/21.1.248/neoforge-21.1.248-universal.jar"]
    for entry in version["libraries"]:
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
    selected += [ROOT / "vendor/controller-cache/controlify-3.0.1+lts+1.21.1-neoforge.jar",
                 ROOT / "vendor/controller-cache/yet_another_config_lib_v3-3.8.2+1.21.1-neoforge.jar"]
    selected = list(dict.fromkeys(selected))
    missing = [str(p) for p in selected if not p.is_file()]
    if missing:
        raise FileNotFoundError("Missing official build dependencies: " + ", ".join(missing))
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minecraft", type=Path, default=Path(os.environ["APPDATA"]) / ".minecraft")
    parser.add_argument("--javac", type=Path, default=Path(r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin\javac.exe"))
    args = parser.parse_args()
    dependencies = classpath(args.minecraft)
    sources = sorted((HERE / "src").rglob("*.java"))
    # A fresh directory avoids stale class files entering the artifact.
    import tempfile
    parent = ROOT / "runtime/controller-build"
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="classes-", dir=parent) as temporary:
        classes = Path(temporary)
        command = [str(args.javac), "-proc:none", "--release", "21", "-encoding", "UTF-8",
                   "-cp", os.pathsep.join(map(str, dependencies)), "-d", str(classes), *map(str, sources)]
        subprocess.run(command, check=True)
        target = ROOT / "vendor/controller-cache/qiandeng-controls-0.1.0.jar"
        target.parent.mkdir(parents=True, exist_ok=True)
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
    record = {"minecraft": "1.21.1", "neoforge": "21.1.248", "java_release": 21,
              "jar": target.relative_to(ROOT).as_posix(), "sha256": digest(target),
              "sources": {p.relative_to(HERE).as_posix(): digest(p)
                          for p in sorted([HERE / "build.py", *sources, *(HERE / "resources").rglob("*")]) if p.is_file()},
              "classpath": [{"path": str(p), "sha256": digest(p)} for p in dependencies]}
    (HERE / "build-record.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"jar": str(target), "sha256": record["sha256"], "sources": len(sources)}))


if __name__ == "__main__":
    main()
