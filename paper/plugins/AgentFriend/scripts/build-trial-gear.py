"""Package the trial loot progression on top of the verified trial fire build."""
from importlib.util import module_from_spec, spec_from_file_location
import argparse
import os
from pathlib import Path


TRIAL_FIRE = "7fcff2e8320e3115cfcad80fce29419f5df4ff4f0a32b2dd8bc5bb0c8b00077c"
VERSION = "0.4.47.75-trial-gear"
CLASSES = ("AgentCliCatalog", "AgentCommunication", "AgentFriendPlugin", "DungeonEnchantments", "DungeonLoot", "DungeonManager",
           "TrialRewardPolicy")
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
    if build.digest(args.agentfriend) != TRIAL_FIRE:
        parser.error("AgentFriend must match the verified 0.4.47.74-trial-fire build")
    args.output.mkdir()
    classes = args.output / "classes"
    classpath = os.pathsep.join((str(args.agentfriend), args.classpath_file.read_text(encoding="utf-8-sig").strip()))
    sources = script.parents[1] / "src" / PACKAGE
    build.compile_sources(args.jdk, classes, classpath, [sources / (name + ".java") for name in CLASSES])
    build.package(args.agentfriend, args.output / ("AgentFriend-" + VERSION + ".jar"), classes, PACKAGE, CLASSES, VERSION)


if __name__ == "__main__":
    main()
