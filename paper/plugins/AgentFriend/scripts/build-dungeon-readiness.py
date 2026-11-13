"""Build the dungeon readiness and stash increment against the deployed jars."""
from pathlib import Path
import argparse
import hashlib
import os
import re
import subprocess
import zipfile

AF = "dc4a1f163271b93b9ce6e1cb5ceb740b504b0ad74edf2f1bb806c806a4333a4d"
RPG = "0867036c7e68859e7511100259773be58ab6468c8b6b2c5124437decd2c02079"
VORTEX = "04489c418211925cbedb2f7d7f40df65ccf53ab2bb03ff8ba8230fbf51a5b223"
AF_VERSION = "0.4.47.72-dungeon-readiness"
RPG_VERSION = "0.2.22-dungeon-readiness"
AF_CLASSES = ("DungeonLoadoutRules", "DungeonLoadout", "DungeonRecovery", "DungeonManager", "SiteDungeonManager",
              "DungeonAdvice", "TrialGuide", "NativeRpg", "SpellGuide", "InventoryTidy", "InventoryFeedback",
              "AgentCliCatalog", "AdventureMenuModel", "AgentFriendPlugin", "CompanionTravelAccess")
RPG_CLASSES = ("VortexBridge",)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compile_sources(jdk, classes, classpath, sources):
    classes.mkdir(parents=True)
    arguments = ["-proc:none", "-implicit:none", "--release", "21", "-encoding", "UTF-8",
                 "-classpath", classpath, "-d", classes, *sources]
    options = classes.parent / (classes.name + ".args")
    options.write_text("\n".join('"' + str(value).replace("\\", "/") + '"' for value in arguments), encoding="utf-8")
    subprocess.run([str(jdk / "bin/javac.exe"), "-J-Xmx768m", "@" + str(options)], check=True)


def package(base, target, classes, prefix, names, version, resources=None):
    resources = resources or {}
    def owned(name):
        return name.startswith(prefix) and name.endswith(".class") and name[len(prefix):].split("$")[0].removesuffix(".class") in names
    entries = {path.relative_to(classes).as_posix(): path.read_bytes() for path in sorted(classes.rglob("*.class"))}
    assert all(owned(name) for name in entries)
    assert all(prefix + name + ".class" in entries for name in names)
    with zipfile.ZipFile(base) as old, zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as new:
        for info in old.infolist():
            name = info.filename
            if owned(name):
                continue
            content = old.read(name)
            if name == "plugin.yml":
                content, count = re.subn(rb"(?m)^version:[^\r\n]*", ("version: " + version).encode(), content)
                assert count == 1
            elif name in resources:
                content = resources[name].read_bytes()
            new.writestr(info, content)
        for name, content in entries.items():
            info = zipfile.ZipInfo(name, (2026, 11, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            new.writestr(info, content)
    with zipfile.ZipFile(base) as old, zipfile.ZipFile(target) as new:
        assert len(new.namelist()) == len(set(new.namelist()))
        assert all(new.read(name) == path.read_bytes() for name,path in resources.items())
        retained = [name for name in old.namelist() if name != "plugin.yml" and not owned(name) and name not in resources]
        assert all(old.read(name) == new.read(name) for name in retained)
    print(version, digest(target), len(retained), "preserved entries")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("agentfriend", "rpg", "vortex", "server", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if tuple(digest(path) for path in (args.agentfriend, args.rpg, args.vortex)) != (AF, RPG, VORTEX):
        parser.error("Deployed AgentFriend, RPG adapter and Vortex digests must match")
    if args.output.exists() or args.output.resolve().is_relative_to(args.server.resolve()):
        parser.error("Choose a new directory outside the server")
    root = Path(__file__).resolve().parents[3]
    classpath = os.pathsep.join(str(path) for path in (
        args.agentfriend, args.rpg, args.vortex, *sorted((args.server / "libraries").rglob("*.jar")),
        *sorted((args.server / "versions").rglob("*.jar")), *sorted((args.server / "plugins").glob("*.jar")),
    ))
    for base, prefix, source, names, version in (
        (args.agentfriend, "org/afuhome/agentfriend/", root / "plugins/AgentFriend/src", AF_CLASSES, AF_VERSION),
        (args.rpg, "org/qiandengji/vortex/", root / "integrations/vortex-rpg/src", RPG_CLASSES, RPG_VERSION),
    ):
        classes = args.output / ("classes-" + version)
        compile_sources(args.jdk, classes, classpath, [source / prefix / (name + ".java") for name in names])
        resources = {name: root / "plugins/AgentFriend/resources" / name for name in ("agent-guide.yml","onboarding.yml")} if base == args.agentfriend else None
        package(base, args.output / (base.name.split("-0.")[0] + "-" + version + ".jar"),
                classes, prefix, names, version, resources)


if __name__ == "__main__":
    main()
