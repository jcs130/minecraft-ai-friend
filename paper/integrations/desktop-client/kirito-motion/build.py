"""Compile the Kirito motion addon with the Minecraft/NeoForge client classpath."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent
# Preserve the published 1.0.0 archive's ordering, DOS timestamps and line endings.
CLASS_STAMP = (2026, 11, 20, 1, 8, 50)
RESOURCES = {
    'META-INF/neoforge.mods.toml': ((2026, 11, 20, 0, 49, 8), '\n'),
    'assets/qd_kirito_motion/animations/kirito.animation.json': ((2026, 11, 20, 1, 8, 44), '\r\n'),
}


def member(archive, name, data, stamp):
    info = ZipInfo(name, stamp)
    info.create_system = 0
    info.external_attr = 0o100666 << 16
    archive.writestr(info, data, compress_type=ZIP_DEFLATED)


def build(javac, classpath, ysm, output):
    cp = classpath.read_text(encoding='utf-8-sig').strip().strip('"') + os.pathsep + str(ysm.resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        build_dir = Path(tmp).resolve()
        classes = build_dir / 'classes'
        classes.mkdir()
        args = ['--release', '21', '-proc:none', '-encoding', 'UTF-8', '-classpath', cp, '-d', classes,
                ROOT / 'KiritoMotion.java', ROOT / 'Motion.java']
        argfile = build_dir / 'javac.args'
        # javac response files avoid Windows process command line length limits.
        argfile.write_text('\n'.join('"' + str(arg).replace('\\', '/') + '"' for arg in args), encoding='utf-8')
        subprocess.run([javac, '@' + str(argfile)], check=True)
        candidate = build_dir / 'kirito-motion.jar'
        with ZipFile(candidate, 'w') as jar:
            for path in sorted(classes.rglob('*.class'), key=lambda p: p.name):
                member(jar, path.relative_to(classes).as_posix(), path.read_bytes(), CLASS_STAMP)
            for name, (stamp, newline) in RESOURCES.items():
                text = (ROOT / 'resources' / name).read_text(encoding='utf-8')
                member(jar, name, text.replace('\n', newline).encode(), stamp)
        candidate.replace(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--javac', default='javac')
    parser.add_argument('--classpath-file', type=Path, required=True, help='File containing the NeoForge client classpath')
    parser.add_argument('--ysm', type=Path, required=True, help='Yes Steve Model 2.6.5 for NeoForge 1.21.1')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    build(args.javac, args.classpath_file, args.ysm, args.out)
