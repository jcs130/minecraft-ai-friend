"""Build world-wide character navigation over the released selected-sound-pack bridge."""

import argparse
import os
import runpy
import tempfile
from pathlib import Path

BASE = "7786be1c30dfbc6239c9adf4fae5affbc6f1d73952078f328be542784ea73fd6"
PACKAGE = "local/tlmcompat/hybrid/"
VERSION = "0.1.59-character-rendezvous"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "classpath-file", "jdk", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    build = runpy.run_path(str(here.parents[1] / "plugins/AgentFriend/scripts/build-dungeon-readiness.py"))
    if build["digest"](args.baseline) != BASE or args.output.exists():
        parser.error("Expected the 0.1.57 sound-pack baseline and a new output path")
    families = ("HybridMaidPlugin", "MaidBodyControl", "NativeMaidBodyActions", "NativeMaidCompanionSupport",
                "NativeMaidMagicSupport", "NativeMaidRendezvous")
    sources = [here / "hybrid-src" / PACKAGE / (name + ".java") for name in families]
    classpath = str(args.baseline.resolve()) + os.pathsep + args.classpath_file.read_text(encoding="utf-8-sig").strip()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as scratch:
        classes = Path(scratch) / "classes"
        build["compile_sources"](args.jdk, classes, classpath, sources)
        build["package"](args.baseline, args.output, classes, PACKAGE, families, VERSION)


if __name__ == "__main__":
    main()
