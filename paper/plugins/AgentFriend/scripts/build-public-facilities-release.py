"""Build public supply policy onto pinned production 0.4.47.12; never installs or restarts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

BASE = "d024b51f2f623c16d2b71b02e2e7aa979928bd16d10f9879b35442a7e0ab1f72"
PACKAGE = "org/afuhome/agentfriend/"
NAMES = ("LandManager", "GuildStorageOwnership", "GuildHallManager")
# Only old released help strings change in these classes. Reproduce the actual
# installed bytecode first; never bring the held CLI/parry/archive work along.
PUBLISHED = "cf9dc88359d29cd0af0f2580784e87dbee2c91bb"
TEXT_ONLY = {
    "AgentCliCatalog": ("开箱前查询领地与实体储物权限；公会门内归领地主人", "开箱前查询领地与实体储物权限；公共设施补给可取放"),
    "TaskMarketManager": ("门内物品归萌萌。", "公共设施内补给箱可取放，个人箱仍归本人。"),
    "GuildManager": ("不放进大厅私有箱。", "其他公共箱先核对权限。"),
    "DailyBoardManager": ("不改用大厅私有箱。", "其他公共箱先核对权限。"),
}
VERSION = "0.4.47.13"
sha = lambda data: hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("server", "base-jar", "jdk", "output"):
        parser.add_argument("--" + key, required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    server, out = args.server.resolve(), args.output.resolve()
    assert sha(args.base_jar.read_bytes()) == BASE, "Unreviewed production baseline"
    assert not out.exists() and out != server and server not in out.parents, "Use a fresh output outside Paper"
    source, classes = out / "source" / PACKAGE, out / "classes"
    source.mkdir(parents=True)
    classes.mkdir()
    (out / "empty").mkdir()
    files, hashes = [], {}
    for name in NAMES:
        original = root / "src" / PACKAGE / (name + ".java")
        text = original.read_text(encoding="utf-8")
        assert "plugin.archives()" not in text, "Do not deploy unrelated unreleased hooks"
        target = source / original.name
        target.write_text(text, encoding="utf-8", newline="\n")
        files.append(target)
        hashes[original.relative_to(root).as_posix()] = sha(original.read_bytes())
    cp = os.pathsep.join(map(str, [args.base_jar, server / "versions/1.21.1/paper-1.21.1.jar",
                                 *sorted((server / "libraries").rglob("*.jar")), *sorted((server / "plugins").glob("*.jar"))]))
    baseline_source, baseline_classes = out / "baseline-source" / PACKAGE, out / "baseline-classes"
    baseline_source.mkdir(parents=True)
    baseline_classes.mkdir()
    baseline_files, frozen = [], {}
    for name, (old, new) in TEXT_ONLY.items():
        path = "paper/plugins/AgentFriend/src/" + PACKAGE + name + ".java"
        original = subprocess.check_output(["git", "show", PUBLISHED + ":" + path], cwd=root.parents[2])
        text = original.decode("utf-8")
        if name == "AgentCliCatalog":
            lines = text.splitlines(keepends=True)
            held = [line for line in lines if line.lstrip().startswith('add(specs,"archive')]
            assert len(held) == 9, "Held archive descriptions changed"
            text = "".join(line for line in lines if line not in held)
        elif name == "TaskMarketManager":
            held = ('        return task.steps().get(index(player)).goal() == GuildManager.Goal.PARRY\n'
                    '                ? TaskProgressGuidance.parry(guide, plugin.professions().readGuardSkill(player, task.definition())) : guide;')
            assert text.count(held) == 1, "Held guard hook changed"
            text = text.replace(held, "        return guide;")
        elif name == "GuildManager":
            held = "        plugin.archives().syncSources();\n"
            assert text.count(held) == 2, "Held archive hook changed"
            text = text.replace(held, "")
        assert "plugin.archives()" not in text and text.count(old) == 1
        prior = baseline_source / (name + ".java")
        prior.write_text(text, encoding="utf-8", newline="\n")
        baseline_files.append(prior)
        target = source / prior.name
        target.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
        files.append(target)
        frozen[name] = {"commit": PUBLISHED, "originalSha256": sha(original), "textOnly": True}
    baseline_args = ["-proc:none", "-encoding", "UTF-8", "--release", "21", "-sourcepath", str(out / "empty"),
                     "-cp", cp, "-d", str(baseline_classes), *map(str, baseline_files)]
    (out / "baseline.args").write_text("\n".join('"' + s.replace("\\", "/") + '"' for s in baseline_args), encoding="utf-8")
    baseline = subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(out / "baseline.args")])
    if baseline.returncode:
        raise SystemExit("Released help baseline compilation failed")
    for file in baseline_classes.rglob("*.class"):
        qualified = file.relative_to(baseline_classes).as_posix().removesuffix(".class").replace("/", ".")
        def bytecode(classpath):
            return subprocess.check_output([str(args.jdk / "bin/javap.exe"), "-p", "-c", "-classpath", str(classpath), qualified])
        assert bytecode(baseline_classes) == bytecode(args.base_jar), "Published baseline differs: " + qualified
    test = root / "tests" / PACKAGE / "PublicFacilityTest.java"
    cmd = ["-proc:none", "-encoding", "UTF-8", "--release", "21", "-sourcepath", str(out / "empty"),
           "-cp", cp, "-d", str(classes), *map(str, [*files, test])]
    argfile = out / "javac.args"
    argfile.write_text("\n".join('"' + s.replace("\\", "/") + '"' for s in cmd), encoding="utf-8")
    compiled = subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(argfile)])
    if compiled.returncode:
        raise SystemExit("Candidate compilation failed")
    tested = subprocess.run([str(args.jdk / "bin/java.exe"), "-cp", str(classes) + os.pathsep + cp,
                             "org.afuhome.agentfriend.PublicFacilityTest"])
    if tested.returncode:
        raise SystemExit("Public facility regression failed")
    owned = lambda n: n.startswith(PACKAGE) and n.endswith(".class") and n.rsplit("/", 1)[-1].split("$")[0].removesuffix(".class") in (*NAMES, *TEXT_ONLY)
    target = out / ("AgentFriend-" + VERSION + ".jar")
    unchanged, replaced = [], []
    with zipfile.ZipFile(args.base_jar) as old, zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as new:
        assert len(old.namelist()) == len(set(old.namelist()))
        for entry in old.infolist():
            if entry.filename in ("plugin.yml", "lands.yml") or owned(entry.filename):
                continue
            new.writestr(entry, old.read(entry.filename))
            unchanged.append(entry.filename)
        descriptor = old.read("plugin.yml").decode("utf-8")
        assert descriptor.count("version: '0.4.47.12'") == 1
        entries = {"plugin.yml": descriptor.replace("version: '0.4.47.12'", "version: '" + VERSION + "'").encode(),
                   "lands.yml": (root / "resources/lands.yml").read_bytes()}
        for file in sorted(classes.rglob("*.class")):
            name = file.relative_to(classes).as_posix()
            if owned(name):
                entries[name] = file.read_bytes()
        for name, data in entries.items():
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            new.writestr(entry, data)
            replaced.append(name)
    with zipfile.ZipFile(args.base_jar) as old, zipfile.ZipFile(target) as new:
        assert all(old.read(n) == new.read(n) for n in unchanged)
        assert not any("PublicArchive" in n for n in new.namelist())
    report = dict(version=VERSION, sha256=sha(target.read_bytes()), baselineSha256=BASE,
                  unchangedEntries=len(unchanged), replacedEntries=replaced, sources=hashes,
                  frozenHelpSources=frozen, baselineBytecodeVerified=True, productionChanged=False)
    (out / "build.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("sources", "frozenHelpSources")}))


if __name__ == "__main__":
    main()
