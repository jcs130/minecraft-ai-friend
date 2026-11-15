"""Build only the platform assembly delta; first reproduce deployed .80 classes exactly.

--baseline-sources is the af/candidate-source output of build-rpg-usability.py.
No production path is written and all unrelated ZIP entries are retained byte-for-byte.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import subprocess
import zipfile

BASELINE = "bfc4b6527e429ad9cfe0400c4b58724cf18dc35e908988967c91020a221d014a"
SOURCE = "e3c07d7a"
VERSION = "0.4.47.81-trial-platform"
NAMES = ("DungeonManager", "AgentFriendPlugin", "TrialGuide", "TrialEntranceControls", "AgentCliCatalog")
PREFIX = "org/afuhome/agentfriend/"


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    out = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(out)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "baseline-sources", "classpath-file", "jdk", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    a = p.parse_args()
    builder = module("builder", Path(__file__).with_name("build-dungeon-readiness.py"))
    delta = module("navigation", Path(__file__).with_name("build-player-navigation.py")).delta
    assert builder.digest(a.baseline) == BASELINE, "Deployed baseline changed"
    output = a.output.resolve()
    assert not output.is_relative_to(a.baseline.resolve().parent), "Output must be outside supplied server"
    output.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[4]
    old, new = output / "baseline-source", output / "candidate-source"
    old.mkdir(); new.mkdir()
    for name in NAMES:
        relative = "paper/plugins/AgentFriend/src/" + PREFIX + name + ".java"
        previous = subprocess.check_output(["git", "-C", str(root), "show", SOURCE + ":" + relative]).decode("utf8").replace("\r\n", "\n")
        source = a.baseline_sources / (name + ".java")
        deployed = source.read_text(encoding="utf8") if name in ("DungeonManager", "AgentFriendPlugin", "AgentCliCatalog") else previous
        (old / (name + ".java")).write_text(deployed, encoding="utf8")
        candidate = delta(deployed, previous, (root / relative).read_text(encoding="utf8"))
        (new / (name + ".java")).write_text(candidate, encoding="utf8")
    cp = str(a.baseline.resolve()) + ";" + a.classpath_file.read_text(encoding="utf-8-sig").strip()
    builder.compile_sources(a.jdk, output / "baseline-classes", cp, list(old.glob("*.java")))
    with zipfile.ZipFile(a.baseline) as jar:
        for f in (output / "baseline-classes").rglob("*.class"):
            assert jar.read(f.relative_to(output / "baseline-classes").as_posix()) == f.read_bytes(), "Baseline differs: " + f.name
    builder.compile_sources(a.jdk, output / "classes", cp, list(new.glob("*.java")))
    artifact = output / ("AgentFriend-" + VERSION + ".jar")
    builder.package(a.baseline, artifact, output / "classes", PREFIX, NAMES, VERSION,
                    {"agent-guide.yml": root / "paper/plugins/AgentFriend/resources/agent-guide.yml"})
    (output / "build-report.json").write_text(json.dumps(dict(version=VERSION, baselineSha256=BASELINE,
        sha256=builder.digest(artifact), path=str(artifact), baselineExact=True, changedOwners=NAMES), indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
