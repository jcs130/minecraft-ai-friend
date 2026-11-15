"""Reproduce the deployed .77 source before applying only the navigation delta."""
from pathlib import Path
import argparse
import difflib
import hashlib
import json
import subprocess
import zipfile
from importlib.util import module_from_spec, spec_from_file_location

BASELINE = "0aad900040404da5c878d18a207e97e83996f9f13356b4e81131eedbe667b430"
DELTA_BASE = "218633f1bd5dffcbfb296acd94e80cf88b7ab8a8"
VERSION = "0.4.47.78-player-navigation"
NAMES = ("AgentFriendPlugin", "AdventureMenuModel", "PlayerAdventureMenus", "TravelMagic",
         "DungeonManager", "SiteDungeonManager", "RpgCampaign", "QuestTracker", "TargetGuideParticles")
PREFIX = "org/afuhome/agentfriend/"


def delta(base, before, after):
    left, right = before.splitlines(keepends=True), after.splitlines(keepends=True)
    changes = []
    for op, i, j, k, end in difflib.SequenceMatcher(None, left, right).get_opcodes():
        if op == "equal":
            continue
        pre, post = "".join(left[max(0, i - 3):i]), "".join(left[j:j + 3])
        needle = pre + "".join(left[i:j]) + post
        assert base.count(needle) == 1, "Ambiguous source delta; stop and reconcile the deployed source"
        start = base.index(needle) + len(pre)
        changes.append((start, start + len("".join(left[i:j])), "".join(right[k:end])))
    for start, end, text in sorted(changes, reverse=True):
        base = base[:start] + text + base[end:]
    return base


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline", "classpath-file", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    assert hashlib.sha256(args.baseline.read_bytes()).hexdigest() == BASELINE, "Deployed artifact changed"
    args.output.mkdir(parents=True)
    repo = Path(__file__).resolve().parents[4]
    spec = spec_from_file_location("builder", Path(__file__).with_name("build-dungeon-readiness.py"))
    builder = module_from_spec(spec)
    spec.loader.exec_module(builder)
    cp = str(args.baseline.resolve()) + ";" + args.classpath_file.read_text(encoding="utf-8-sig").strip()
    old, new = args.output / "baseline-source", args.output / "candidate-source"
    old.mkdir()
    new.mkdir()
    for name in NAMES:
        relative = "paper/plugins/AgentFriend/src/" + PREFIX + name + ".java"

        def source(ref):
            return subprocess.check_output(["git", "-C", str(repo), "show", ref + ":" + relative]).decode("utf8").replace("\r\n", "\n")

        baseline = source("58b417c9")
        if name in ("AgentFriendPlugin", "TravelMagic"):
            baseline = delta(baseline, source("8ed2eb9a"), source("c3d90c91"))
        elif name == "DungeonManager":
            baseline = delta(baseline, source("85f1fb69^"), source("85f1fb69"))
        (old / (name + ".java")).write_text(baseline, encoding="utf8")
        candidate = delta(baseline, source(DELTA_BASE), (repo / relative).read_text(encoding="utf8"))
        (new / (name + ".java")).write_text(candidate, encoding="utf8")
    builder.compile_sources(args.jdk, args.output / "baseline-classes", cp, list(old.glob("*.java")))
    with zipfile.ZipFile(args.baseline) as jar:
        for file in (args.output / "baseline-classes").rglob("*.class"):
            assert jar.read(file.relative_to(args.output / "baseline-classes").as_posix()) == file.read_bytes(), "Baseline differs: " + file.name
    extra = "QuestParticleTarget"
    (new / (extra + ".java")).write_bytes((repo / ("paper/plugins/AgentFriend/src/" + PREFIX + extra + ".java")).read_bytes())
    names = (*NAMES, extra)
    builder.compile_sources(args.jdk, args.output / "classes", cp, list(new.glob("*.java")))
    artifact = args.output / ("AgentFriend-" + VERSION + ".jar")
    builder.package(args.baseline, artifact, args.output / "classes", PREFIX, names, VERSION)
    (args.output / "build.json").write_text(json.dumps({"baselineSha256": BASELINE,
        "candidateSha256": builder.digest(artifact), "baselineSourceMatches": True,
        "deltaBase": DELTA_BASE, "changedOwners": names, "productionChanged": False}, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
