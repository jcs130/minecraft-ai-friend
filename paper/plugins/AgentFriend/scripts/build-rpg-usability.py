"""Reproduce the live component classes, then build the reviewed usability deltas.

Reads supplied artifacts and Git history; never writes into a server directory.
The exact baseline check prevents silently replacing an unrelated deployed fix.
"""
from pathlib import Path
import argparse
import json
import os
import subprocess
import zipfile
from importlib.util import module_from_spec, spec_from_file_location


def module(name, path):
    spec = spec_from_file_location(name, path)
    result = module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("agentfriend", "maid", "rpg", "af-classpath-file", "maid-classpath-file", "jdk", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[4]
    builder = module("builder", Path(__file__).with_name("build-dungeon-readiness.py"))
    nav = module("navigation", Path(__file__).with_name("build-player-navigation.py"))
    delta = nav.delta
    output = args.output.resolve()
    for artifact in (args.agentfriend, args.maid, args.rpg):
        if output == artifact.resolve().parent or artifact.resolve().parent in output.parents:
            parser.error("Use a fresh output outside the supplied artifact directories")
    output.mkdir(parents=True, exist_ok=False)

    def source(relative, ref="91890e88"):
        return subprocess.check_output(["git", "-C", str(root), "show", ref + ":" + relative]).decode("utf8").replace("\r\n", "\n")

    afcp = args.af_classpath_file.read_text(encoding="utf-8-sig").strip()
    maidcp = args.maid_classpath_file.read_text(encoding="utf-8-sig").strip()
    jobs = [
        ("af", args.agentfriend, "247aaedca90905ded41aff8afc36f47022736e6626b4e5276c5732c39cf25eef", "paper/plugins/AgentFriend/src/", "org/afuhome/agentfriend/",
         ["AgentFriendPlugin", "WaypointManager", "TrialRescueManager", "CompanionTravelAccess", "DungeonManager", "PagedPersonalStash", "NativeRpg", "AdventureMenuModel", "PlayerAdventureMenus", "SpellGuide", "UtilitySpells", "GuildManager", "AgentCliCatalog", "InventoryFeedback", "InventoryTidy", "SiteDungeonManager", "AgentCoach", "GuildAdventureGuide"],
         ["TrialSharedSupplies", "PersonalStashOverview"], "AgentFriend", "0.4.47.80-rpg-usability", afcp),
        ("maid", args.maid, "fb7f329cad5cce33b213da6da5f787c67ef5a99eacd222f5e639dab6aaca0fba", "paper/integrations/touhou-maids/hybrid-src/", "local/tlmcompat/hybrid/",
         ["HybridMaidPlugin", "NativeMaidCompanionSupport", "NativeMaidAgentSupport", "NativeMaidBrainSupport"],
         ["SoulTalismanGuidance", "CompanionRespawn"], "QiandengjiMaidBridge", "0.1.37-rescue-guidance", maidcp),
        ("rpg", args.rpg, "029438983ec0e4b96ac73ba4b74f41e153137c4ce2bbbdd9799db0bd3690f4c5", "paper/integrations/vortex-rpg/src/", "org/qiandengji/vortex/",
         ["VortexBridge", "SkillTransition"], ["QuestReadyNotifier"], "QiandengjiRpg", "0.2.30-quest-guidance", afcp),
    ]
    stash = {"AgentCliCatalog", "AgentFriendPlugin", "DungeonManager", "InventoryFeedback", "InventoryTidy", "PagedPersonalStash", "SiteDungeonManager", "TrialRescueManager"}
    report = {}
    for key, base, digest, src, prefix, names, added, label, version, cp in jobs:
        assert builder.digest(base) == digest, "Changed baseline: " + key
        folder = output / key
        old, new = folder / "baseline-source", folder / "candidate-source"
        old.mkdir(parents=True)
        new.mkdir()
        for name in names:
            relative = src + prefix + name + ".java"
            head = source(relative)
            baseline = head
            if key == "af":
                if name in nav.NAMES:
                    baseline = source(relative, "58b417c9")
                    if name == "AgentFriendPlugin":
                        baseline = delta(baseline, source(relative, "8ed2eb9a"), source(relative, "c3d90c91"))
                    elif name == "DungeonManager":
                        baseline = delta(baseline, source(relative, "85f1fb69^"), source(relative, "85f1fb69"))
                    baseline = delta(baseline, source(relative, "218633f1"), source(relative, "46d6714d"))
                elif name == "WaypointManager":
                    baseline = delta(source(relative, "58b417c9"), source(relative, "8ed2eb9a"), source(relative, "c3d90c91"))
                elif name == "TrialRescueManager":
                    baseline = source(relative, "5c3afeaf")
                elif name == "PagedPersonalStash":
                    baseline = source(relative, "02ef18c0")
                elif name in {"AgentCliCatalog", "InventoryFeedback", "InventoryTidy"}:
                    baseline = source(relative, "a2db06a4^")
            (old / (name + ".java")).write_text(baseline, encoding="utf8")
            candidate = delta(baseline, source(relative, "a2db06a4^"), source(relative, "7ea8dcba")) if key == "af" and name in stash else baseline
            candidate = delta(candidate, head, (root / relative).read_text(encoding="utf8"))
            (new / (name + ".java")).write_text(candidate, encoding="utf8")
        for name in added:
            (new / (name + ".java")).write_bytes((root / (src + prefix + name + ".java")).read_bytes())
        classpath = str(base.resolve()) + os.pathsep + cp
        builder.compile_sources(args.jdk, folder / "baseline-classes", classpath, list(old.glob("*.java")))
        with zipfile.ZipFile(base) as jar:
            for file in (folder / "baseline-classes").rglob("*.class"):
                assert jar.read(file.relative_to(folder / "baseline-classes").as_posix()) == file.read_bytes(), "Baseline class differs: " + file.name
        builder.compile_sources(args.jdk, folder / "classes", classpath, list(new.glob("*.java")))
        artifact = folder / (label + "-" + version + ".jar")
        builder.package(base, artifact, folder / "classes", prefix, (*names, *added), version)
        report[key] = dict(baselineSha256=digest, sha256=builder.digest(artifact), version=version,
                           baselineExact=True, path=str(artifact), changedOwners=names + added)
        (output / "build-report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
