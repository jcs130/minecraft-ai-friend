"""Build the companion combat and voice increment over the deployed bridge."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

BASELINE = "23b668b8957c9b335e0347dd1720c87e63d7d1b0245d0b5776e4ca777e9a0c97"
VORTEX = "04489c418211925cbedb2f7d7f40df65ccf53ab2bb03ff8ba8230fbf51a5b223"
VERSION = "0.1.32-adaptive-guard"
PACKAGE = "local/tlmcompat/hybrid/"
CLASSES = ("HybridMaidPlugin", "MaidCompanionActions", "MaidGuardDecision", "MaidGuardLoadout",
           "NativeMaidCompanionSupport", "NativeMaidInventory", "NativeMaidMagicSupport",
           "NativeMaidSpeech", "MaidSpeechVolume", "NativeMaidOwnerTravel")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replaced(name):
    return name.startswith(PACKAGE) and name.endswith(".class") and name[len(PACKAGE):].split("$")[0].removesuffix(".class") in CLASSES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("baseline", "classpath-file", "vortex", "javac", "output"):
        parser.add_argument("--" + flag, type=Path, required=True)
    args = parser.parse_args()
    if digest(args.baseline) != BASELINE or digest(args.vortex) != VORTEX:
        parser.error("Expected the deployed 0.1.31 bridge and Vortex qd29")
    if args.output.exists():
        parser.error("Output already exists")
    root = Path(__file__).parent
    args.output.parent.mkdir(parents=True, exist_ok=True)
    classpath = os.pathsep.join([str(args.baseline.resolve()), str(args.vortex.resolve()),
                                 args.classpath_file.read_text(encoding="utf-8-sig").strip()])
    with tempfile.TemporaryDirectory(dir=args.output.parent) as temp:
        classes = Path(temp) / "classes"
        options = Path(temp) / "javac.args"
        arguments = ["--release", "21", "-encoding", "UTF-8", "-proc:none", "-implicit:none",
                     "-classpath", classpath, "-d", str(classes)]
        arguments.extend(str(root / "hybrid-src" / PACKAGE / (name + ".java")) for name in CLASSES)
        options.write_text("\n".join('"' + value.replace("\\", "/") + '"' for value in arguments), encoding="utf-8")
        subprocess.run([str(args.javac), "@" + str(options)], check=True)
        compiled = {path.relative_to(classes).as_posix(): path.read_bytes() for path in classes.rglob("*.class")}
        assert all(replaced(name) for name in compiled)
        assert all(PACKAGE + name + ".class" in compiled for name in CLASSES)
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output, "x", zipfile.ZIP_DEFLATED) as new:
            for entry in old.infolist():
                name = entry.filename
                if replaced(name):
                    continue
                data = old.read(name)
                if name == "plugin.yml":
                    version = b"version: 0.1.31-vortex-spells"
                    assert data.count(version) == 1
                    data = data.replace(version, b"version: " + VERSION.encode("ascii"), 1)
                new.writestr(entry, data)
            for name, data in sorted(compiled.items()):
                entry = zipfile.ZipInfo(name, (2026, 11, 13, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                new.writestr(entry, data)
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output) as new:
            retained = [n for n in old.namelist() if n != "plugin.yml" and not replaced(n)]
            assert all(old.read(name) == new.read(name) for name in retained)
    print(VERSION, digest(args.output), len(retained), "preserved entries")


if __name__ == "__main__":
    main()
