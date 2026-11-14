"""Build the opt-in identity bridge against the current Youer and Floodgate inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--server", type=Path, required=True)
parser.add_argument("--jdk", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()

api = args.server / "libraries/com/mohistmc/installation/data/paper-remap.jar"
floodgate = args.server / "plugins/floodgate-spigot.jar"
adventure = (args.server / "libraries/net/kyori").glob("*/*/*.jar")
deps = [api, floodgate, *sorted(adventure, reverse=True)]
if not all(path.is_file() for path in deps):
    parser.error("The current Youer and Floodgate build inputs are required")
classes = args.output / "classes"
classes.mkdir(parents=True)
common = root.parents[1] / "plugins/shared/src/org/afuhome/identity"
sources = sorted(root.glob("src/**/*.java")) + sorted(common.glob("*.java"))
javac = args.jdk / "bin" / ("javac.exe" if os.name == "nt" else "javac")
subprocess.run([str(javac), "-proc:none", "-encoding", "UTF-8", "--release", "21", "-cp",
                os.pathsep.join(map(str, deps)), "-d", str(classes), *map(str, sources)], check=True)

jar = args.output / "PlatformIdentity-0.1.0.jar"
with ZipFile(jar, "w", ZIP_DEFLATED) as archive:
    archive.writestr("plugin.yml", 'name: PlatformIdentity\nversion: 0.1.0\napi-version: "1.21"\n'
                     'main: org.afuhome.identity.paper.PlatformIdentityPlugin\ndepend: [floodgate]\n')
    for path in sorted(classes.rglob("*.class")):
        archive.write(path, path.relative_to(classes).as_posix())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

(args.output / "build.json").write_text(json.dumps({
    "jar": sha(jar), "dependencies": {str(path): sha(path) for path in deps},
    "sources": {path.relative_to(root.parents[1]).as_posix(): sha(path) for path in sources},
}, indent=2), encoding="utf-8")
print("Built PlatformIdentity 0.1.0")
