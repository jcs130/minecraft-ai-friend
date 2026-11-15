"""Run CLI, storage, menu and skill contracts against the exact candidate JARs."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("build", "classpath-file", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    args.output.mkdir(parents=True, exist_ok=False)
    report = json.loads((args.build / "build-report.json").read_text(encoding="utf8"))
    artifacts = []
    for key in ("af", "rpg"):
        artifact = Path(report[key]["path"])
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == report[key]["sha256"]
        artifacts.append(str(artifact))
    cp = os.pathsep.join(artifacts + [args.classpath_file.read_text(encoding="utf-8-sig").strip()])
    tests = ["AgentCliContractTest", "AgentCliTextTest", "JourneyCatalogTest", "NativeCliCatalogTest",
             "AgentCliRecoveryTest", "GuildAdventureGuideTest", "AdventureChoiceTest", "AtomicConfigFileTest",
             "DurableConfigFilesTest", "EconomyPresentationTest", "StashGuidanceCatalogTest",
             "DungeonEnchantmentsTest", "AdventureMenuModelTest"]
    sources = [root / "org/afuhome/agentfriend" / (name + ".java") for name in tests + ["DurableConfigCrashChild"]]
    sources.append(root.parents[2] / "integrations/vortex-rpg/tests/SkillTransitionTest.java")
    options = ["-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", cp, "-d", str(args.output), *map(str, sources)]
    argfile = args.output / "javac.args"
    argfile.write_text("\n".join('"' + x.replace("\\", "/") + '"' for x in options), encoding="utf8")
    suffix = ".exe" if os.name == "nt" else ""
    commands = [("compile", [str(args.jdk / "bin" / ("javac" + suffix)), "@" + str(argfile)])]
    commands += [(name, [str(args.jdk / "bin" / ("java" + suffix)), "-cp", str(args.output) + os.pathsep + cp,
                        "org.afuhome.agentfriend." + name, str(root.parent / "resources")]) for name in tests]
    commands.append(("SkillTransitionTest", [str(args.jdk / "bin" / ("java" + suffix)), "-cp", str(args.output) + os.pathsep + cp,
                                            "SkillTransitionTest"]))
    results = []
    for name, command in commands:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf8", errors="replace", timeout=180)
        (args.output / (name + ".log")).write_text(result.stdout + result.stderr, encoding="utf8")
        results.append(dict(name=name, exitCode=result.returncode))
        (args.output / "results.json").write_text(json.dumps(results, indent=2), encoding="utf8")
        print(name, result.returncode, result.stdout[-300:], result.stderr[-1500:] if result.returncode else "", flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
