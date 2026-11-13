"""Build the shop and frost candidate on the pinned AgentFriend runtime."""
from copy import copy
from hashlib import sha256
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import zipfile


BASE_SHA = "f8ee8b9df20f363d60509196a9a5e93baef92a9c19f39f9612f10b613c499702"
VERSION = "0.4.47.71-daily-shop-frost"
PREFIX = "org/afuhome/agentfriend/"
CLASSES = ("ArenaEconomy", "DailyShop", "EconomyPresentation", "CombatSpells", "FrostControl", "SpellGuide",
           "AgentCliCatalog", "GroupSpellAccess", "CompanionTravelAccess", "SkillEventPublisher", "SkillPayload")


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("base", "server", "jdk", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    args = parser.parse_args()
    if digest(args.base) != BASE_SHA or args.server.resolve() in args.output.resolve().parents:
        raise ValueError("An exact reviewed baseline and an isolated output path are required.")
    build = args.output.with_suffix(".build")
    build.mkdir(parents=True)
    classes, empty = build / "classes", build / "empty"
    classes.mkdir()
    empty.mkdir()
    classpath = os.pathsep.join(str(path) for path in (
        args.base, *sorted((args.server / "libraries").rglob("*.jar")),
        *sorted((args.server / "versions").rglob("*.jar")), *sorted((args.server / "plugins").glob("*.jar")),
    ))
    source = Path(__file__).resolve().parents[1] / "src" / PREFIX
    arguments = ["-proc:none", "-implicit:none", "--release", "21", "-encoding", "UTF-8", "-sourcepath", empty,
                 "-cp", classpath, "-d", classes, *(source / (name + ".java") for name in CLASSES)]
    argfile = build / "javac.args"
    argfile.write_text("\n".join('"' + str(value).replace("\\", "/") + '"' for value in arguments), encoding="utf-8")
    subprocess.run([str(args.jdk / "bin/javac.exe"), "-J-Xmx768m", "@" + str(argfile)], check=True)

    def owned(name):
        return any(name == PREFIX + stem + ".class" or name.startswith(PREFIX + stem + "$") for stem in CLASSES)

    compiled = {path.relative_to(classes).as_posix(): path.read_bytes() for path in sorted(classes.rglob("*.class"))}
    assert compiled and all(owned(name) for name in compiled)
    preserved = []
    with zipfile.ZipFile(args.base) as baseline, zipfile.ZipFile(args.output, "x", zipfile.ZIP_DEFLATED) as output:
        for info in baseline.infolist():
            name = info.filename
            if owned(name):
                continue
            data = baseline.read(info)
            if name == "plugin.yml":
                data, count = re.subn(rb"(?m)^version:.*$", ("version: " + VERSION).encode(), data)
                assert count == 1
            else:
                preserved.append(name)
            output.writestr(copy(info), data)
        for name, data in compiled.items():
            entry = zipfile.ZipInfo(name)
            entry.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(entry, data)
    with zipfile.ZipFile(args.base) as baseline, zipfile.ZipFile(args.output) as output:
        assert len(output.namelist()) == len(set(output.namelist()))
        for name in preserved:
            assert output.read(name) == baseline.read(name), name
    proof = {"version": VERSION, "baseSha256": BASE_SHA, "sha256": digest(args.output),
             "preservedEntries": len(preserved), "compiledClasses": sorted(compiled), "productionChanged": False}
    args.output.with_suffix(".json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(proof))


if __name__ == "__main__":
    main()
