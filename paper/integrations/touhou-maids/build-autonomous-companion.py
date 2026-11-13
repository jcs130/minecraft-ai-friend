"""Build the autonomous mode update on the validated owner-recall bridge."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "classpath-file", "vortex", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    spec = spec_from_file_location("readiness_build", source.parents[1] / "plugins/AgentFriend/scripts/build-dungeon-readiness.py")
    build = module_from_spec(spec)
    spec.loader.exec_module(build)
    if build.digest(args.baseline) != "ac8a59042678dd48f7373855559c2f913642a6f5b4855f4f70ea56a5d2cbbced":
        parser.error("Expected the validated 0.1.33 owner-recall artifact")
    if build.digest(args.vortex) != build.VORTEX:
        parser.error("Expected the verified Vortex qd29 artifact")
    args.output.mkdir()
    names = ("HybridMaidPlugin", "MaidCompanionActions", "NativeMaidCompanionSupport", "NativeMaidSocialSupport")
    package = "local/tlmcompat/hybrid/"
    classpath = os.pathsep.join((str(args.baseline.resolve()), str(args.vortex.resolve()),
                                args.classpath_file.read_text(encoding="utf-8-sig").strip()))
    classes = args.output / "classes"
    build.compile_sources(args.jdk, classes, classpath,
                          [source / "hybrid-src" / package / (name + ".java") for name in names])
    build.package(args.baseline, args.output / "QiandengjiMaidBridge-0.1.34-autonomous-companion.jar",
                  classes, package, names, "0.1.34-autonomous-companion")


if __name__ == "__main__":
    main()
