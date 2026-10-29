"""Build against the actual Paper/SVC API; third-party JARs remain outside Git."""
import argparse
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
    jars = [args.paper / "versions/1.21.1/paper-1.21.1.jar", args.svc]
    jars.extend((args.paper / "libraries").rglob("*.jar"))
    if any(not jar.is_file() for jar in jars):
        raise SystemExit("Paper runtime and verified SVC candidate are required")
    shared = repo / "world/god-voice-src/dev/god/godvoice"
    sources = list((source / "src").rglob("*.java"))
    sources += [shared / name for name in ("SpeechFrames.java", "SpeechLane.java", "CaptureFence.java")]
    values = ["-encoding", "UTF-8", "--release", "21", "-proc:none", "-cp", ";".join(str(p.resolve()) for p in jars), "-d", str(classes)] + [str(p) for p in sources]
    arguments = output / "javac.args"
    arguments.write_text("\n".join('"' + value.replace("\\", "/").replace('"', '\\"') + '"' for value in values), encoding="utf-8")
    subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(arguments)], check=True)
    for resource in (source / "resources").iterdir():
        shutil.copyfile(resource, classes / resource.name)
    target = output / "QiandengVoice-0.1.0.jar"
    subprocess.run([str(args.jdk / "bin/jar.exe"), "--create", "--file", str(target), "-C", str(classes), "dev", "-C", str(classes), "plugin.yml", "-C", str(classes), "config.yml"], check=True)
    classpath = str(classes) + ";" + ";".join(str(p) for p in jars)
    test_classes = output / "test-classes"
    test_classes.mkdir(exist_ok=True)
    test_values = ["-encoding", "UTF-8", "--release", "21", "-proc:none", "-cp", classpath, "-d", str(test_classes)] + [str(p) for p in (source / "tests").glob("*.java")]
    test_arguments = output / "test.args"
    test_arguments.write_text("\n".join('"' + value.replace("\\", "/").replace('"', '\\"') + '"' for value in test_values), encoding="utf-8")
    subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(test_arguments)], check=True)
    for name in ("VoiceBoundaryTest", "VoiceLedgerTest"):
        if (source / "tests" / (name + ".java")).exists():
            subprocess.run([str(args.jdk / "bin/java.exe"), "-cp", str(test_classes) + ";" + classpath, "dev.god.godvoice." + name], check=True)
    qa = output / "qa"
    qa.mkdir(exist_ok=True)
    (qa / "plugin.yml").write_text("name: QiandengVoiceQA\nversion: 0.1.0\nmain: dev.god.godvoice.VoiceQaPlugin\napi-version: '1.21'\ndepend: [voicechat]\ncommands:\n  voiceqa: {}\n")
    subprocess.run([str(args.jdk / "bin/jar.exe"), "--create", "--file", str(output / "QiandengVoiceQA.jar"), "-C", str(test_classes), "dev/god/godvoice/VoiceQaPlugin.class", "-C", str(test_classes), "dev/god/godvoice/VoiceQaPlugin$1.class", "-C", str(qa), "plugin.yml"], check=True)
    print(target)

if __name__ == "__main__":
    main()
