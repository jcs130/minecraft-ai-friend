"""Build the native swordsman patch against a reviewed VortexRPG JAR."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent
patches = root / "native-patches"
target_names = [
    "io/vortexcore/rpg/VortexClass.class",
    "io/vortexcore/rpg/ClassSkillService.class",
    "io/vortexcore/ui/ProfileMenuService.class",
    "io/vortexcore/rpg/SpellbookService.class",
]

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base", type=Path, required=True)
parser.add_argument("--base-sha256", required=True)
parser.add_argument("--classpath", type=Path, action="append", required=True, help="Server library directory or JAR")
parser.add_argument("--java-home", type=Path)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
digest = hashlib.sha256(args.base.read_bytes()).hexdigest()
if digest != args.base_sha256.lower() or args.output.exists() or args.output.with_suffix(".build.json").exists():
    parser.error("expected a matching base digest and fresh output")
if any(part.lower() in ("plugins", "mods") for part in args.output.resolve().parts):
    parser.error("write the candidate outside plugin and mod loading directories")

def java_tool(name):
    return str(args.java_home / "bin" / (name + ".exe" if os.name == "nt" else name)) if args.java_home else name

with tempfile.TemporaryDirectory(prefix="vortex-swordsman-") as work:
    classes = Path(work) / "classes"
    with zipfile.ZipFile(args.base) as base:
        entries = {name: base.read(name) for name in base.namelist() if not name.endswith("/")}
    for name in target_names:
        file = classes / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(entries[name])

    dependencies = [jar for path in args.classpath for jar in (sorted(path.rglob("*.jar")) if path.is_dir() else [path])]
    cp = os.pathsep.join(map(str, [classes, args.base.resolve(), *dependencies]))
    javac = [java_tool("javac"), "-encoding", "UTF-8", "--release", "21", "-proc:none", "-classpath", cp, "-d", str(classes)]
    patch = [java_tool("java"), "-classpath", cp, "SwordsmanPatch", str(classes)]
    subprocess.run([*javac, str(patches / "SwordsmanPatch.java")], check=True)

    # The helper is compiled against the appended enum, then the whole patch is applied to the original classes.
    subprocess.run([*patch, "enum-only"], check=True)
    subprocess.run([*javac, str(patches / "io/vortexcore/rpg/SwordsmanSkills.java")], check=True)
    (classes / target_names[0]).write_bytes(entries[target_names[0]])
    subprocess.run(patch, check=True)

    changed = target_names + ["io/vortexcore/rpg/SwordsmanSkills.class"]
    for name in changed:
        entries[name] = (classes / name).read_bytes()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "x", zipfile.ZIP_DEFLATED) as jar:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            jar.writestr(info, content)
    report = {"baseSha256": digest, "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
              "changedEntries": changed, "productionChanged": False}
    args.output.with_suffix(".build.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report))
