"""Build the reviewed native-body activities over the released bridge."""

import argparse
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import tempfile


BASE_SHA256 = "a97a029916dbbb973482f5506d87e6642342233b19652796ddc3955223fa519c"
VERSION = "0.1.52-mod-combat"
PACKAGE = "local/tlmcompat/hybrid/"
SOURCES = (
    "HybridMaidPlugin", "MaidBodyControl", "MaidCompanionActions", "MaidGuardLoadout",
    "NativeMaidAgentSupport", "NativeMaidBodyActions", "NativeMaidBodyPort",
    "NativeMaidInventory", "NativeMaidKit", "NativeMaidWorkshop",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("server", "baseline", "resident-bridge", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    script = source.parents[1] / "plugins/AgentFriend/scripts/build-dungeon-readiness.py"
    spec = spec_from_file_location("readiness_build", script)
    build = module_from_spec(spec)
    spec.loader.exec_module(build)
    if build.digest(args.baseline) != BASE_SHA256:
        parser.error("Expected the reviewed 0.1.49 natural dialogue bridge")
    if args.output.exists() or args.output.resolve().is_relative_to(args.server.resolve()):
        parser.error("Choose a new output outside the server directory")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    classpath = os.pathsep.join(str(path.resolve()) for path in (
        args.baseline, args.resident_bridge, *args.server.glob("libraries/**/*.jar"),
        *args.server.glob("mods/*.jar"), *args.server.glob("plugins/*.jar"),
    ))
    with tempfile.TemporaryDirectory(prefix="maid-body-activities-") as temporary:
        classes = Path(temporary) / "classes"
        sources = [source / "hybrid-src" / PACKAGE / (name + ".java") for name in SOURCES]
        build.compile_sources(args.jdk, classes, classpath, sources)
        build.package(args.baseline, args.output, classes, PACKAGE, SOURCES, VERSION)
    print(json.dumps({"version": VERSION, "baselineSha256": BASE_SHA256, "sha256": build.digest(args.output)}))


if __name__ == "__main__":
    main()
