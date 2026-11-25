"""Run CLI contracts against a self-host build, without starting a game or reading player data."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--build", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jdk", type=Path)
    args = parser.parse_args()
    inputs, build, output = args.inputs.resolve(), args.build.resolve(), args.output.resolve()
    if not (inputs / ".qiandengji-self-host.json").is_file() or not (build / "build.json").is_file():
        raise ValueError("Use prepared self-host inputs and their build, not a live server.")
    if output == inputs or inputs in output.parents or output == build or build in output.parents:
        raise ValueError("Use a fresh test output outside the build and Paper inputs.")
    output.mkdir(parents=True, exist_ok=False)
    classes = build / "AgentFriend-classes"
    classpath = os.pathsep.join(map(str, [classes, inputs / "versions/1.21.1/paper-1.21.1.jar",
        *sorted((inputs / "libraries").rglob("*.jar")), *sorted((inputs / "plugins").glob("*.jar"))]))
    root = Path(__file__).resolve().parent
    tests = ["AgentCliContractTest", "AgentCliTextTest", "JourneyCatalogTest", "NativeCliCatalogTest",
             "AgentCliRecoveryTest", "GuildAdventureGuideTest", "GuildRankPointsTest", "GuildPromotionLedgerTest",
             "AdventureChoiceTest", "AtomicConfigFileTest",
             "DurableConfigFilesTest", "EconomyPresentationTest", "StashGuidanceCatalogTest", "DungeonEnchantmentsTest",
             "WeaponSkillRollsTest", "EchoCitadelTest", "CryptBuildingRulesTest", "TaskJournalModelTest", "LegacyPointSourcePolicyTest"]
    suffix = ".exe" if os.name == "nt" else ""
    tool = lambda name: str(args.jdk / "bin" / (name + suffix)) if args.jdk else name
    version = subprocess.run([tool("javac"), "-version"], capture_output=True, text=True, check=True)
    if not (version.stdout + version.stderr).startswith("javac 21."):
        raise ValueError("CLI checks require JDK 21.")
    sources = [root / "org/afuhome/agentfriend" / (name + ".java") for name in tests]
    sources.append(root / "org/afuhome/agentfriend/DurableConfigCrashChild.java")
    # The catalog contract compares the two real adapters. Compile the pure
    # transition policy too; do not require a private/native RPG build or drop
    # the cross-adapter equality assertion from the public source checks.
    sources.append(root.parents[2] / "integrations/vortex-rpg/src/org/qiandengji/vortex/SkillTransition.java")
    options = ["-proc:none", "-encoding", "UTF-8", "--release", "21", "-cp", classpath, "-d", str(output), *map(str, sources)]
    argfile = output / "javac.args"
    argfile.write_text("\n".join('"' + word.replace("\\", "/") + '"' for word in options), encoding="utf-8")
    subprocess.run([tool("javac"), "@" + str(argfile)], check=True)
    for name in tests:
        result = subprocess.run([tool("java"), "-cp", str(output) + os.pathsep + classpath,
                                 "org.afuhome.agentfriend." + name, str(root.parent / "resources")])
        if result.returncode:
            raise SystemExit("CLI contract failed: " + name + " (exit " + str(result.returncode) + ")")
    # New workflow regressions are execution tests, not grep guards or skipped checks.
    cpfile = output / "current-classpath.txt"
    cpfile.write_text(classpath, encoding="utf-8")
    home = args.jdk or Path(tool("javac")).resolve().parents[1]
    if args.jdk is None:
        configured = os.environ.get("JAVA_HOME")
        if not configured:
            raise ValueError("JAVA_HOME or --jdk required for two-track runners")
        home = Path(configured)
    gson = None
    for candidate in sorted((inputs / "libraries").rglob("gson-*.jar")):
        with zipfile.ZipFile(candidate) as archive:
            if "com/google/gson/JsonObject.class" in archive.namelist():
                gson = candidate
                break
    if gson is None:
        raise ValueError("Prepared real Gson dependency missing; gson-io is not the Gson API")
    subprocess.run([sys.executable, str(root / "run_exam_two_track_tests.py"), "--jdk", str(home),
                    "--classpath-file", str(cpfile), "--gson", str(gson), "--output", str(output / "exam-tests-ci")], check=True)
    subprocess.run([sys.executable, str(root / "run_life_two_track_tests.py"), "--jdk", str(home),
                    "--classpath", str(cpfile), "--baseline-classes", str(classes), "--output", str(output / "life-tests-ci")], check=True)
    integration = root.parents[2] / "integrations/vortex-rpg"
    subprocess.run([tool("javac"), "--release", "21", "-encoding", "UTF-8", "-cp", classpath, "-d", str(output),
                    str(integration / "src/org/qiandengji/vortex/LegacyPointMigration.java"),
                    str(integration / "tests/LegacyTransferProtocolTest.java")], check=True)
    subprocess.run([tool("java"), "-cp", str(output) + os.pathsep + classpath,
                    "org.qiandengji.vortex.LegacyTransferProtocolTest"], check=True)


if __name__ == "__main__":
    main()
