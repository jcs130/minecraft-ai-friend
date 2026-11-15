"""Reproduce deployed .78 classes, then apply only the public-entrance fix."""
from pathlib import Path
import argparse
import json
import subprocess
import zipfile
from importlib.util import module_from_spec, spec_from_file_location


def load(name, path):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "classpath-file", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    builder = load("builder", Path(__file__).with_name("build-dungeon-readiness.py"))
    delta = load("navigation", Path(__file__).with_name("build-player-navigation.py")).delta
    assert builder.digest(args.baseline) == "247aaedca90905ded41aff8afc36f47022736e6626b4e5276c5732c39cf25eef"
    args.output.mkdir(parents=True)
    repo = Path(__file__).resolve().parents[4]
    prefix = "org/afuhome/agentfriend/"
    owners = ("AgentFriendPlugin", "WaypointManager")
    old, new = args.output / "baseline-source", args.output / "candidate-source"
    old.mkdir()
    new.mkdir()
    cp = str(args.baseline.resolve()) + ";" + args.classpath_file.read_text(encoding="utf-8-sig").strip()
    for name in owners:
        relative = "paper/plugins/AgentFriend/src/" + prefix + name + ".java"

        def source(ref):
            return subprocess.check_output(["git", "-C", str(repo), "show", ref + ":" + relative]).decode("utf8").replace("\r\n", "\n")

        baseline = delta(source("58b417c9"), source("8ed2eb9a"), source("c3d90c91"))
        if name == "AgentFriendPlugin":
            baseline = delta(baseline, source("218633f1"), source("46d6714d"))
        (old / (name + ".java")).write_text(baseline, encoding="utf8")
        candidate = delta(baseline, source("91890e88"), (repo / relative).read_text(encoding="utf8"))
        (new / (name + ".java")).write_text(candidate, encoding="utf8")
    builder.compile_sources(args.jdk, args.output / "baseline-classes", cp, list(old.glob("*.java")))
    with zipfile.ZipFile(args.baseline) as jar:
        for file in (args.output / "baseline-classes").rglob("*.class"):
            assert jar.read(file.relative_to(args.output / "baseline-classes").as_posix()) == file.read_bytes(), "Baseline mismatch: " + file.name
    builder.compile_sources(args.jdk, args.output / "classes", cp, list(new.glob("*.java")))
    version = "0.4.47.79-public-trial-travel"
    artifact = args.output / ("AgentFriend-" + version + ".jar")
    builder.package(args.baseline, artifact, args.output / "classes", prefix, owners, version)
    (args.output / "build.json").write_text(json.dumps({
        "baselineSha256": builder.digest(args.baseline), "candidateSha256": builder.digest(artifact),
        "baselineSourceMatches": True, "changedOwners": owners, "productionChanged": False,
    }, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
