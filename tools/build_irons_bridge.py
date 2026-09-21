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
    parser.add_argument("--numen-jar", type=Path, help="Exact candidate Numen dependency; no production JAR replacement")
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
    if args.numen_jar:
        if not args.numen_jar.is_file(): raise SystemExit("Numen candidate JAR missing")
        mod_jars = [p for p in mod_jars if not p.name.startswith('numen-neoforge-')] + [args.numen_jar.resolve()]
    build = (SOURCE / "build").resolve()
    build.mkdir(parents=True, exist_ok=True)
    # The server-only interaction receipt adapter uses the installed Numen API.
    # Its public types live in the exact main mod's nested jar, not the mod root.
    numens = [p for p in mod_jars if p.name.startswith('numen-neoforge-')]
    if len(numens) != 1:
        raise SystemExit('Exactly one Numen main dependency required')
    numen = numens[0]
    with zipfile.ZipFile(numen) as archive:
        api_entries = [n for n in archive.namelist() if n.startswith("META-INF/jarjar/")
                       and n.endswith(".jar") and "numen_api" in n]
        if len(api_entries) != 1:
            raise SystemExit("Exact installed Numen API dependency required")
        numen_api = build / "numen-api-dependency.jar"
        numen_api.write_bytes(archive.read(api_entries[0]))
    # Compile against the exact MixinExtras already bundled by the installed NeoForge.
    # Never shade it or fetch another version into the production bridge.
    neo_universal = args.libraries / "net/neoforged/neoforge/21.1.248/neoforge-21.1.248-universal.jar"
    with zipfile.ZipFile(neo_universal) as archive:
        mixin_extras = build / "mixinextras-dependency.jar"
        mixin_extras.write_bytes(archive.read("META-INF/jarjar/mixinextras-neoforge-0.5.3.jar"))
    classpath = os.pathsep.join([*selected, str(numen_api), str(mixin_extras), *(str(p) for p in mod_jars)])
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
    test_names = ("ActorLookupTest", "TradeRulesTest", "InteractionArgumentsTest", "TownProtectionPolicyTest", "TownCommandScopeTest", "TownBlockMaskTest")
    test_sources = [SOURCE / "tests" / (name + ".java") for name in test_names]
    test_cp = os.pathsep.join([str(classes), str(test_classes), str(SOURCE / 'resources'), classpath])
    subprocess.run([str(javac), "-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", test_cp, "-d", str(test_classes),
        *(str(path) for path in test_sources)], check=True, timeout=60)
    test_results = []
    for name in test_names:
        test = subprocess.run([str(java), "-cp", test_cp,
            "dev.qiandeng.irons." + name], check=True, capture_output=True, text=True, timeout=30)
        test_results.append(json.loads(test.stdout))
    test_result = {"ok": all(result.get("ok") is True for result in test_results),
                   "checks": sum(result["checks"] for result in test_results), "suites": test_results}
    if not test_result["ok"]:
        raise SystemExit("Bridge contract tests failed")
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
    inputs = [*sources, *(p for p in (SOURCE / "resources").rglob("*") if p.is_file()), *test_sources, Path(__file__)]
    record = {"ok": True, "minecraft": "1.21.1", "neoforge": "21.1.248", "irons_spellbooks": "1.21.1-3.16.3",
        "java_release": 21, "jar": str(target), "sha256": sha(target), "tests": test_result,
        "sources": {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(inputs)},
        "dependencies": {p.name: sha(p) for p in mod_jars},
        "dependencySourcePaths": {p.name: str(p) for p in mod_jars},
        "frameworkDependencies": {"neoforge-21.1.248-universal.jar": sha(neo_universal), "bundled-mixinextras-0.5.3": sha(mixin_extras)},
        "deployment": "not performed", "native_cast_live_test": "pending"}
    (build / "build-record.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: record[k] for k in ("ok", "jar", "sha256", "tests", "deployment", "native_cast_live_test")}))


if __name__ == "__main__":
    main()
