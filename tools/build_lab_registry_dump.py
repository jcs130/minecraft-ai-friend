"""Build a read-only NeoForge registry export mod for an isolated 1.21.1 lab.

This mod registers only /labids dumpids. It is intentionally not deployed by
this script; install it in a throwaway copy of the exact modpack, then remove it
after exporting blocks.tsv and items.tsv.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import zipfile


REPO = Path(__file__).resolve().parents[1]
ID_DUMP = REPO / "world/botgate-src/dev/god/botgate/IdDump.java"
BUILDER = REPO / "world/botgate-src/build.py"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--libraries", type=Path, required=True,
                        help="libraries directory in the isolated NeoForge server")
    parser.add_argument("--output", type=Path, required=True,
                        help="diagnostic JAR path outside the Git checkout")
    parser.add_argument("--javac", type=Path, default=Path(os.environ.get("JAVA_HOME", "")) / "bin/javac.exe")
    args = parser.parse_args()
    if not args.libraries.is_dir() or not args.javac.is_file():
        parser.error("--libraries and Java 21 --javac must exist")
    args.output.parent.mkdir(parents=True, exist_ok=True)

    spec = importlib.util.spec_from_file_location("botgate_build", BUILDER)
    builder = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(builder)
    classpath = builder.full_cp(args.libraries)

    with TemporaryDirectory(prefix="lab-registry-") as temp:
        root = Path(temp)
        src = root / "src/dev/god/labregistry"
        classes = root / "classes"
        src.mkdir(parents=True)
        classes.mkdir()
        code = ID_DUMP.read_text(encoding="utf-8")
        code = code.replace("package dev.god.botgate;", "package dev.god.labregistry;")
        code = code.replace('modid = "botgate"', 'modid = "labregistry"')
        code = code.replace('Commands.literal("botgate")', 'Commands.literal("labids")')
        code = code.replace('"dump", "botgate-ids"', '"dump", "lab-registry-ids"')
        (src / "IdDump.java").write_text(code, encoding="utf-8")
        (src / "LabRegistryMod.java").write_text(
            'package dev.god.labregistry;\n'
            'import net.neoforged.fml.common.Mod;\n'
            '@Mod("labregistry") public final class LabRegistryMod {}\n',
            encoding="utf-8")
        subprocess.run([str(args.javac), "-proc:none", "--release", "21", "-encoding", "UTF-8",
                        "-cp", classpath, "-d", str(classes),
                        str(src / "IdDump.java"), str(src / "LabRegistryMod.java")], check=True)
        with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in classes.rglob("*.class"):
                archive.write(file, file.relative_to(classes).as_posix())
            archive.writestr("META-INF/neoforge.mods.toml",
                'modLoader="javafml"\nloaderVersion="*"\nlicense="MIT"\n'
                '[[mods]]\nmodId="labregistry"\nversion="0.1"\n'
                'displayName="Lab Registry Export"\n'
                'description="Read-only block and item ID export for isolated agent compatibility tests"\n')
    with zipfile.ZipFile(args.output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("diagnostic JAR failed CRC validation")
    print(args.output)


if __name__ == "__main__":
    main()
