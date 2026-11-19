"""Build the native party message hook from a reviewed Vortex jar without installing it."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

def build(base, digest, server, jdk, target):
    if hashlib.sha256(base.read_bytes()).hexdigest() != digest:
        raise ValueError("Vortex input changed")
    if target.resolve() == base.resolve() or target.resolve().is_relative_to(server.resolve()):
        raise ValueError("Use a separate candidate output")
    src = Path(__file__).resolve().parent / "native-patches"
    service = "io/vortexcore/party/PartyService.class"
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(base) as original:
        classes = Path(tmp)
        path = classes / service
        path.parent.mkdir(parents=True)
        path.write_bytes(original.read(service))
        cp = os.pathsep.join(map(str, [classes, base, *server.glob("libraries/**/*.jar")]))
        args = ["--release", "21", "-encoding", "UTF-8", "-proc:none", "-classpath", cp, "-d", str(classes),
                str(src / "PartyChatPatch.java"), str(src / "io/vortexcore/party/PartyChatDelivery.java")]
        argfile = classes / "compile.args"
        argfile.write_text("\n".join('"' + arg.replace("\\", "/") + '"' for arg in args), encoding="utf8")
        subprocess.run([jdk / "bin/javac", "@" + str(argfile)], check=True)
        runfile = classes / "run.args"
        runfile.write_text("\n".join('"' + arg.replace("\\", "/") + '"' for arg in ("-cp", cp, "PartyChatPatch", str(path))), encoding="utf8")
        subprocess.run([jdk / "bin/java", "@" + str(runfile)], check=True)
        updates = {p.relative_to(classes).as_posix(): p.read_bytes() for p in path.parent.glob("*.class")}
        target.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as dest:
            for entry in original.infolist():
                dest.writestr(entry, updates.pop(entry.filename, original.read(entry)))
            for name, data in updates.items():
                dest.writestr(name, data)
    return hashlib.sha256(target.read_bytes()).hexdigest()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "server", "jdk", "out"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    opt = parser.parse_args()
    print(build(opt.base, opt.sha256, opt.server, opt.jdk, opt.out))
