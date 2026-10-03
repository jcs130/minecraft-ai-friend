"""Build an operator-only MineColonies QA fixture for the disposable registry server.

This JAR is never copied to the main experiment server or the Paper live server.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

from society_lab import DEFAULT_JAVA, DEFAULT_ROOT, REPO, safe_root

ROOT = safe_root(DEFAULT_ROOT)
SERVER = ROOT / "research" / "registry-server"
SOURCE = REPO / "world" / "society-bridge-src" / "qa" / "ColonyLabSetup.java"
MINECOLONIES = SERVER / "mods" / "minecolonies-1.1.1319-1.21.1.jar"
STRUCTURIZE = SERVER / "mods" / "structurize-1.0.832-1.21.1.jar"
DOMUM = SERVER / "mods" / "domum-ornamentum-1.0.231-main.jar"
NAME = "maw_colony_lab-0.1.0.jar"
MANIFEST = """modLoader="javafml"
loaderVersion="[4,)"
license="MIT"

[[mods]]
modId="maw_colony_lab"
version="0.1.0"
displayName="MAW Disposable Colony QA"
description="Only for the isolated registry-server."

[[dependencies.maw_colony_lab]]
modId="minecolonies"
type="required"
versionRange="[1.1.1319,)"
ordering="AFTER"
side="SERVER"
"""


def main() -> None:
    if not all(path.is_file() for path in (SOURCE, MINECOLONIES, STRUCTURIZE, DOMUM)):
        raise ValueError("Pinned source and MineColonies JAR required")
    java = Path(DEFAULT_JAVA)
    javac = java.with_name("javac.exe" if os.name == "nt" else "javac")
    spec = importlib.util.spec_from_file_location("botgate_build", REPO / "world" / "botgate-src" / "build.py")
    helper = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(helper)
    cp = os.pathsep.join((helper.full_cp(SERVER / "libraries"),
                         str(MINECOLONIES), str(STRUCTURIZE), str(DOMUM)))
    build = ROOT / "build" / "colony-lab"
    build.mkdir(parents=True, exist_ok=True)
    target = build / NAME
    with tempfile.TemporaryDirectory(prefix="compile-", dir=build) as temporary:
        work = Path(temporary)
        classes = work / "classes"
        classes.mkdir()
        args = work / "javac.args"
        quoted = lambda value: '"' + str(value).replace("\\", "/") + '"'
        args.write_text("\n".join(("-proc:none", "--release", "21", "-encoding", "UTF-8", "-cp",
                                    quoted(cp), "-d", quoted(classes), quoted(SOURCE))), encoding="utf-8")
        result = subprocess.run([str(javac), "@" + str(args)], capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=180)
        if result.returncode:
            raise RuntimeError(result.stderr[-5000:])
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("META-INF/neoforge.mods.toml", MANIFEST)
            for path in classes.rglob("*.class"):
                archive.write(path, path.relative_to(classes).as_posix())
    print(target)


if __name__ == "__main__":
    main()
