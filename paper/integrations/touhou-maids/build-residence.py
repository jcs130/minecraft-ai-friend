"""Build the residence increment over the verified deployed workshop bridge."""
import argparse
from copy import copy
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

BASELINE_SHA256 = '19d741b775fe17b067525a369733b19bbc76179637e22bdbb3fd6d1d01f27e08'
VERSION = '0.1.30-work-and-guard'
PACKAGE = 'local/tlmcompat/hybrid/'
CLASSES = ('NativeMaidResidence', 'HybridMaidPlugin', 'NativeMaidOwnerTravel',
           'NativeMaidWorkshop', 'NativeMaidAgentSupport', 'MaidLifeEpisodes',
           'NativeMaidTransport', 'NativeMaidCompanionSupport', 'MaidCompanionActions')

def replaced(name, classes):
    return any(name == PACKAGE + cls + '.class' or
               name.startswith(PACKAGE + cls + '$') and name.endswith('.class') for cls in classes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--classpath-file', type=Path, required=True)
    parser.add_argument('--vortex', type=Path, help='Vortex built with build-maid-spells.py')
    parser.add_argument('--javac', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASELINE_SHA256:
        parser.error('Unexpected baseline bridge SHA256')
    if args.output.exists():
        parser.error('The output already exists')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).parent
    names = CLASSES
    version = VERSION
    if args.vortex:
        with zipfile.ZipFile(args.vortex) as vortex:
            if 'io/vortexcore/rpg/NpcSpellAccess.class' not in vortex.namelist():
                parser.error('The Vortex NPC spell API is missing')
        names += ('NativeMaidMagicSupport',)
        version = '0.1.31-vortex-spells'

    with tempfile.TemporaryDirectory(dir=args.output.parent) as temporary:
        classes = Path(temporary) / 'classes'
        dependencies = [str(args.baseline.resolve()), args.classpath_file.read_text(encoding='utf-8-sig').strip()]
        if args.vortex:
            dependencies.insert(0, str(args.vortex.resolve()))
        classpath = os.pathsep.join(dependencies)
        arguments = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-implicit:none',
                     '-classpath', classpath, '-d', str(classes)]
        arguments += [str(root / 'hybrid-src' / PACKAGE / (cls + '.java')) for cls in names]
        options = Path(temporary) / 'javac.args'
        options.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in arguments), encoding='utf-8')
        subprocess.run([str(args.javac), '@' + str(options)], check=True)
        replacements = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
        assert all(replaced(name, names) for name in replacements)
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output, 'x', zipfile.ZIP_DEFLATED) as new:
            for entry in old.infolist():
                if replaced(entry.filename, names):
                    continue
                content = old.read(entry)
                if entry.filename == 'plugin.yml':
                    metadata = ''.join('version: ' + version + '\n' if line.startswith('version:') else line
                                       for line in content.decode().splitlines(keepends=True))
                    if args.vortex:
                        assert metadata.count('softdepend: [') == 1
                        metadata = metadata.replace('softdepend: [', 'softdepend: [VortexRPG, ', 1)
                    content = metadata.encode()
                new.writestr(copy(entry), content)
            for name, content in sorted(replacements.items()):
                entry = zipfile.ZipInfo(name, (2026, 11, 13, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                new.writestr(entry, content)
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output) as new:
            preserved = [n for n in old.namelist() if n != 'plugin.yml' and not replaced(n, names)]
            assert all(old.read(n) == new.read(n) for n in preserved)
    print(version, hashlib.sha256(args.output.read_bytes()).hexdigest(), len(preserved), 'preserved entries')


if __name__ == '__main__':
    main()
