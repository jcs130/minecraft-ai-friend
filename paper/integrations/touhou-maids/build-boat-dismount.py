"""Build boat exit and consistent partner dialogue over the released bridge."""

import argparse
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import tempfile


BASE_SHA256 = "00812153254a1167885f663bdbad7aca04e3d2df7d30315f9cc85b3ea59fe274"
VERSION = "0.1.44-partner-chat-range"
PACKAGE = "local/tlmcompat/hybrid/"
SOURCES = (
    "HybridMaidPlugin", "MaidBoatExit", "MaidCompanionActions", "NativeMaidFollowSupport",
    "NativeMaidOwnerTravel", "NativeMaidSocialSupport",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("server", "baseline", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    spec = spec_from_file_location("readiness_build", source.parents[1] / "plugins/AgentFriend/scripts/build-dungeon-readiness.py")
    build = module_from_spec(spec)
    spec.loader.exec_module(build)
    if build.digest(args.baseline) != BASE_SHA256:
        parser.error("Expected the reviewed 0.1.42 unified companion bridge")
    if args.output.resolve().is_relative_to(args.server.resolve()):
        parser.error("Build outside the server directory")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    classpath = os.pathsep.join(str(path.resolve()) for path in (
        args.baseline, *args.server.glob("libraries/**/*.jar"),
        *args.server.glob("mods/*.jar"), *args.server.glob("plugins/*.jar"),
    ))
    with tempfile.TemporaryDirectory(prefix="maid-boat-dismount-") as temporary:
        classes = Path(temporary) / "classes"
        sources = [source / "hybrid-src" / PACKAGE / (name + ".java") for name in SOURCES]
        build.compile_sources(args.jdk, classes, classpath, sources)
        build.package(args.baseline, args.output, classes, PACKAGE, SOURCES, VERSION)
    print(json.dumps({"version": VERSION, "baselineSha256": BASE_SHA256, "sha256": build.digest(args.output)}))


if __name__ == "__main__":
    main()
