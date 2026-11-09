"""Make a narrow candidate from a verified deployed-base copy and compiled source.

This reads JARs only. It never discovers a live server or installs/restarts one.
All unrelated entries, including resources and patched classes, are preserved.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import zipfile


FAMILIES = ("DungeonEnchantments", "DungeonLoot", "DungeonManager", "ItemAppearances")
PREFIX = "org/afuhome/agentfriend/"


def selected(name):
    return any(name == PREFIX + family + ".class" or
               name.startswith(PREFIX + family + "$") and name.endswith(".class")
               for family in FAMILIES)


def package(base: Path, compiled: Path, output: Path, version: str):
    base, compiled, output = base.resolve(), compiled.resolve(), output.resolve()
    if output in (base, compiled) or output.exists():
        raise ValueError("Use a new output file, separate from both input JARs")
    if not re.fullmatch(r"[0-9][A-Za-z0-9_.+-]{0,95}", version):
        raise ValueError("Use a bounded ASCII plugin version")
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    with zipfile.ZipFile(base) as old, zipfile.ZipFile(compiled) as source:
        for jar in (old, source):
            if len(jar.namelist()) != len(set(jar.namelist())):
                raise ValueError("Ambiguous duplicate JAR entries")
        if any(PREFIX + family + ".class" not in source.namelist() for family in FAMILIES):
            raise ValueError("Missing required compiled class family")
        if any(name not in source.namelist() for name in old.namelist() if selected(name)):
            raise ValueError("Compiled source unexpectedly removes a deployed class")
        metadata, count = re.subn(rb"(?m)^version:.*$", ("version: " + version).encode(),
                                  old.read("plugin.yml"), count=1)
        if count != 1:
            raise ValueError("Missing deployed plugin version")
        with zipfile.ZipFile(output, "w") as result:
            for item in old.infolist():
                data = source.read(item.filename) if selected(item.filename) else old.read(item.filename)
                if item.filename == "plugin.yml":
                    data = metadata
                result.writestr(copy.copy(item), data)
            for name in source.namelist():
                if selected(name) and name not in old.namelist():
                    result.writestr(copy.copy(source.getinfo(name)), source.read(name))
        with zipfile.ZipFile(output) as result:
            names = set(old.namelist()) | set(result.namelist())
            changed = [n for n in sorted(names) if n not in old.namelist() or
                       n not in result.namelist() or old.read(n) != result.read(n)]
            if not all(selected(n) or n == "plugin.yml" for n in changed):
                raise AssertionError("Unrelated deployed entry changed")
    return {"baseSha256": digest(base), "candidateSha256": digest(output),
            "changedEntries": changed, "unchangedEntries": len(names) - len(changed),
            "allOtherEntriesIdentical": True, "installsFiles": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--compiled", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.base, args.compiled, args.output, args.version)))
