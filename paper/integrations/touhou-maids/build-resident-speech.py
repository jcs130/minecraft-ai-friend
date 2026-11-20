"""Package scoped social speech on the existing sound-pack bridge."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import os
from pathlib import Path
from tempfile import TemporaryDirectory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("server", "jdk", "baseline", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    spec = spec_from_file_location("bridge_build", root.parents[1] / "plugins/AgentFriend/scripts/build-dungeon-readiness.py")
    build = module_from_spec(spec)
    spec.loader.exec_module(build)
    if build.digest(args.baseline) != "7786be1c30dfbc6239c9adf4fae5affbc6f1d73952078f328be542784ea73fd6":
        parser.error("Expected the 0.1.57-sound-pack-dialogue bridge")
    if args.output.resolve().is_relative_to(args.server.resolve()) or args.output.exists():
        parser.error("Choose a new output JAR outside the running server")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    classpath = os.pathsep.join(str(path.resolve()) for path in [args.baseline, *args.server.glob("libraries/**/*.jar"),
                                        *args.server.glob("mods/*.jar"), *args.server.glob("plugins/*.jar")])
    families = ("HybridMaidPlugin", "NativeMaidVoices", "NativeMaidSpeech")
    package = "local/tlmcompat/hybrid/"
    with TemporaryDirectory(dir=args.output.parent) as temp:
        classes = Path(temp) / "classes"
        build.compile_sources(args.jdk, classes, classpath, [root / "hybrid-src" / package / (name + ".java") for name in families])
        build.package(args.baseline, args.output, classes, package, families, "0.1.58-resident-speech")
    print(f"{args.output} sha256={build.digest(args.output)}")


if __name__ == "__main__":
    main()
