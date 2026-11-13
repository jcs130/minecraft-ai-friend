"""Expose the deployed Vortex spell registry and damage formula to the maid bridge."""
import argparse
from copy import copy
from hashlib import sha256
import os
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

BASELINE = '1fb78b4c3da03acbd50875aae2b7aea437d01337a4c251568ff64e19da197618'
VERSION = '1.2.2-alpha-qd-maid-spells'
SPELLBOOK = 'io/vortexcore/rpg/SpellbookService'
PATCHED = tuple(SPELLBOOK + suffix + '.class' for suffix in ('', '$DamageMechanic', '$ScopedMechanic', '$SpellVisuals'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--classpath-file', type=Path, required=True)
    parser.add_argument('--jdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if sha256(args.baseline.read_bytes()).hexdigest() != BASELINE:
        parser.error('Unexpected deployed Vortex baseline SHA256')
    if args.output.exists():
        parser.error('The output already exists')

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sources = Path(__file__).parent / 'native-patches'
    java = args.jdk / 'bin' / ('java.exe' if os.name == 'nt' else 'java')
    javac = java.with_name(java.name.replace('java', 'javac'))
    dependencies = args.classpath_file.read_text(encoding='utf-8-sig').strip()
    with tempfile.TemporaryDirectory(dir=args.output.parent) as temp, ZipFile(args.baseline) as original:
        classes = Path(temp) / 'classes'
        options = Path(temp) / 'javac.args'
        cp = os.pathsep.join((str(args.baseline.resolve()), dependencies))
        arguments = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-classpath', cp,
                     '-d', str(classes), str(sources / 'NpcSpellAccessPatch.java'),
                     str(sources / 'io/vortexcore/rpg/NpcSpellAccess.java')]
        options.write_text('\n'.join('"' + part.replace('\\', '/') + '"' for part in arguments), encoding='utf-8')
        subprocess.run([str(javac), '@' + str(options)], check=True)
        for name in PATCHED:
            original.extract(name, classes)
        asm = [path for path in dependencies.split(os.pathsep) if Path(path).name in ('asm-9.10.1.jar', 'asm-tree-9.10.1.jar')]
        subprocess.run([str(java), '-cp', os.pathsep.join([str(classes), *asm]), 'NpcSpellAccessPatch', str(classes)], check=True)

        additions = sorted(classes.glob('io/vortexcore/rpg/NpcSpellAccess*.class'))
        assert len(additions) == 4
        with ZipFile(args.output, 'x', ZIP_DEFLATED) as output:
            for info in original.infolist():
                content = original.read(info)
                if info.filename in PATCHED:
                    content = (classes / info.filename).read_bytes()
                elif info.filename == 'plugin.yml':
                    content = ''.join('version: ' + VERSION + '\n' if line.startswith('version:') else line
                                      for line in content.decode().splitlines(keepends=True)).encode()
                output.writestr(copy(info), content)
            for path in additions:
                info = ZipInfo(path.relative_to(classes).as_posix(), (2026, 11, 13, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                output.writestr(info, path.read_bytes())
        with ZipFile(args.output) as output:
            assert {name for name in original.namelist() if original.read(name) != output.read(name)} == {*PATCHED, 'plugin.yml'}
    print(VERSION, sha256(args.output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
