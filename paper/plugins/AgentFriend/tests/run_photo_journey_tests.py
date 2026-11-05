"""Run photo regressions locally; Bukkit/ImageFrame are explicit doubles, never a game.

Inputs: existing full AgentFriend classes, Paper compile inputs, Mockito 5.14.2
+ Byte Buddy 1.15.4/agent + Objenesis 3.3. No downloads or network calls.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("jdk", "inputs", "classes", "mockito", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    suffix = ".exe" if os.name == "nt" else ""
    jdk = args.jdk.resolve() / "bin"
    tests = ["PhotoRequestTest", "PhotoEvidenceTest", "GuildAdventureGuideTest",
             "PhotoTaskLedgerTest", "PhotoJourneyManagerTest"]
    libraries = [args.inputs / "versions/1.21.1/paper-1.21.1.jar",
                 *sorted((args.inputs / "libraries").rglob("*.jar")),
                 *sorted((args.inputs / "plugins").glob("*.jar")),
                 *sorted(args.mockito.glob("*.jar"))]
    cp = os.pathsep.join(str(p.resolve()) for p in [args.classes, *libraries])
    source = root / "src/org/afuhome/agentfriend"
    sources = [source / (name + ".java") for name in ["PhotoCameraManager", "PhotoJournal", "PhotoTaskLedger",
               "PhotoRequest", "PhotoEvidence", "GuildAdventureGuide", "ProfessionLedger"]]
    sources += [root / "tests/org/afuhome/agentfriend" / (name + ".java") for name in tests]
    report = {"scope": "Complete production manager with Bukkit/ImageFrame doubles; real atomic ledger files. No real game, model or photograph.",
              "realMinecraft": False, "realModelCalls": 0, "realPhotos": 0,
              "sources": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
              "dependencies": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in libraries}, "runs": []}
    options = ["-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", cp, "-d", str(out), *map(str, sources)]
    argfile = out / "javac.args"
    argfile.write_text("\n".join('"' + s.replace("\\", "/") + '"' for s in options))
    commands = [("compile", [str(jdk / ("javac" + suffix)), "@" + str(argfile)])]
    commands += [(name, [str(jdk / ("java" + suffix)), "-javaagent:" + str((args.mockito / "byte-buddy-agent-1.15.4.jar").resolve()), "-cp", str(out) + os.pathsep + cp,
                        "org.afuhome.agentfriend." + name, str(root / "resources")]) for name in tests]
    for name, command in commands:
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        (out / (name + ".log")).write_text(result.stdout + result.stderr)
        report["runs"].append({"name": name, "exitCode": result.returncode})
        (out / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(name, result.returncode, result.stdout[-1000:], result.stderr[-1500:], flush=True)
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
