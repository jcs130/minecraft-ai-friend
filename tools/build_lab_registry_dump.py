"""Build a read-only NeoForge registry export mod for an isolated 1.21.1 lab.

This mod registers only /labids dumpids. It is intentionally not deployed by
this script; install it in a throwaway copy of the exact modpack, then remove it
after exporting blocks.tsv, items.tsv, components.tsv, block-states.jsonl,
entities.tsv and particles.tsv. State properties and render shapes are read from the actual
registry; no vanilla property order or proxy state IDs are inferred.
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
        code = code.replace('int ni = dumpItems(dir.resolve("items.tsv"));',
            'int ni = dumpItems(dir.resolve("items.tsv"));\n'
            '                    dumpComponents(dir.resolve("components.tsv"));\n'
            '                    dumpStates(dir.resolve("block-states.jsonl"));\n'
            '                    dumpEntities(dir.resolve("entities.tsv"));\n'
            '                    dumpParticles(dir.resolve("particles.tsv"));')
        code = code.replace('    private static int dumpBlocks(Path file)', '''    private static void dumpComponents(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var component : BuiltInRegistries.DATA_COMPONENT_TYPE) {
                w.write(BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(component).toString() + "\\t" +
                        BuiltInRegistries.DATA_COMPONENT_TYPE.getId(component));
                w.newLine();
            }
        }
    }

    private static <T extends Comparable<T>> String propertyValue(BlockState state,
            net.minecraft.world.level.block.state.properties.Property<T> property) {
        return property.getName(state.getValue(property));
    }

    private static void dumpStates(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (Block block : BuiltInRegistries.BLOCK) {
                for (BlockState state : block.getStateDefinition().getPossibleStates()) {
                    var row = new com.google.gson.JsonObject();
                    row.addProperty("stateId", Block.BLOCK_STATE_REGISTRY.getId(state));
                    row.addProperty("name", BuiltInRegistries.BLOCK.getKey(block).toString());
                    row.addProperty("renderShape", state.getRenderShape().name());
                    row.addProperty("hasBlockEntity", state.hasBlockEntity());
                    var properties = new com.google.gson.JsonObject();
                    for (var property : state.getProperties()) {
                        properties.addProperty(property.getName(), propertyValue(state, property));
                    }
                    row.add("properties", properties);
                    w.write(row.toString());
                    w.newLine();
                }
            }
        }
    }

    private static void dumpEntities(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var entity : BuiltInRegistries.ENTITY_TYPE) {
                w.write(BuiltInRegistries.ENTITY_TYPE.getKey(entity).toString() + "\\t" +
                        BuiltInRegistries.ENTITY_TYPE.getId(entity));
                w.newLine();
            }
        }
    }

    private static void dumpParticles(Path file) throws Exception {
        try (BufferedWriter w = Files.newBufferedWriter(file)) {
            for (var particle : BuiltInRegistries.PARTICLE_TYPE) {
                w.write(BuiltInRegistries.PARTICLE_TYPE.getKey(particle).toString() + "\\t" +
                        BuiltInRegistries.PARTICLE_TYPE.getId(particle));
                w.newLine();
            }
        }
    }

    private static int dumpBlocks(Path file)''')
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
