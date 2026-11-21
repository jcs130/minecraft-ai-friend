"""Build the reviewed guide classes over the two pinned server plugin artifacts."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
MAID_CLASSES = (
    "CompanionRespawn", "GuideCompanions", "HybridMaidPlugin", "MaidBodyControl",
    "NativeMaidBodyPort", "NativeMaidKit", "NativeMaidNearbyChat", "NativeMaidSpeech", "NativeMaidVoices",
)
MAID_BASELINE = "c5665cf43af340a2533995486a28c30008afa8e09a3a2f881771bb196183bf3d"
RPG_BASELINE = "e594ca14aa380f248cc89e3747dd1e8e8e4d2ae1f71b84fbef5fa918f54bea34"


def build(args, baseline, digest, package, sources, classes, output, version):
    if hashlib.sha256(baseline.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Unexpected baseline for {baseline.name}")
    if baseline.resolve() == output.resolve():
        raise ValueError("Output is the installed baseline")
    with tempfile.TemporaryDirectory(dir=args.output_dir, prefix="guide-classes-") as scratch:
        work = Path(scratch)
        compiled = work / "classes"
        classpath = os.pathsep.join((str(baseline.resolve()), str(args.brain.resolve()),
                                    args.classpath_file.read_text(encoding="utf-8-sig").strip()))
        command = ["--release", "21", "-encoding", "UTF-8", "-proc:none", "-classpath",
                   classpath, "-d", str(compiled), *(str(sources / f"{name}.java") for name in classes)]
        argument_file = work / "javac.args"
        argument_file.write_text("\n".join('"' + option.replace("\\", "/") + '"' for option in command), encoding="utf-8")
        subprocess.run([str(args.javac), f"@{argument_file}"], check=True)
        changed = {f.relative_to(compiled).as_posix(): f.read_bytes() for f in compiled.rglob("*.class")}
        old_types = tuple(f"{package}/{name}" for name in classes)
        if not all(f"{name}.class" in changed for name in old_types):
            raise ValueError("Expected classes were not built")
        with zipfile.ZipFile(baseline) as old, zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as new:
            for entry in old.infolist():
                if any(entry.filename == name + ".class" or entry.filename.startswith(name + "$") for name in old_types):
                    continue
                contents = old.read(entry)
                if entry.filename == "plugin.yml":
                    lines = contents.decode("utf-8").splitlines()
                    if sum(line.startswith("version:") for line in lines) != 1:
                        raise ValueError("Expected a single plugin version")
                    contents = ("\n".join("version: " + version if line.startswith("version:") else line for line in lines) + "\n").encode()
                new.writestr(entry, contents)
            for name, contents in sorted(changed.items()):
                entry = zipfile.ZipInfo(name, (2026, 11, 22, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                new.writestr(entry, contents)
    print(hashlib.sha256(output.read_bytes()).hexdigest(), output.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("bridge-baseline", "rpg-baseline", "brain", "classpath-file", "javac", "output-dir"):
        parser.add_argument("--" + option, type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    package = "local/tlmcompat/hybrid"
    build(args, args.bridge_baseline, MAID_BASELINE, package, ROOT / "hybrid-src" / package, MAID_CLASSES,
          args.output_dir / "qiandengji-maid-0.1.62-player-guides.jar", "0.1.62-player-guides")
    package = "org/qiandengji/vortex"
    build(args, args.rpg_baseline, RPG_BASELINE, package, ROOT.parent / "vortex-rpg/src" / package, ("ResidentRpgApi",),
          args.output_dir / "QiandengjiRpg-0.2.33-player-guides.jar", "0.2.33-player-guides")


if __name__ == "__main__":
    main()
