"""Patch the pinned native bridge, preserving every unrelated entry and bundled asset."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile
import zipfile

BASE_SHA256 = 'dde357119ec3e14b14855834aad814024a2b6854ede766009768ab49bfaf632d'
VERSION = '0.1.7-agent'
CLASSES = ('HybridMaidPlugin', 'NativeMaidInventory', 'NativeMaidTransport', 'NativeMaidAgentSupport')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--classpath-file', type=Path, required=True)
    parser.add_argument('--javac', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.baseline.resolve() == args.output.resolve():
        raise SystemExit('Refusing to overwrite the baseline')
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE_SHA256:
        raise SystemExit('Unexpected baseline; re-audit before rebuilding')
    root = Path(__file__).parent
    package = 'local/tlmcompat/hybrid/'
    sources = [root / 'hybrid-src' / package / f'{name}.java' for name in CLASSES]
    with tempfile.TemporaryDirectory(dir=args.output.parent, prefix='maid-build-') as temp:
        temp = Path(temp)
        cp = str(args.baseline.resolve()) + ';' + args.classpath_file.read_text(encoding='utf-8-sig').strip()
        options = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-classpath', cp, '-d', str(temp / 'classes')]
        options += [str(source) for source in sources]
        option_file = temp / 'javac.args'
        option_file.write_text('\n'.join('"' + option.replace('\\', '/') + '"' for option in options), encoding='utf-8')
        subprocess.run([str(args.javac), '-J-Duser.language=en', '@' + str(option_file)], check=True)
        compiled = {p.relative_to(temp / 'classes').as_posix(): p.read_bytes() for p in (temp / 'classes').rglob('*.class')}
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as new:
            for entry in old.infolist():
                name = entry.filename
                if any(name == package + cls + '.class' or name.startswith(package + cls + '$') for cls in CLASSES):
                    continue
                content = old.read(name)
                if name == 'plugin.yml':
                    lines = content.decode('utf-8').splitlines()
                    content = ('\n'.join('version: ' + VERSION if line.startswith('version:') else line for line in lines) + '\n').encode()
                new.writestr(entry, content)
            for name, content in sorted(compiled.items()):
                entry = zipfile.ZipInfo(name, (2026, 11, 6, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                new.writestr(entry, content)
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output) as new:
            preserved = [n for n in old.namelist() if n != 'plugin.yml' and not any(n == package+c+'.class' or n.startswith(package+c+'$') for c in CLASSES)]
            assert all(old.read(n) == new.read(n) for n in preserved)
        print(f'{args.output.name}: {hashlib.sha256(args.output.read_bytes()).hexdigest()}; {len(preserved)} unrelated entries preserved')


if __name__ == '__main__':
    main()
