"""Build the sound-pack bridge on the verified #348 artifact with the server's Java 21 classpath."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

BASE = "1979c7f4af6d029d387778bdf38318f74031b701c86c63b70d8cc6a64af0d367"
FAMILIES = ("HybridMaidPlugin", "NativeMaidBrainSupport", "NativeMaidNearbyChat", "NativeMaidVoices",
            "NativeMaidSpeech", "NativeMaidOwnerTravel", "PersonalMaidDialogue", "MaidPackTtsSite", "MaidSpeechMedia")
PACKAGE = "local/tlmcompat/hybrid/"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--baseline", required=True, type=Path)
    p.add_argument("--classpath-file", required=True, type=Path)
    p.add_argument("--javac", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE:
        p.error("Expected the verified 0.1.56-owner-dialogue baseline")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    prefix = tuple(PACKAGE + name + "$" for name in FAMILIES)
    source = Path(__file__).resolve().parent / "hybrid-src" / PACKAGE
    with tempfile.TemporaryDirectory(dir=args.output.parent) as tmp:
        work = Path(tmp)
        classes = work / "classes"
        classes.mkdir()
        cp = str(args.baseline.resolve()) + os.pathsep + args.classpath_file.read_text(encoding="utf-8-sig").strip()
        options = ["--release", "21", "-encoding", "UTF-8", "-proc:none", "-implicit:none",
                   "-cp", cp, "-d", str(classes), *[str(source / (name + ".java")) for name in FAMILIES]]
        argfile = work / "javac.args"
        argfile.write_text("\n".join('"' + item.replace("\\", "/") + '"' for item in options), encoding="utf8")
        subprocess.run([str(args.javac), "@" + str(argfile)], check=True)
        with zipfile.ZipFile(args.baseline) as jar:
            entries = {name: jar.read(name) for name in jar.namelist() if not name.startswith(prefix)}
        built = {f.relative_to(classes).as_posix(): f.read_bytes() for f in classes.rglob("*.class")}
        owned = {PACKAGE + name + ".class" for name in FAMILIES}
        if not owned.issubset(built) or any(name not in owned and not name.startswith(prefix) for name in built):
            raise ValueError("Unexpected class family")
        entries.update(built)
        if entries["plugin.yml"].count(b"0.1.56-owner-dialogue") != 1:
            raise ValueError("Unexpected plugin descriptor")
        entries["plugin.yml"] = entries["plugin.yml"].replace(b"0.1.56-owner-dialogue", b"0.1.57-sound-pack-dialogue")
        with zipfile.ZipFile(args.output, "x", compression=zipfile.ZIP_DEFLATED) as jar:
            for name, data in sorted(entries.items()):
                jar.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), data, compress_type=zipfile.ZIP_DEFLATED)
    print(hashlib.sha256(args.output.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
