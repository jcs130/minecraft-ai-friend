"""Build the lab-only, identity-neutral Numen command bridge from source."""

from __future__ import annotations

import argparse
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import zipfile

from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, PORT, REPO, safe_root, sha256


SOURCE = REPO / "world" / "society-bridge-src"
NUMEN_NAME = "numen-neoforge-1.21.1-0.1.4.1.jar"
NUMEN_SHA = "ed4a5936aa182b0d9ab685cb993da54f72514eafb0838bb9a64cd69962cb1226"
API_SHA = "bbc481ea8324b56989627c1f9f9c867e5e82cfd7f35ae5ec2107fb7e34430da5"
ARS_JAR = "ars_nouveau-1.21.1-5.13.2.jar"
CREATE_JAR = "create-1.21.1-6.0.10.jar"
PONDER_JAR = "ponder-neoforge-1.0.82+mc1.21.1.jar"
MINECOLONIES_JAR = "minecolonies-1.1.1319-1.21.1.jar"
STRUCTURIZE_JAR = "structurize-1.0.832-1.21.1.jar"
DOMUM_JAR = "domum-ornamentum-1.0.231-main.jar"
BLOCKUI_JAR = "blockui-1.0.209-1.21.1.jar"
MAID_JAR = "touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar"
FOOD_JAR = "FarmersDelight-1.21.1-1.3.4.jar"
CURIOS_JAR = "curios-neoforge-9.5.1+1.21.1.jar"
GECKO_JAR = "geckolib-neoforge-1.21.1-4.9.3.jar"
YSM_JAR = "ysm-2.6.5-neoforge+mc1.21.1-release.jar"
NAME = "maw_agent_bridge-0.1.0.jar"


def server_port(server: Path) -> int:
    """Read the target's port; old unconfigured lab copies keep the lab default."""
    properties = server / "server.properties"
    try:
        lines = properties.read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        return PORT
    value = None
    for line in lines:
        line = line.strip()
        if not line or line.startswith(("#", "!")):
            continue
        # Minecraft writes key=value. Also accept Java Properties' ordinary
        # colon/whitespace separators, so a valid alternate form cannot silently
        # cause this installation guard to check a different port.
        match = re.fullmatch(r"server-port(?:[ \t\f]*[=:][ \t\f]*|[ \t\f]+)(.*)", line)
        if match:
            value = match.group(1).strip()
        elif line == "server-port":
            value = ""
    if value is None:
        return PORT
    if not re.fullmatch(r"[0-9]+", value) or not 1 <= int(value) <= 65535:
        raise ValueError(f"Invalid server-port in {properties}: expected decimal integer 1..65535")
    return int(value)


def ensure_server_stopped(server: Path) -> int:
    """Reserve the actual IPv4 port briefly; never contact or stop the server."""
    port = server_port(server)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        # Windows otherwise permits some overlapping binds when the existing
        # listener enabled SO_REUSEADDR. We must refuse any occupied target port.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind(("0.0.0.0", port))
        except OSError as error:
            raise RuntimeError(
                f"Refusing bridge installation: target server TCP port {port} is occupied "
                f"or unavailable ({server}). Stop the target server before installing."
            ) from error
    return port


