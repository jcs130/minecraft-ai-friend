"""Run InventoryBatch on an isolated Paper 1.21.1 instance with synthetic player / plugin services.

Requires Java 21, an official Paper 1.21.1 bundler, its matching Mojang server jar,
and an existing accepted Minecraft EULA file. No login, production configuration,
online API, model, external storage service, or installed gameplay plugin is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED


def sha(file):
    with file.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("paper", "vanilla", "eula", "jdk", "out"):
        parser.add_argument("--" + arg, type=Path, required=True)
    opts = parser.parse_args()
    paper, vanilla, eula, jdk, out = [getattr(opts, key).resolve() for key in ("paper", "vanilla", "eula", "jdk", "out")]
    if "eula=true" not in eula.read_text().lower().splitlines():
        parser.error("--eula must reference an already accepted EULA")
    with ZipFile(paper) as archive:
        expected, _, name = archive.read("META-INF/download-context").decode().strip().split("\t")
    if name != "mojang_1.21.1.jar" or sha(vanilla) != expected:
        parser.error("Paper and local vanilla 1.21.1 jar do not match")
    out.mkdir(parents=True, exist_ok=False)
    (out / "cache").mkdir()
    shutil.copyfile(vanilla, out / "cache" / name)
    shutil.copyfile(eula, out / "eula.txt")
    (out / ".inventory-store-selected-test").write_text("SYNTHETIC ONLY\n")
    (out / "server.properties").write_text(
        "server-ip=127.0.0.1\nserver-port=0\nlevel-name=synthetic\nlevel-type=minecraft:flat\n"
        'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1}],"biome":"minecraft:plains"}\n'
        "generate-structures=false\nonline-mode=false\nenable-rcon=false\nenable-query=false\n"
        "view-distance=2\nsimulation-distance=3\nmax-players=1\nspawn-protection=0\n")
    exe = ".exe" if os.name == "nt" else ""
    java = str(jdk / "bin" / ("java" + exe))
    javac = str(jdk / "bin" / ("javac" + exe))
    jvm = [java, "-XX:ActiveProcessorCount=2", "-Dfile.encoding=UTF-8", "-Xms256M", "-Xmx1200M"]
    def run(label, args, seconds):
        with (out / (label + ".log")).open("wb") as log:
            subprocess.run(args, cwd=out, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=seconds)
    run("unpack", [*jvm, "-Dpaperclip.patchonly=true", "-jar", str(paper)], 90)
    here = Path(__file__).resolve().parent
    source = here.parents[1] / "src/org/afuhome/agentfriend/InventoryBatch.java"
    source_hash = sha(source)
    classes = out / "fixture-classes"
    classes.mkdir()
    cp = os.pathsep.join(map(str, sorted((out / "libraries").rglob("*.jar"))))
    compile_args = ["-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp", cp, "-d", str(classes),
                    str(source), str(here / "AgentFriendPlugin.java"), str(here / "Cases.java")]
    argfile = out / "javac.args"
    argfile.write_text("\n".join('"' + v.replace("\\", "/") + '"' for v in compile_args), encoding="utf-8")
    run("compile", [javac, "@" + str(argfile)], 90)
    (out / "plugins").mkdir()
    jar = out / "plugins/inventory-batch-test.jar"
    with ZipFile(jar, "w", ZIP_DEFLATED) as archive:
        archive.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\r\nPaperweight-Mappings-Namespace: mojang\r\n\r\n")
        archive.writestr("plugin.yml", "name: SyntheticInventoryBatch\nversion: '1'\n"
                         "main: org.afuhome.agentfriend.AgentFriendPlugin\napi-version: '1.21.1'\n")
        for file in sorted(classes.rglob("*.class")):
            archive.write(file, file.relative_to(classes).as_posix())
    run("paper", [*jvm, "-jar", str(paper), "nogui"], 240)
    result_file = out / "inventory-store-result.json"
    if not result_file.is_file():
        raise SystemExit("Paper exited before the fixture ran; see " + str(out / "paper.log"))
    report = json.loads(result_file.read_text(encoding="utf-8"))
    report.update({"paperJarSha256": sha(paper), "vanillaJarSha256": expected, "inventoryBatchSourceSha256": source_hash,
                   "inventoryBatchClassSha256": sha(classes / "org/afuhome/agentfriend/InventoryBatch.class"),
                   "fixturePluginSha256":sha(jar), "realPaperMainThread": True, "realConnectedPlayer": False,
                   "remoteBoxAndManaServices": "in-memory fixture", "productionCalls": 0})
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"success":report["success"], "checks":len(report.get("checks", [])), "report":str(out / "report.json")}))
    if not report["success"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
