"""Build the opt-in observer without downloading dependencies or changing a client."""
import argparse
from pathlib import Path
import subprocess
import zipfile


def build(java, out):
    java, out = Path(java).resolve(), Path(out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    classes = out / "classes"
    classes.mkdir()
    source = Path(__file__).parent / "java"
    # HotSpot's bundled ASM is exported only to this agent by premain. No client
    # jars, Gradle downloads, MC mappings or edits to LWJGL are needed.
    exports = ["--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED",
               "--add-exports=java.base/jdk.internal.org.objectweb.asm.commons=ALL-UNNAMED"]
    subprocess.run([str(java), "com.sun.tools.javac.Main", *exports, "-source", "17", "-target", "17",
                    "-d", str(classes), *map(str, sorted(source.glob("*.java")))], check=True)
    target = out / "camera-memory-observer.jar"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as jar, zipfile.ZipFile(out/"camera-memory-probe.jar", "w", zipfile.ZIP_DEFLATED) as helper:
        jar.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\nPremain-Class: org.qiandeng.diagnostics.Agent\nCan-Set-Native-Method-Prefix: true\nBoot-Class-Path: camera-memory-probe.jar\n\n")
        for file in classes.rglob("*.class"):
            name=file.relative_to(classes).as_posix()
            (helper if file.name=="Probe.class" else jar).write(file,name)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java", type=Path, required=True, help="JDK 17+ java executable (JDK 21 for the MC lab)")
    parser.add_argument("--out", type=Path, required=True, help="New external build directory")
    args = parser.parse_args()
    print(build(args.java, args.out))