def install_candidate(candidate: Path, target: Path, server: Path) -> None:
    # Compilation can take minutes. Read properties and check again immediately
    # before replacing the JAR, even if the earlier startup check succeeded.
    ensure_server_stopped(server)
    os.replace(candidate, target)


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
    ensure_server_stopped(server)
    if not javac.is_file():
        raise ValueError("Java 21 is required")
    installed_numen = mods / NUMEN_NAME
    if not installed_numen.is_file() or sha256(installed_numen) != NUMEN_SHA:
        raise ValueError("Pinned official Numen 0.1.4.1 release is required")
    # Compile against the API embedded in this exact official release. It is
    # extracted only to the build cache, never installed as a duplicate mod.
    api_jar = root / "build" / "numen-0.1.4.1" / "numen_api.jar"
    with zipfile.ZipFile(installed_numen) as archive:
        apis = [name for name in archive.namelist()
                if name.startswith("META-INF/jarjar/") and "numen_api" in name and name.endswith(".jar")]
        if len(apis) != 1:
            raise ValueError("Expected one embedded Numen API")
        api_jar.parent.mkdir(parents=True, exist_ok=True)
        api_jar.write_bytes(archive.read(apis[0]))
    if sha256(api_jar) != API_SHA:
        raise ValueError("Official embedded Numen API hash mismatch")
    ars = mods / ARS_JAR
    create = mods / CREATE_JAR
    ponder = mods / PONDER_JAR
    minecolonies = mods / MINECOLONIES_JAR
    structurize = mods / STRUCTURIZE_JAR
    domum = mods / DOMUM_JAR
    blockui = mods / BLOCKUI_JAR
    maid = mods / MAID_JAR
    food = mods / FOOD_JAR
    gecko = mods / GECKO_JAR
    if not gecko.is_file():
        raise ValueError("Pinned GeckoLib JAR is required by Ars spell books")
    curios = mods / CURIOS_JAR
    if not curios.is_file():
        raise ValueError("Pinned Curios JAR is required for real accessory menus")
    ysm = mods / YSM_JAR
    if not ysm.is_file() or sha256(ysm) != "b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb":
        raise ValueError("Pinned YSM 2.6.5 JAR is required for native model selection")
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
    if not blockui.is_file():
        raise ValueError("Pinned BlockUI JAR is required for MineColonies configuration")
    if not maid.is_file():
        raise ValueError("Pinned Touhou Little Maid JAR is required for player maid operations")
    if not food.is_file():
        raise ValueError("Pinned Farmer's Delight JAR is required for native food/menu/recipe state")
    spec = importlib.util.spec_from_file_location("botgate_build", REPO / "world" / "botgate-src" / "build.py")
    helper = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(helper)
    libraries = server / "libraries"
    if not libraries.is_dir() and (root / "research").resolve() in server.parents:
        libraries = root / "server/libraries"  # shared, read-only pinned compile dependencies
    classpath = os.pathsep.join((helper.full_cp(libraries), str(api_jar),
                                 str(installed_numen), str(ars), str(create), str(ponder),
                                 str(minecolonies), str(structurize), str(domum), str(blockui), str(maid), str(food), str(curios), str(gecko), str(ysm)))
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
            add_bytes(archive, "maw-native-operations.json", (SOURCE / "src/main/resources/maw-native-operations.json").read_bytes())
            for path in sorted(classes.rglob("*.class")):
                add_bytes(archive, path.relative_to(classes).as_posix(), path.read_bytes())
        with zipfile.ZipFile(candidate) as archive:
            if archive.testzip():
                raise ValueError("Bridge JAR failed CRC check")
        install_candidate(candidate, target, server)
    record = {"schemaVersion": 1, "jar": str(target), "sha256": sha256(target),
              "numenVersion": "0.1.4.1", "numenSha256": sha256(installed_numen), "apiSha256": sha256(api_jar),
              "arsSha256": sha256(ars),
              "createSha256": sha256(create),
              "ponderSha256": sha256(ponder),
              "minecoloniesSha256": sha256(minecolonies),
              "structurizeSha256": sha256(structurize),
              "domumSha256": sha256(domum),
              "blockuiSha256": sha256(blockui),
              "maidSha256": sha256(maid),
              "foodSha256": sha256(food),
              "curiosSha256": sha256(curios),
              "geckoSha256": sha256(gecko),
              "ysmSha256": sha256(ysm),
              "sources": {str(path.relative_to(REPO)).replace("\\", "/"): sha256(path)
                          for path in (*sources, resource, SOURCE / "src/main/resources/maw-native-operations.json", Path(__file__))}}
    record["serverDir"] = str(server)
    record_name = "build-record.json" if server == (root / "server").resolve() else (
        "build-record-" + hashlib.sha256(str(server).encode()).hexdigest()[:12] + ".json")
    record_path = build / record_name
    record_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "jar": str(target), "sha256": record["sha256"], "record": str(record_path)}))


if __name__ == "__main__":
    main()
