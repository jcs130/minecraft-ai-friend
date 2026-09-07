"""Build the D-project server-only Iron's bridge; never deploys or reads credentials."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "world/irons-bridge-src"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--libraries", type=Path, default=ROOT / "server/mc/libraries")
    parser.add_argument("--mods", type=Path, default=ROOT / "server/mc/mods")
    parser.add_argument("--jdk-bin", type=Path, default=Path(os.environ.get(
        "JDK21_BIN", r"C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin")))
    args = parser.parse_args()
    ext = ".exe" if os.name == "nt" else ""
    javac, java = args.jdk_bin / ("javac" + ext), args.jdk_bin / ("java" + ext)
    if not javac.is_file():
        raise SystemExit("JDK 21 required; set JDK21_BIN or --jdk-bin")
    helper_path = ROOT / "world/botgate-src/build.py"
    spec = importlib.util.spec_from_file_location("qiandeng_botgate_build_readonly", helper_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    selected = helper.full_cp(args.libraries).split(os.pathsep)
    iron = args.mods / "irons_spellbooks-1.21.1-3.16.3.jar"
    if not iron.is_file():
        raise SystemExit("Exact installed Iron's 1.21.1-3.16.3 JAR is required")
    # Other mod libraries supply referenced types (Curios, Iron's Lib, GeckoLib).
    mod_jars = sorted(p for p in args.mods.glob("*.jar") if not p.name.startswith("qiandeng-irons-bridge-"))
    classpath = os.pathsep.join([*selected, *(str(p) for p in mod_jars)])
    build = (SOURCE / "build").resolve()
    classes = build / "classes"
    if not build.is_relative_to(SOURCE.resolve()):
        raise SystemExit("Build output escaped owned source directory")
    if classes.exists():
        shutil.rmtree(classes)
    classes.mkdir(parents=True)
    sources = sorted((SOURCE / "src").rglob("*.java"))
    argfile = build / "javac.args"
    quoted = lambda value: '"' + str(value).replace("\\", "/").replace('"', '\\"') + '"'
    argfile.write_text("\n".join(["-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", quoted(classpath),
        "-d", quoted(classes), *(quoted(p) for p in sources)]) + "\n", encoding="utf-8")
    subprocess.run([str(javac), "@" + str(argfile)], check=True, timeout=300)
    test_classes = build / "test-classes"
    test_classes.mkdir(exist_ok=True)
    subprocess.run([str(javac), "--release", "21", "-encoding", "UTF-8", "-cp", str(classes), "-d", str(test_classes),
        str(SOURCE / "tests/ActorLookupTest.java")], check=True, timeout=60)
    test = subprocess.run([str(java), "-cp", os.pathsep.join([str(classes), str(test_classes)]),
        "dev.qiandeng.irons.ActorLookupTest"], check=True, capture_output=True, text=True, timeout=30)
    test_result = json.loads(test.stdout)
    target = build / "qiandeng-irons-bridge-0.1.0.jar"
    entries = [(p, p.relative_to(classes).as_posix()) for p in classes.rglob("*.class")]
    entries += [(p, p.relative_to(SOURCE / "resources").as_posix()) for p in (SOURCE / "resources").rglob("*") if p.is_file()]
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, name in sorted(entries, key=lambda e: e[1]):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise SystemExit("JAR CRC validation failed")
    inputs = [*sources, *(SOURCE / "resources").rglob("*.toml"), SOURCE / "tests/ActorLookupTest.java", Path(__file__)]
    record = {"ok": True, "minecraft": "1.21.1", "neoforge": "21.1.248", "irons_spellbooks": "1.21.1-3.16.3",
        "java_release": 21, "jar": str(target), "sha256": sha(target), "tests": test_result,
        "sources": {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(inputs)},
        "dependencies": {p.name: sha(p) for p in mod_jars}, "deployment": "not performed", "native_cast_live_test": "pending"}
    (build / "build-record.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: record[k] for k in ("ok", "jar", "sha256", "tests", "deployment", "native_cast_live_test")}))


if __name__ == "__main__":
    main()
