"""Rebuild the changed .81 owners before creating the isolated Lost Beacon candidate."""
from pathlib import Path
import argparse
import importlib.util
import json
import subprocess
import zipfile

BASELINE = "df8010b3a318ec8e47943aa77842f403496d1bca7c54229d788a8268561e4b62"
SOURCE = "6c1952230f29ea4bd05c4c2395578552b6b3ffb6"
VERSION = "0.4.47.82-lost-beacon"
PREFIX = "org/afuhome/agentfriend/"
CHANGED = ("SiteDungeonManager", "DungeonAdvice", "AgentFriendPlugin", "AgentCliCatalog")
ADDED = ("BeaconExpedition",)


def load_helper(filename):
    spec = importlib.util.spec_from_file_location(filename, Path(__file__).with_name(filename + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("baseline", "platform-sources", "classpath-file", "jdk", "output"):
        parser.add_argument("--" + option, type=Path, required=True)
    args = parser.parse_args()
    builder = load_helper("build-dungeon-readiness")
    delta = load_helper("build-player-navigation").delta
    if builder.digest(args.baseline) != BASELINE:
        raise ValueError("Unexpected .81 baseline")
    root = Path(__file__).resolve().parents[4]
    output = args.output.resolve()
    if output.is_relative_to(args.baseline.resolve().parent):
        raise ValueError("Output must be outside supplied server")
    output.mkdir(parents=True, exist_ok=False)
    before = output / "baseline-source"
    after = output / "candidate-source"
    before.mkdir()
    after.mkdir()
    prefix = "paper/plugins/AgentFriend/src/" + PREFIX
    for name in CHANGED:
        relative = prefix + name + ".java"
        repository_source = subprocess.check_output(["git", "-C", str(root), "show", SOURCE + ":" + relative])
        previous = repository_source.decode("utf8").replace("\r\n", "\n")
        baseline_file = args.platform_sources / (name + ".java")
        deployed = baseline_file.read_text(encoding="utf8") if name in ("AgentFriendPlugin", "AgentCliCatalog") else previous
        (before / (name + ".java")).write_text(deployed, encoding="utf8")
        candidate = delta(deployed, previous, (root / relative).read_text(encoding="utf8"))
        (after / (name + ".java")).write_text(candidate, encoding="utf8")
    for name in ADDED:
        (after / (name + ".java")).write_bytes((root / (prefix + name + ".java")).read_bytes())
    classpath = str(args.baseline.resolve()) + ";" + args.classpath_file.read_text(encoding="utf-8-sig").strip()
    builder.compile_sources(args.jdk, output / "baseline-classes", classpath, sorted(before.glob("*.java")))
    with zipfile.ZipFile(args.baseline) as jar:
        for item in (output / "baseline-classes").rglob("*.class"):
            entry = item.relative_to(output / "baseline-classes").as_posix()
            if jar.read(entry) != item.read_bytes():
                raise ValueError("Baseline differs: " + entry)
    builder.compile_sources(args.jdk, output / "classes", classpath, sorted(after.glob("*.java")))
    artifact = output / f"AgentFriend-{VERSION}.jar"
    builder.package(args.baseline, artifact, output / "classes", PREFIX, CHANGED + ADDED, VERSION)
    result = {"version": VERSION, "baselineSha256": BASELINE, "sha256": builder.digest(artifact),
              "baselineExact": True, "changedOwners": CHANGED + ADDED}
    (output / "build-report.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
