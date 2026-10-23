"""Build only reviewed journey guidance onto pinned live 0.4.47.11; never installs it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

BASE = "9572d48ee16965dd25448a5634ad5e1b5607826dc4951c6133cc18d09de99be2"
PACKAGE = "org/afuhome/agentfriend/"
NAMES = ("ReplantGuidance", "TaskMarketManager", "TaskRouteCatalog", "TaskRoutes", "OnboardingGuide", "WorldLifeManager", "AgentCoach", "AgentCommunication")
RESOURCES = ("onboarding.yml", "world-life.yml", "route-contracts.yml", "resident-contracts.yml")
sha = lambda data: hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True, type=Path)
    parser.add_argument("--base-jar", required=True, type=Path)
    parser.add_argument("--jdk", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out, server = args.output.resolve(), args.server.resolve()
    assert sha(args.base_jar.read_bytes()) == BASE, "Unreviewed live baseline"
    assert not out.exists() and out != server and server not in out.parents, "Use a fresh directory outside Paper"
    source, classes = out / "source" / PACKAGE, out / "classes"
    source.mkdir(parents=True)
    classes.mkdir()
    (out / "empty").mkdir()
    files, hashes = [], {}
    for name in NAMES:
        original = root / "src" / PACKAGE / (name + ".java")
        text = original.read_text(encoding="utf-8")
        if name == "AgentCommunication":
            from importlib.machinery import SourceFileLoader
            helper = SourceFileLoader("journey_boundary", str(Path(__file__).with_name("build-rpg-release.py"))).load_module()
            text = helper.backport(name, text)
        if name == "TaskMarketManager":
            # The full source also has a separately held guard-skill candidate.
            # Preserve production parry guidance until that release is approved.
            held = ('        return task.steps().get(index(player)).goal() == GuildManager.Goal.PARRY\n'
                    '                ? TaskProgressGuidance.parry(guide, plugin.professions().readGuardSkill(player, task.definition())) : guide;')
            assert text.count(held) == 1, "Held guard hook changed; review backport"
            text = text.replace(held, "        return guide;")
        assert "plugin.archives()" not in text, "Unpublished archive hook"
        target = source / original.name
        target.write_text(text, encoding="utf-8", newline="\n")
        hashes[original.relative_to(root).as_posix()] = sha(original.read_bytes())
        files.append(target)
    cp = os.pathsep.join(map(str, [args.base_jar, server / "versions/1.21.1/paper-1.21.1.jar",
                                  *sorted((server / "libraries").rglob("*.jar")), *sorted((server / "plugins").glob("*.jar"))]))
    tests = ["ReplantGuidanceTest", "TaskRouteCatalogTest", "JourneyCatalogTest"]
    test_files = [root / "tests" / PACKAGE / (name + ".java") for name in tests]
    cmd = ["-proc:none", "-encoding", "UTF-8", "--release", "21", "-sourcepath", str(out / "empty"),
           "-cp", cp, "-d", str(classes), *map(str, files + test_files)]
    argfile = out / "javac.args"
    argfile.write_text("\n".join('"' + s.replace("\\", "/") + '"' for s in cmd), encoding="utf-8")
    subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(argfile)], check=True)
    for test in tests:
        subprocess.run([str(args.jdk / "bin/java.exe"), "-cp", str(classes) + os.pathsep + cp,
                        "org.afuhome.agentfriend." + test, str(root / "resources")], check=True)
    owned = lambda n: n.startswith(PACKAGE) and n.endswith(".class") and n.rsplit("/", 1)[-1].split("$")[0].removesuffix(".class") in NAMES
    target = out / "AgentFriend-0.4.47.12.jar"
    unchanged, replaced = [], []
    with zipfile.ZipFile(args.base_jar) as old, zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as new:
        assert len(old.namelist()) == len(set(old.namelist()))
        for entry in old.infolist():
            if entry.filename == "plugin.yml" or entry.filename in RESOURCES or owned(entry.filename):
                continue
            new.writestr(entry, old.read(entry.filename))
            unchanged.append(entry.filename)
        text = old.read("plugin.yml").decode("utf-8")
        assert text.count("version: '0.4.47.11'") == 1
        entries = {"plugin.yml": text.replace("version: '0.4.47.11'", "version: '0.4.47.12'").encode()}
        for name in RESOURCES:
            resource = root / "resources" / name
            entries[name] = resource.read_bytes()
            hashes[resource.relative_to(root).as_posix()] = sha(resource.read_bytes())
        for file in sorted(classes.rglob("*.class")):
            name = file.relative_to(classes).as_posix()
            if not owned(name):
                continue
            entries[name] = file.read_bytes()
        for name, data in entries.items():
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            new.writestr(entry, data)
            replaced.append(name)
    with zipfile.ZipFile(args.base_jar) as old, zipfile.ZipFile(target) as new:
        assert all(old.read(n) == new.read(n) for n in unchanged)
        assert not any("PublicArchive" in n for n in new.namelist())
    report = dict(version="0.4.47.12", sha256=sha(target.read_bytes()), baselineSha256=BASE,
                  unchangedEntries=len(unchanged), replacedEntries=replaced, sources=hashes, productionChanged=False)
    (out / "build.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "sources"}))


if __name__ == "__main__":
    main()
