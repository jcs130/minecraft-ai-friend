"""Build the two BossBar patches from the pinned production JARs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

TARGETS = [
    ("AgentFriend-0.4.47.50-rpg.jar", "AgentFriend-0.4.47.53-rpg.jar",
     "0dc196397e20f56dda53adebc6b76ba0c8e48d066af34f701e967f4bd8bc69cc",
     "0.4.47.52-rpg", "0.4.47.53-rpg", "AgentFriend", "org/afuhome/agentfriend", ["DungeonManager"]),
    ("CortiEyeMirror-0.1.17.jar", "CortiEyeMirror-0.1.18.jar",
     "628242d9b46b2be68037a656986c1ac1274b6a876190451a37d7e85bb8d92f51",
     "0.1.17", "0.1.18", "CortiEyeMirror", "org/afuhome/cortieye",
     ["AdditionalEyeMirrors", "CortiEyeMirrorPlugin", "EyeBossBars"]),
]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def owned(name, package, owners):
    return (name.startswith(package + "/") and name.endswith(".class")
            and name.rsplit("/", 1)[1].removesuffix(".class").split("$", 1)[0] in owners)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("server", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    server, output = args.server.absolute(), args.output.resolve()
    if output.is_relative_to(server.resolve()):
        raise ValueError("Use an output directory outside the server")
    output.mkdir(parents=True)
    empty = output / "empty"
    empty.mkdir()
    java = args.jdk / "bin" / ("javac.exe" if os.name == "nt" else "javac")
    plugins = server / "plugins"
    libs = sorted((server / "libraries").rglob("*.jar"))
    dependencies = sorted(plugins.glob("*.jar"))
    root = Path(__file__).resolve().parents[1] / "plugins"
    receipts = []
    for name, out_name, digest, old, new, module, package, owners in TARGETS:
        baseline = plugins / name
        if sha(baseline) != digest:
            raise ValueError(f"Unexpected baseline for {name}")
        classes = output / module
        classes.mkdir()
        cp = os.pathsep.join(map(str, [baseline, *libs, *dependencies]))
        files = [root / module / "src" / package / (owner + ".java") for owner in owners]
        options = ["--release", "21", "-proc:none", "-implicit:none", "-encoding", "UTF-8",
                   "-sourcepath", str(empty), "-cp", cp, "-d", str(classes), *map(str, files)]
        argfile = output / (module + ".args")
        argfile.write_text("\n".join('"' + token.replace("\\", "/") + '"' for token in options), encoding="utf-8")
        subprocess.run([str(java), "@" + str(argfile)], check=True)
        updates = {file.relative_to(classes).as_posix(): file.read_bytes() for file in classes.rglob("*.class")}
        if not updates or not all(owned(file, package, owners) for file in updates):
            raise RuntimeError(f"Unexpected classes for {module}")
        target = output / out_name
        with zipfile.ZipFile(baseline) as before:
            metadata = before.read("plugin.yml")
            if metadata.count(old.encode()) != 1:
                raise ValueError(f"Unexpected metadata for {module}")
            updates["plugin.yml"] = metadata.replace(old.encode(), new.encode())
            entries = set(before.namelist())
            if {file for file in entries if owned(file, package, owners)} - updates.keys():
                raise RuntimeError(f"Missing original class from {module}")
            with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as after:
                for entry in before.infolist():
                    after.writestr(entry, updates[entry.filename] if entry.filename in updates else before.read(entry))
                for entry in sorted(updates.keys() - entries):
                    after.writestr(entry, updates[entry])
        with zipfile.ZipFile(baseline) as before, zipfile.ZipFile(target) as after:
            changed = [file for file in before.namelist() if before.read(file) != after.read(file)]
            added = sorted(set(after.namelist()) - set(before.namelist()))
            if not set(changed + added) <= updates.keys():
                raise RuntimeError("Unexpected archive entry changes")
            receipts.append({"candidate": out_name, "baseline": name, "baselineSha256": digest,
                             "sha256": sha(target), "changed": changed, "added": added,
                             "unchanged": len(before.namelist()) - len(changed)})
    result = {"passed": True, "productionChanged": False, "artifacts": receipts}
    (output / "build.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))

if __name__ == "__main__":
    main()
