"""Build the Vortex group-spell patch and matching QiandengjiRpg adapter."""
from copy import copy
from hashlib import sha256
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import zipfile


VORTEX_PINS = {
    "1fb78b4c3da03acbd50875aae2b7aea437d01337a4c251568ff64e19da197618": "qd29",
    "7aceca49513d6acd4b53c22fdc0be776821ebd0ac7f4764f52f1e41aef18129d": "maid-spells",
}
RPG_PIN = "5c3709b22f1b089ad9f99868f9cc00ff6c2675a563405c5117b651fc71e60b5b"
TARGETER = "io/vortexcore/rpg/SpellbookService$NearbyPlayerTargeter.class"
PARTY = "io/vortexcore/combat/PartySpellTargets"
RPG_CLASSES = ("FortifyDefence", "SkillTransition")


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def package(base, output, changes):
    with zipfile.ZipFile(base) as original, zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as target:
        assert len(original.namelist()) == len(set(original.namelist()))
        for info in original.infolist():
            data = changes[info.filename] if info.filename in changes else original.read(info)
            target.writestr(copy(info), data)
        for name in sorted(changes.keys() - set(original.namelist())):
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(info, changes[name])
    with zipfile.ZipFile(base) as original, zipfile.ZipFile(output) as target:
        for name in target.namelist():
            assert target.read(name) == (changes[name] if name in changes else original.read(name)), name
    return {"baseSha256": digest(base), "sha256": digest(output), "changedEntries": sorted(changes), "file": output.name}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("vortex", "rpg", "server", "jdk", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    args = parser.parse_args()
    parent = VORTEX_PINS.get(digest(args.vortex))
    if not parent or digest(args.rpg) != RPG_PIN or args.server.resolve() in args.output.resolve().parents:
        raise ValueError("Reviewed Vortex and bridge inputs and a separate output directory are required.")
    build = args.output / "build"
    classes = build / "classes"
    classes.mkdir(parents=True)
    root = Path(__file__).resolve().parent
    libraries = sorted((args.server / "libraries").rglob("*.jar"))
    classpath = os.pathsep.join(str(path) for path in (
        classes, args.vortex, args.rpg, args.server / "plugins/Vault-1.7.3.jar", *libraries,
        *sorted((args.server / "versions").rglob("*.jar")),
    ))
    sources = [root / "native-patches" / (PARTY + ".java"), root / "cast-targets/PatchPartySpellTargets.java"]
    sources.extend(root / "src/org/qiandengji/vortex" / (name + ".java") for name in RPG_CLASSES)
    values = ["-proc:none", "-implicit:none", "--release", "21", "-encoding", "UTF-8", "-cp", classpath,
              "-d", classes, *sources]
    argfile = build / "javac.args"
    argfile.write_text("\n".join('"' + str(value).replace("\\", "/") + '"' for value in values), encoding="utf-8")
    subprocess.run([str(args.jdk / "bin/javac.exe"), "-J-Xmx768m", "@" + str(argfile)], check=True)
    with zipfile.ZipFile(args.vortex) as base:
        original = build / "targets.before"
        original.write_bytes(base.read(TARGETER))
        # The published bridge verifies the upstream API version. The separate SHA identifies this fork.
        vortex_descriptor, count = re.subn(rb"(?m)^version:.*$", b"version: 1.2.2-alpha", base.read("plugin.yml"))
        assert count == 1
    patched = build / "targets.after"
    asm = next(path for path in libraries if path.parent.parent.name == "asm" and path.name.startswith("asm-"))
    subprocess.run([str(args.jdk / "bin/java.exe"), "-cp", os.pathsep.join((str(classes), str(asm))),
                    "PatchPartySpellTargets", str(original), str(patched)], check=True)
    vortex_entries = {TARGETER: patched.read_bytes(), PARTY + ".class": (classes / (PARTY + ".class")).read_bytes()}
    if parent == "maid-spells":
        vortex_entries["plugin.yml"] = vortex_descriptor
    vortex = package(args.vortex, args.output / ("VortexRPG-1.2.2-alpha-" + parent + "-party.jar"), vortex_entries)
    with zipfile.ZipFile(args.rpg) as base:
        rpg_descriptor, count = re.subn(rb"(?m)^version: 0\.2\.20\s*$", b"version: 0.2.21-party-support", base.read("plugin.yml"))
        assert count == 1
    rpg_entries = {path.relative_to(classes).as_posix(): path.read_bytes()
                   for path in (classes / "org/qiandengji/vortex").glob("*.class")}
    rpg_entries["plugin.yml"] = rpg_descriptor
    rpg = package(args.rpg, args.output / "QiandengjiRpg-0.2.21-party-support.jar", rpg_entries)
    result = {"vortex": vortex, "rpg": rpg, "productionChanged": False}
    (args.output / "build.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
