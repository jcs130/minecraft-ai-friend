"""Offline exam-only regressions of current production method bodies (no game writes)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


# Unlike a brace counter, this skips Java strings/comments (Chinese guidance included).
def method(source, signature):
    start = source.index(signature)
    brace = source.index("{", start)
    i, depth, state = brace, 0, "code"
    while i < len(source):
        ch, following = source[i], source[i:i + 2]
        if state == "code":
            if following in ("//", "/*"):
                state = "line" if following == "//" else "comment"
                i += 2
                continue
            if ch in ('"', "'"):
                state = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return source[start:i + 1], source.count("\n", 0, start) + 1
        elif state == "line":
            if ch == "\n":
                state = "code"
        elif state == "comment":
            if following == "*/":
                state = "code"
                i += 2
                continue
        elif ch == "\\":
            i += 2
            continue
        elif ch == state:
            state = "code"
        i += 1
    raise ValueError("Unclosed method: " + signature)


SIGNATURES = (
    "private static final class Ally", "private static final class Run",
    "private boolean available()", "boolean promotionsEnabled()", "private boolean fameLedgerReady()",
    "private void validateLedger()", "private JsonObject academy(UUID id)",
    "private static JsonObject academy(JsonObject data,UUID id)", "boolean hasCertificate(Player p,String id)",
    "int readGrade(Player p)", "String gradeName(Player p)", "private Run observed(Player p)",
    "private boolean occupiesExamSlot(Run r)", "boolean busy(Player p)",
    "private static boolean durableSurvey(Run r)", "private static boolean durableRecord(Run r)",
    "private static boolean shelter(AssessmentCatalog.Definition d)", "private static String description(AssessmentCatalog.Definition d)", "boolean recordingShelter(Player p)",
    "private static Run copy(Run r)", "AssessmentCatalog.Definition definition(String id)",
    "private String eligibility(Player p,AssessmentCatalog.Definition d)",
    "private String promotionGate(Player p,AssessmentCatalog.Grade g,boolean usesRankPoints)",
    "private void start(Player p,String id,boolean promotion)",
    "private Run newRun(AssessmentCatalog.Definition d,String market)", "private Run current(Player p)",
    "private boolean canResume(Run r)", "private void resume(Player p)", "void cast(Player p,String id)",
    "private void reuseTraining(Player p,Run r)", "void proof(Player p,String id,String evidence)",
    "void siteCompleted(Player p,String site,String run,long startedAt)", "private void checkProofs(Player p,Run r)",
    "private void afterSave(Runnable notice)", "private void flushSamples()",
    "private void sampleTrajectory(Player p,Run r)", "private boolean safeGround(Player p)", "private static AssessmentCatalog.Point point(Player p)",
    "private AssessmentCatalog.Point target(Run r)", "private StarterHouseValidator.Result inspectHouse(Player p,Run r)",
    "private void houseEvidence(Player p,Run r,StarterHouseValidator.Result result)", "private boolean proofsReady(Run r)",
    "private void observeHouse(Player p,Run r)", "private void ready(Player p,Run r)",
    "private void announceReady(Player p,Run r)", "private void interrupt(Player p,Run r,String reason)",
    "public void teleport(PlayerTeleportEvent e)", "public void quit(PlayerQuitEvent e)", "void shutdown()",
    "private boolean submit(Player p,Run r)", "private static void history(JsonObject a,JsonObject proof)",
    "private boolean save(Player p,Run r)", "private static void writeRecord(JsonObject root,UUID id,JsonObject data)",
    "private JsonObject record(Run r)", "private Run decode(JsonObject o)", "private JsonObject measurements(Run r)",
    "private JsonObject standing(Player p)", "JsonObject summary(Player p)",
    "private static void merge(JsonObject out,JsonObject fields)", "JsonObject resultSnapshot(Player p)",
    "private JsonObject resultSnapshot(Player p,Run r)", "private String safeNextCommand(Run r)", "private String next(Run r)",
    "private JsonObject guide(Player p,Run r)",
    "private static void guideStep(JsonArray steps,String id,String title,String instruction,String command)",
    "private void contractGuidance(Player p, AssessmentCatalog.Definition d, JsonObject out)",
    "void show(Player p)", "private void show(Player p, boolean machine)", "void jsonQuery(Player p,String[] args)",
    "private void info(Player p,AssessmentCatalog.Definition d,boolean machine)",
    "private void send(Player p,String prefix,JsonObject out)",
    "private void reply(Player p,String reason,AssessmentCatalog.Definition d)", "void certificates(Player p)",
    "private static String gradeLabel(int grade)", "static void advanceGrade(JsonObject academy,int expectedGrade,int target)",
    "private void confirmDivision(Player p,int target)", "private String contractCommand(Player p)",
    "private GuildAdventureGuide.Hint fameHint(Player p)", "static AssessmentCatalog.Grade displayedGrade(AssessmentCatalog.Grade grade)",
    "private JsonObject promotionInfo(Player p)", "private void promotion(Player p,boolean machine)",
    "private void guideReply(Player p,boolean machine)",
)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--classpath-file", type=Path, required=True)
    parser.add_argument("--gson", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, help="AgentFriend root; defaults to this runner's parent")
    args = parser.parse_args()
    root = (args.source_root or Path(__file__).resolve().parents[1]).resolve()
    output = args.output.resolve()
    if not output.name.startswith("exam-tests-") or output == root or root in output.parents:
        raise ValueError("Use a fresh exam-tests-* output directory outside the source worktree")
    if not output.parent.is_dir():
        raise ValueError("Output parent must already exist")
    output.mkdir(exist_ok=False)
    src = root / "src/org/afuhome/agentfriend"
    tests = Path(__file__).resolve().parent / "org/afuhome/agentfriend"
    exams = (src / "SkillAssessments.java").read_text(encoding="utf-8")
    template = (tests / "ExamMethodBodyFixture.java").read_text(encoding="utf-8")
    bodies, evidence = [], []
    for signature in SIGNATURES:
        body, line = method(exams, signature)
        # Only adapt the Bukkit Plugin argument; synthetic Player records delivery.
        bodies.append(body.replace("p.sendPluginMessage(plugin,CHANNEL,bytes)", "p.sendPluginMessage(null,CHANNEL,bytes)")
                      .replace("support.getType().isSolid()", "ExamMaterialFacts.solid(support.getType())")
                      .replace("PotionEffectType.SLOW_FALLING", "null"))  # Synthetic Player has no potion effects; no unbooted registry lookup.
        evidence.append({"signature": signature, "line": line, "sha256": hashlib.sha256(body.encode()).hexdigest()})
    generated = output / "ExamMethodBodyFixture.java"
    generated.write_text(template.replace("/*__REAL_METHOD_BODIES__*/", "\n".join(bodies)), encoding="utf-8")
    production = ["AssessmentCatalog", "SkillTrajectory", "ExamLifecyclePolicy", "StarterHouseValidator",
                  "StarterHouseInspection", "HouseEvidence", "ProfessionLedger", "SkillMotion"]
    originals = [src / (name + ".java") for name in production]
    # Paper's Material properties resolve the live registry. Supply those external
    # block facts offline; keep every inspection decision/loop/method unchanged.
    inspection = output / "StarterHouseInspection.java"
    inspection.write_text((src / "StarterHouseInspection.java").read_text(encoding="utf-8")
                          .replace("m.isOccluding()", "ExamMaterialFacts.occluding(m)"), encoding="utf-8")
    sources = [p for p in originals if p.stem != "StarterHouseInspection"] + [inspection]
    sources += [generated, tests / "ExamLifecyclePolicyTest.java", tests / "SkillTrajectoryRecoveryTest.java",
                tests / "SkillTrajectoryTest.java", tests / "StarterHouseValidatorTest.java"]
    manifest = {"sourceRoot": str(root), "methods": evidence,
                "productionHashes": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in originals},
                "skillAssessmentsSha256": hashlib.sha256(exams.encode()).hexdigest(),
                "externalRewrites": ["sendPluginMessage Plugin argument -> null (captured by player proxy)",
                                     "Bukkit Material.isOccluding/isSolid -> explicitly bounded offline material facts",
                                     "SLOW_FALLING registry constant -> null only for the synthetic Player's no-effects proxy"],
                "externalBoundaries": ["synthetic Bukkit players/world/block data and scheduler", "plugin services",
                                       "counting ledger wrapper delegates actual ProfessionLedger.write; injected post-edit failure",
                                       "DurableConfigStore stub (no production config writes)"],
                "uncovered": ["live server events/physical placement timing", "real config persist failure/invalidation (life agent)",
                              "full GUI clicks/Bedrock/Web", "native skill lease provider/payment/cooldown", "real sampling scheduler loop"]}
    (output / "method-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    paths = [str(args.gson)] + args.classpath_file.read_text(encoding="utf-8").strip().split(";")
    cp = os.pathsep.join(dict.fromkeys(paths))
    suffix = ".exe" if os.name == "nt" else ""
    tool = lambda name: str(args.jdk / "bin" / (name + suffix))
    version = subprocess.run([tool("javac"), "-version"], capture_output=True, text=True, check=True)
    if not (version.stdout + version.stderr).startswith("javac 21."):
        raise ValueError("JDK 21 is required")
    options = ["-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", cp, "-d", str(output), *map(str, sources)]
    argfile = output / "javac.args"
    argfile.write_text("\n".join('"' + word.replace("\\", "/") + '"' for word in options), encoding="utf-8")
    compile_result = subprocess.run([tool("javac"), "-J-Duser.language=en", "-J-Dfile.encoding=UTF-8", "@" + str(argfile)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    (output / "compile.log").write_text(compile_result.stdout + compile_result.stderr, encoding="utf-8")
    if compile_result.returncode:
        print(compile_result.stdout + compile_result.stderr)
        return compile_result.returncode
    results = []
    for name in ["ExamLifecyclePolicyTest", "SkillTrajectoryRecoveryTest", "SkillTrajectoryTest", "StarterHouseValidatorTest"]:
        command = [tool("java"), "-Dfile.encoding=UTF-8", "-Duser.language=en", "-cp", str(output) + os.pathsep + cp, "org.afuhome.agentfriend." + name,
                   str(root / "resources"), str(output)]
        run = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        text = run.stdout + run.stderr
        (output / (name + ".log")).write_text(text, encoding="utf-8")
        for line in text.splitlines():
            if line.startswith(("PASS ", "FAIL ", "RESULT ")):
                print(line)
        count = re.search(r"RESULT passed=(\d+) failed=(\d+)", text)
        legacy = re.search(r"(?:PASS total=|RESULT )(\d+)", text)
        results.append({"test": name, "command": command, "exit": run.returncode,
                        "passed": int(count[1]) if count else int(legacy[1]) if legacy else 0,
                        "failed": int(count[2]) if count else int(run.returncode != 0)})
    summary = {"results": results, "passed": sum(r["passed"] for r in results), "failed": sum(r["failed"] for r in results)}
    (output / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("EXAM TOTAL passed={passed} failed={failed}".format(**summary))
    return int(any(r["exit"] for r in results))


if __name__ == "__main__":
    sys.exit(main())
