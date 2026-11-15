"""Build two pinned observer JAR overlays without changing the running server."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile


UPSTREAM = "ddc5aec185a59bfa8ecb6c12793a3262da6ee0d5"
SCREEN = "com/hpfxd/spectatorplus/paper/sync/handler/screen/ScreenSyncHandler"
SCREEN_SOURCE = "paper/src/main/java/" + SCREEN + ".java"
BASELINES = {
    "CortiEyeMirror-0.1.19.jar": "1fa97aa995597e76f64386bae2566bb77535b09fba095705385eb4131c4bbfe9",
    "spectatorplus-paper-1.2.1.jar": "95faff5336fdd265202e1589f39338f06cd6c4de788eeedd94164ec4cb2c92d2",
}


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def build_overlay(base, output, classpath, javac, sources, families, version, metadata, work):
    classes = work / "classes"
    classes.mkdir()
    options = ["-proc:none", "-encoding", "UTF-8", "--release", "21", "-cp",
               os.pathsep.join(str(path) for path in classpath), "-d", str(classes)]
    options.extend(str(path) for path in sources)
    arguments = work / "javac.args"
    arguments.write_text("\n".join('"' + option.replace("\\", "/") + '"' for option in options), "utf-8")
    subprocess.run([str(javac), "@" + str(arguments)], check=True)

    def owns(name):
        return any(name == family + ".class" or name.startswith(family + "$") for family in families)

    replacements = {path.relative_to(classes).as_posix(): path.read_bytes() for path in classes.rglob("*.class")}
    if not all(owns(name) for name in replacements) or not all(f + ".class" in replacements for f in families):
        raise RuntimeError("Compiler output did not match the reviewed classes")
    with zipfile.ZipFile(base) as original:
        preserved = {name: original.read(name) for name in original.namelist() if not owns(name) and name != metadata}
        header, count = re.subn(rb'(?m)^version: [^\r\n]+', f'version: "{version}"'.encode(), original.read(metadata))
    if count != 1:
        raise RuntimeError("Plugin version metadata changed")
    entries = preserved | replacements | {metadata: header}
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, value in sorted(entries.items()):
            entry = zipfile.ZipInfo(name, (2026, 11, 16, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, value)
    with zipfile.ZipFile(output) as archive:
        if any(archive.read(name) != value for name, value in preserved.items()):
            raise RuntimeError("Unrelated plugin entries changed")
    return {"version": version, "sha256": digest(output), "beforeSha256": BASELINES[base.name],
            "preservedEntries": len(preserved)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("server", "jdk", "upstream", "output"):
        parser.add_argument("--" + name, type=lambda value: Path(value).resolve(), required=True)
    args = parser.parse_args()
    if args.output.is_relative_to(args.server):
        parser.error("Build outside of the server")
    plugins = args.server / "plugins"
    for name, expected in BASELINES.items():
        if digest(plugins / name) != expected:
            parser.error(f"Unreviewed base JAR: {name}")
    classpath = [args.server / "versions/1.21.1/paper-1.21.1.jar"]
    classpath += [plugins / name for name in (*BASELINES, "ProtocolLib-5.3.0.jar", "AuraSkills-2.4.0.jar")]
    classpath += sorted((args.server / "libraries").rglob("*.jar"))
    if not all(path.is_file() for path in classpath):
        parser.error("Incomplete server compile dependencies")
    javac = args.jdk / "bin" / ("javac.exe" if os.name == "nt" else "javac")
    paper = Path(__file__).resolve().parents[1]
    pkg = "org/afuhome/cortieye/"
    eye = tuple(pkg + name for name in ("CortiEyeMirrorPlugin", "AdditionalEyeMirrors", "EyePresentationPacket"))
    args.output.mkdir(parents=True, exist_ok=False)

    with tempfile.TemporaryDirectory(prefix="observer-build-") as directory:
        work = Path(directory)
        source = work / SCREEN_SOURCE
        source.parent.mkdir(parents=True)
        source.write_bytes(subprocess.check_output(["git", "-C", str(args.upstream), "show", UPSTREAM + ":" + SCREEN_SOURCE]))
        patch = paper / "ops/patches/spectatorplus-1.2.1-screen-target.patch"
        subprocess.run(["git", "apply", "--unidiff-zero", str(patch)], cwd=work, check=True)
        spectator, eye_work = work / "spectator", work / "eye"
        spectator.mkdir()
        eye_work.mkdir()
        report = {
            "spectatorPlus": build_overlay(plugins / "spectatorplus-paper-1.2.1.jar", args.output / "SpectatorPlus.jar",
                                           classpath, javac, [source], (SCREEN,), "1.2.1-qd-screen-target",
                                           "paper-plugin.yml", spectator),
            "eye": build_overlay(plugins / "CortiEyeMirror-0.1.19.jar", args.output / "CortiEyeMirror.jar",
                                 classpath, javac, [paper / ("plugins/CortiEyeMirror/src/" + family + ".java") for family in eye],
                                 eye, "0.1.22-native-presentation", "plugin.yml", eye_work),
        }
    record = json.dumps(report, indent=2) + "\n"
    (args.output / "build.json").write_text(record, "utf-8")
    print(record, end="")


if __name__ == "__main__":
    main()
