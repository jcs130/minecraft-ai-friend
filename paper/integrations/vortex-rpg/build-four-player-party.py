"""Build a new four-player party candidate from frozen cooperation inputs. Never installs anything."""
import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path


def build(server, native, bridge, friend, jdk, output):
    here = Path(__file__).resolve().parent
    paper = here.parents[1]
    inputs = {"native": Path(native), "bridge": Path(bridge), "friend": Path(friend)}
    pins = {"native": "47bb884059ff15af6e3286727587256ea4ff34b2386bf91aa2f0d2e1dd2a7a56",
            "bridge": "3ecd856c78c72b092658b2a2aee7b57c19e98ca7ac706c06d6f2c21da00d28f6",
            "friend": "56a6a768cb45dbbe79fd76f6a21c443b2594c9bd0f7c5f091e07104d0ace8bbb"}
    def digest(path):
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if any(digest(inputs[key]) != expected for key, expected in pins.items()):
        raise ValueError("four_party_base_changed: review and rebase explicitly; no artifact was written")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    classes = output / "classes"
    classes.mkdir()
    libraries = [*Path(server).glob("libraries/**/*.jar"), *inputs.values()]
    cp = os.pathsep.join(map(str, [classes, *libraries]))
    suffix = ".exe" if os.name == "nt" else ""
    jdk = Path(jdk)

    def args_file(name, values):
        path = output / (name + ".args")
        path.write_text("\n".join('"' + str(value).replace("\\", "/") + '"' for value in values), encoding="utf-8")
        return "@" + str(path)

    source = here / "src/org/qiandengji/vortex"
    catalog = paper / "plugins/AgentFriend/src/org/afuhome/agentfriend/AgentCliCatalog.java"
    sources = [source / (name + ".java") for name in ["NativeParties", "NativePartyView", "PartyFormation"]]
    sources += [catalog, paper / "ops/patches/CompassMethodPatch.java"]
    subprocess.run([str(jdk / ("bin/javac" + suffix)), args_file("compile", [
        "-proc:none", "-implicit:none", "--release", "21", "-encoding", "UTF-8", "-cp", cp,
        "-d", classes, *sources])], check=True, timeout=120)
    entry = "org/afuhome/agentfriend/AgentCliCatalog.class"
    original = output / "catalog.before"
    with zipfile.ZipFile(inputs["friend"]) as archive:
        original.write_bytes(archive.read(entry))
    patched = output / "catalog.patched.class"
    proof = subprocess.check_output([str(jdk / ("bin/java" + suffix)), args_file("patch", [
        "-ea", "-cp", cp, "CompassMethodPatch", original, classes / entry, patched,
        "createSpecs|catalogSpecs"])], text=True, encoding="utf-8", timeout=60)
    report = {"productionChanged": False, "installed": False, "baseSha256": pins,
              "sourceSha256": {str(path.relative_to(paper)): digest(path) for path in sources},
              "catalogPatch": json.loads(proof), "artifacts": {}}

    def package(kind, filename, version, changes):
        target = output / filename
        with zipfile.ZipFile(inputs[kind]) as old:
            descriptor, count = re.subn(rb"(?m)^version:.*$", ("version: " + version).encode(), old.read("plugin.yml"))
            if count != 1:
                raise ValueError("invalid_base_plugin_descriptor")
            changes["plugin.yml"] = descriptor
            with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as new:
                for info in old.infolist():
                    new.writestr(copy.copy(info), changes.get(info.filename, old.read(info.filename)))
                for name, data in changes.items():
                    if name not in old.namelist():
                        new.writestr(name, data)
        with zipfile.ZipFile(inputs[kind]) as old, zipfile.ZipFile(target) as new:
            changed = {name for name in new.namelist() if name not in old.namelist() or new.read(name) != old.read(name)}
            if changed != set(changes):
                raise ValueError("unrelated_jar_entries_changed")
        report["artifacts"][kind] = {"file": filename, "sha256": digest(target), "changedEntries": sorted(changed)}

    owners = ["NativeParties", "NativePartyView", "PartyFormation", "PartyFormation$Actor", "PartyFormation$Team", "PartyFormation$Invitation"]
    package("bridge", "QiandengjiRpg-0.2.15-party4.jar", "0.2.15-party4", {
        "org/qiandengji/vortex/" + owner + ".class": (classes / ("org/qiandengji/vortex/" + owner + ".class")).read_bytes()
        for owner in owners})
    package("friend", "AgentFriend-0.4.47.40-party4.jar", "0.4.47.40-party4", {entry: patched.read_bytes()})
    # Native manager, original resources, configs and player state are not copied or modified.
    (output / "build.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("server", "native", "bridge", "friend", "jdk", "output"):
        parser.add_argument("--" + field, type=Path, required=True)
    print(json.dumps(build(**vars(parser.parse_args()))))
