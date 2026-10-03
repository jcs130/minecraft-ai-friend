"""Build the lab-only, identity-neutral Numen command bridge from source."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import zipfile

from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, REPO, safe_root, sha256


SOURCE = REPO / "world" / "society-bridge-src"
NUMEN = REPO / "world" / "numen-src"
NUMEN_JAR = NUMEN / "core" / "neoforge" / "build" / "libs" / "numen-neoforge-1.21.1-0.1.3.jar"
API_JAR = NUMEN / "api" / "neoforge" / "build" / "libs" / "numen_api-neoforge-1.21.1-0.1.3.jar"
ARS_JAR = "ars_nouveau-1.21.1-5.13.2.jar"
CREATE_JAR = "create-1.21.1-6.0.10.jar"
PONDER_JAR = "ponder-neoforge-1.0.82+mc1.21.1.jar"
MINECOLONIES_JAR = "minecolonies-1.1.1319-1.21.1.jar"
STRUCTURIZE_JAR = "structurize-1.0.832-1.21.1.jar"
DOMUM_JAR = "domum-ornamentum-1.0.231-main.jar"
NAME = "maw_agent_bridge-0.1.0.jar"


def add_bytes(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, content)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--server-dir", help="Explicit server directory inside --root for isolated test copies")
    parser.add_argument("--java", default=str(DEFAULT_JAVA))
    args = parser.parse_args()
    root = safe_root(args.root)
    java = Path(args.java)
    javac = java.with_name("javac.exe" if os.name == "nt" else "javac")
    server = Path(args.server_dir).resolve() if args.server_dir else root / "server"
    if server != root and root not in server.parents:
        raise ValueError("Server directory must stay inside the isolated root")
    mods = server / "mods"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 28976))
    if not javac.is_file() or not NUMEN_JAR.is_file() or not API_JAR.is_file():
        raise ValueError("Java 21 and built Numen core/API are required")
    installed_numen = mods / NUMEN_JAR.name
    ars = mods / ARS_JAR
    create = mods / CREATE_JAR
    ponder = mods / PONDER_JAR
    minecolonies = mods / MINECOLONIES_JAR
    structurize = mods / STRUCTURIZE_JAR
    domum = mods / DOMUM_JAR
    if not installed_numen.is_file() or sha256(installed_numen) != sha256(NUMEN_JAR):
        raise ValueError("Lab Numen JAR does not match this worktree build")
    if not ars.is_file():
        raise ValueError("Pinned Ars Nouveau JAR is required for the spell bridge")
    if not create.is_file():
        raise ValueError("Pinned Create JAR is required for native kinetic state")
    if not ponder.is_file():
        raise ValueError("Pinned Ponder JAR is required by Create's block entities")
    if not minecolonies.is_file():
        raise ValueError("Pinned MineColonies JAR is required for native colony state")
    if not structurize.is_file() or not domum.is_file():
        raise ValueError("Pinned MineColonies structure dependencies are required")
    spec = importlib.util.spec_from_file_location("botgate_build", REPO / "world" / "botgate-src" / "build.py")
    helper = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(helper)
    classpath = os.pathsep.join((helper.full_cp(server / "libraries"), str(API_JAR),
                                 str(NUMEN_JAR), str(ars), str(create), str(ponder),
                                 str(minecolonies), str(structurize), str(domum)))
    sources = sorted((SOURCE / "src" / "main" / "java").rglob("*.java"))
    resource = SOURCE / "src" / "main" / "resources" / "META-INF" / "neoforge.mods.toml"
    if not sources or not resource.is_file():
        raise ValueError("Expected bridge Java sources and one mod manifest")
    build = root / "build" / "society-bridge"
    build.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="compile-", dir=build) as temporary:
        work = Path(temporary)
        classes = work / "classes"
        classes.mkdir()
        argfile = work / "javac.args"
        quoted = lambda value: '"' + str(value).replace("\\", "/") + '"'
        argfile.write_text("\n".join(("-proc:none", "--release", "21", "-encoding", "UTF-8",
                                       "-cp", quoted(classpath), "-d", quoted(classes),
                                       *(quoted(source) for source in sources))), encoding="utf-8")
        result = subprocess.run([str(javac), "@" + str(argfile)], capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=180)
        if result.returncode:
            raise RuntimeError(f"javac failed:\n{result.stdout[-3000:]}\n{result.stderr[-5000:]}")
        target = mods / NAME
        candidate = build / (NAME + ".part")
        with zipfile.ZipFile(candidate, "w") as archive:
            add_bytes(archive, "META-INF/neoforge.mods.toml", resource.read_bytes())
            for path in sorted(classes.rglob("*.class")):
                add_bytes(archive, path.relative_to(classes).as_posix(), path.read_bytes())
        with zipfile.ZipFile(candidate) as archive:
            if archive.testzip():
                raise ValueError("Bridge JAR failed CRC check")
        os.replace(candidate, target)
    record = {"schemaVersion": 1, "jar": str(target), "sha256": sha256(target),
              "numenSha256": sha256(NUMEN_JAR), "apiSha256": sha256(API_JAR),
              "arsSha256": sha256(ars),
              "createSha256": sha256(create),
              "ponderSha256": sha256(ponder),
              "minecoloniesSha256": sha256(minecolonies),
              "structurizeSha256": sha256(structurize),
              "domumSha256": sha256(domum),
              "sources": {str(path.relative_to(REPO)).replace("\\", "/"): sha256(path)
                          for path in (*sources, resource, Path(__file__))}}
    (build / "build-record.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "jar": str(target), "sha256": record["sha256"]}))


if __name__ == "__main__":
    main()
