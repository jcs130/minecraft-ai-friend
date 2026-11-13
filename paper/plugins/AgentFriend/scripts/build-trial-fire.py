"""Package the trial fire fix over the verified companion-dungeons build."""
from importlib.util import module_from_spec, spec_from_file_location
import argparse
import os
from pathlib import Path


BASE = "2b5e28435f1dab24a34598af386bff535cbdd9be3c74c2e2e058591da7b5cd1b"
VERSION = "0.4.47.74-trial-fire"
CLASSES = ("DungeonManager", "FrostControl", "SpellGuide")
PACKAGE = "org/afuhome/agentfriend/"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("agentfriend", "classpath-file", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    script = Path(__file__).resolve()
    spec = spec_from_file_location("readiness_build", script.with_name("build-dungeon-readiness.py"))
    build = module_from_spec(spec)
    spec.loader.exec_module(build)
    if build.digest(args.agentfriend) != BASE:
        parser.error("AgentFriend must match the verified 0.4.47.73-companion-dungeons build")
    args.output.mkdir()
    sources = script.parents[1] / "src" / PACKAGE
    classes = args.output / "classes"
    classpath = os.pathsep.join((str(args.agentfriend), args.classpath_file.read_text(encoding="utf-8-sig").strip()))
    build.compile_sources(args.jdk, classes, classpath, [sources / (name + ".java") for name in CLASSES])
    build.package(args.agentfriend, args.output / ("AgentFriend-" + VERSION + ".jar"), classes, PACKAGE, CLASSES, VERSION)


if __name__ == "__main__":
    main()
