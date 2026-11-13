"""Package the companion guard and recall update over the installed binaries."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import os
from pathlib import Path

AF = "bd65dcca4fe65c7a7f09fa10f3115b02af13bdbd149b756cef39f1d50ae694ec"
MAID = "b90611afb606a6584f55ebf7c0d6f8ed29f61e7a9fadd000f4bc6d4e8e767d17"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("agentfriend", "maid", "vortex", "af-classpath-file", "maid-classpath-file", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    script = Path(__file__).resolve()
    spec = spec_from_file_location("readiness_build", script.with_name("build-dungeon-readiness.py"))
    build = module_from_spec(spec)
    spec.loader.exec_module(build)
    if tuple(build.digest(path) for path in (args.agentfriend, args.maid, args.vortex)) != (AF, MAID, build.VORTEX):
        parser.error("The installed AgentFriend, maid bridge and Vortex binaries must match the release baseline")
    args.output.mkdir()

    paper = script.parents[3]
    releases = (
        (args.agentfriend, args.af_classpath_file, paper / "plugins/AgentFriend/src", "org/afuhome/agentfriend/",
         ("CompanionTravelAccess", "DungeonManager", "SiteDungeonManager"), "AgentFriend", "0.4.47.73-companion-dungeons"),
        (args.maid, args.maid_classpath_file, paper / "integrations/touhou-maids/hybrid-src", "local/tlmcompat/hybrid/",
         ("HybridMaidPlugin", "NativeMaidAgentSupport", "NativeMaidCompanionSupport", "NativeMaidFollowSupport",
          "NativeMaidMagicSupport", "NativeMaidOwnerTravel", "NativeMaidResidence", "NativeMaidTransport"),
         "QiandengjiMaidBridge", "0.1.33-owner-recall"),
    )
    for base, classpath_file, sources, package, names, plugin, version in releases:
        classpath = os.pathsep.join((str(base), str(args.vortex), classpath_file.read_text(encoding="utf-8-sig").strip()))
        classes = args.output / (plugin + "-classes")
        build.compile_sources(args.jdk, classes, classpath, [sources / package / (name + ".java") for name in names])
        build.package(base, args.output / (plugin + "-" + version + ".jar"), classes, package, names, version)


if __name__ == "__main__":
    main()
