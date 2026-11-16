"""Overlay the maid spellbook on the pinned deployed rescue-guidance bridge."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile


BASE_SHA = 'ba4fc844c77a035d4779e56314f9766b770bd288c8eb352137543dea6cda1391'
VERSION = '0.1.39-spell-policy'
PACKAGE = 'local/tlmcompat/hybrid/'
CLASSES = ('HybridMaidPlugin', 'NativeMaidTransport', 'NativeMaidCompanionSupport',
           'NativeMaidMagicSupport', 'MaidVortexSpell', 'NativeMaidSocialSupport', 'MaidSpellPolicy')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline', 'classpath-file', 'javac', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    if args.baseline.resolve() == args.output.resolve():
        parser.error('Use a separate candidate output')
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE_SHA:
        parser.error('Unexpected bridge baseline')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    src = Path(__file__).resolve().parent / 'hybrid-src' / PACKAGE
    with tempfile.TemporaryDirectory(dir=args.output.parent) as directory:
        tmp = Path(directory)
        paths = args.classpath_file.read_text(encoding='utf-8-sig').strip()
        compile_args = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-cp',
                        str(args.baseline.resolve()) + os.pathsep + paths, '-d', str(tmp),
                        *(str(src / (name + '.java')) for name in CLASSES)]
        options = tmp / 'javac.args'
        options.write_text('\n'.join('"' + arg.replace('\\', '/') + '"' for arg in compile_args), encoding='utf-8')
        subprocess.run([str(args.javac), '@' + str(options)], check=True)
        compiled = {p.relative_to(tmp).as_posix(): p.read_bytes() for p in tmp.rglob('*.class')}
        output = tmp / 'candidate.jar'
        with zipfile.ZipFile(args.baseline) as original, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as patch:
            for member in original.infolist():
                if member.filename in compiled:
                    continue
                data = original.read(member)
                if member.filename == 'plugin.yml':
                    data = ('\n'.join('version: ' + VERSION if line.startswith('version:') else line
                                      for line in data.decode('utf-8').splitlines()) + '\n').encode('utf-8')
                patch.writestr(member, data)
            for name, data in sorted(compiled.items()):
                info = zipfile.ZipInfo(name, (2026, 11, 16, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                patch.writestr(info, data)
        with zipfile.ZipFile(args.baseline) as original, zipfile.ZipFile(output) as patch:
            assert patch.testzip() is None
            unrelated = [name for name in original.namelist() if name not in compiled and name != 'plugin.yml']
            assert all(original.read(name) == patch.read(name) for name in unrelated)
        output.replace(args.output)
    print(f'{args.output.name} {hashlib.sha256(args.output.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
