"""Build against the actual Paper/SVC API; third-party JARs remain outside Git."""
import argparse
import re
from pathlib import Path
import shutil
import subprocess

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--paper", type=Path, required=True)
    parser.add_argument("--svc", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    repo = source.parents[2]
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    classes = output / "classes"
    classes.mkdir(exist_ok=True)
    paper = args.paper / "versions/1.21.1/paper-1.21.1.jar"
    if paper.is_file():
        jars = [paper, args.svc]
    else:
        patched = sorted((args.paper / "libraries/net/neoforged/neoforge").glob("21.1.*/neoforge-*-server.jar"))
        game = sorted((args.paper / "libraries/net/minecraft/server").glob("1.21.1-*/server-*-srg.jar"))
        if len(patched) != 1 or len(game) != 1:
            raise SystemExit("Use a matching isolated Paper or Youer/NeoForge 1.21.1 dependency installation")
        jars = [patched[0], game[0], args.svc]
    jars.extend(sorted(jar for jar in (args.paper / "libraries").rglob("*.jar") if jar not in jars))
    if any(not jar.is_file() for jar in jars):
        raise SystemExit("Matching runtime and verified SVC candidate are required")
    shared = repo / "world/god-voice-src/dev/god/godvoice"
    sources = list((source / "src").rglob("*.java"))
    sources += [shared / name for name in ("SpeechFrames.java", "SpeechLane.java", "CaptureFence.java")]
    values = ["-encoding", "UTF-8", "--release", "21", "-proc:none", "-cp", ";".join(str(p.resolve()) for p in jars), "-d", str(classes)] + [str(p) for p in sources]
    arguments = output / "javac.args"
    arguments.write_text("\n".join('"' + value.replace("\\", "/").replace('"', '\\"') + '"' for value in values), encoding="utf-8")
    subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(arguments)], check=True)
    for resource in (source / "resources").iterdir():
        shutil.copyfile(resource, classes / resource.name)
    version = re.search(r"(?m)^version: ([0-9]+\.[0-9]+\.[0-9]+)$", (source / "resources/plugin.yml").read_text(encoding="utf-8")).group(1)
    target = output / f"QiandengVoice-{version}.jar"
    subprocess.run([str(args.jdk / "bin/jar.exe"), "--create", "--file", str(target), "-C", str(classes), "dev", "-C", str(classes), "plugin.yml", "-C", str(classes), "config.yml"], check=True)
    classpath = str(classes) + ";" + ";".join(str(p) for p in jars)
    test_classes = output / "test-classes"
    test_classes.mkdir(exist_ok=True)
    test_values = ["-encoding", "UTF-8", "--release", "21", "-proc:none", "-cp", classpath, "-d", str(test_classes)] + [str(p) for p in (source / "tests").glob("*.java")]
    test_arguments = output / "test.args"
    test_arguments.write_text("\n".join('"' + value.replace("\\", "/").replace('"', '\\"') + '"' for value in test_values), encoding="utf-8")
    subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(test_arguments)], check=True)
    for name in ("VoiceBoundaryTest", "VoiceLedgerTest", "VoiceDiagnosticsTest", "VoicePresenceTest", "VoiceUploadFailureTest", "VoiceUploadTraceTest", "NpcVoiceApiTest", "NpcDialoguePolicyTest", "NearbySpeechTurnsTest"):
        if (source / "tests" / (name + ".java")).exists():
            subprocess.run([str(args.jdk / "bin/java.exe"), "-cp", str(test_classes) + ";" + classpath, "dev.god.godvoice." + name], check=True)
    qa = output / "qa"
    qa.mkdir(exist_ok=True)
    (qa / "plugin.yml").write_text("name: QiandengVoiceQA\nversion: 0.1.0\nmain: dev.god.godvoice.VoiceQaPlugin\napi-version: '1.21'\ndepend: [voicechat]\ncommands:\n  voiceqa: {}\n")
    subprocess.run([str(args.jdk / "bin/jar.exe"), "--create", "--file", str(output / "QiandengVoiceQA.jar"), "-C", str(test_classes), "dev/god/godvoice/VoiceQaPlugin.class", "-C", str(test_classes), "dev/god/godvoice/VoiceQaPlugin$1.class", "-C", str(qa), "plugin.yml"], check=True)
    print(target)

if __name__ == "__main__":
    main()
