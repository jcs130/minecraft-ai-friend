"""Offline tests using the installed MC 1.21.1 base classes; never starts a world."""
import importlib.util
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("botgate_build", root / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
libraries = root.parents[1] / "server/mc/libraries"
cp = build.full_cp(libraries)
vanilla = libraries / "net/minecraft/server/1.21.1-20240808.144430"
# Base game first for Bootstrap: the NeoForge-patched Bootstrap requires the
# complete modlauncher. Actual NeoForge linkage is covered by build+live smoke.
test_cp = os.pathsep.join([str(root / "tests"), str(root),
    str(vanilla / "server-1.21.1-20240808.144430-srg.jar"),
    str(vanilla / "server-1.21.1-20240808.144430-extra.jar"), cp])
test_sources = sorted((root / "tests").glob("*Test.java"))
subprocess.run([build.JAVAC, "-proc:none", "--release", "21", "-encoding", "UTF-8",
                "-cp", test_cp, "-d", str(root / "tests"),
                *map(str, test_sources)], check=True)
for source in test_sources:
    subprocess.run([str(Path(build.JDK) / ("java.exe" if os.name == "nt" else "java")),
                    "-cp", test_cp, source.stem], cwd=root / "tests", check=True)
