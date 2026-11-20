"""Build the compass directory and ordinary teammate spell increment on the reviewed game JAR."""
import argparse
import os
from pathlib import Path
import runpy
import tempfile

BASE = "c866fe087da112eff6284b4fb4edd8bc761063e1f2df8f5d37cc7b8710e1864c"
VERSION = "0.4.54-character-rendezvous"
FAMILIES = ("AgentFriendPlugin", "AgentCliCatalog", "AgentCliRecovery", "AgentCliRecoveryService",
            "AgentCliText", "CharacterLocationAccess", "DungeonManager", "MaidRendezvousAccess", "SpellGuide", "TeammateDirectory", "TravelMagic")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "server", "jdk", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    build = runpy.run_path(str(root / "scripts/build-dungeon-readiness.py"))
    if build["digest"](args.baseline) != BASE or args.output.exists() or args.output.resolve().is_relative_to(args.server.resolve()):
        parser.error("Expected the current 0.4.53 baseline and a new external output JAR")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    prefix = "org/afuhome/agentfriend/"
    cp = [args.baseline, args.server / "versions/1.21.1/paper-1.21.1.jar",
          *sorted((args.server / "libraries").rglob("*.jar")), *sorted((args.server / "plugins").glob("*.jar"))]
    with tempfile.TemporaryDirectory(dir=args.output.parent) as scratch:
        classes = Path(scratch) / "classes"
        build["compile_sources"](args.jdk, classes, os.pathsep.join(str(p.resolve()) for p in cp),
                                 [root / "src" / prefix / (name + ".java") for name in FAMILIES])
        build["package"](args.baseline, args.output, classes, prefix, FAMILIES, VERSION,
                         {"config.yml": root / "resources/config.yml"})


if __name__ == "__main__":
    main()
