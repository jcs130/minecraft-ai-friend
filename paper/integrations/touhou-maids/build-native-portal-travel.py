"""Build the portal-travel patch over the deployed .24 bridge without installing it."""
import argparse
from copy import copy
import hashlib
from pathlib import Path
import subprocess
import tempfile
import zipfile

BASELINE_SHA256 = 'cd040858be9cb35c72469359242b34086f5eed1dc161003aeb73c110b2c8f5da'
VERSION = '0.1.25-native-portal-travel'
FAMILY = 'local/tlmcompat/hybrid/NativeMaidOwnerTravel'


def is_travel_class(name):
    return name == FAMILY + '.class' or name.startswith(FAMILY + '$') and name.endswith('.class')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--classpath-file', type=Path, required=True)
    parser.add_argument('--javac', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()

    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASELINE_SHA256:
        parser.error('Unexpected baseline bridge SHA256')
    if args.output.exists():
        parser.error('The output already exists')

    source = Path(__file__).parent / 'hybrid-src' / (FAMILY + '.java')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as temporary:
        classes = Path(temporary) / 'classes'
        classpath = str(args.baseline.resolve()) + ';' + args.classpath_file.read_text(encoding='utf-8-sig').strip()
        options = Path(temporary) / 'javac.args'
        arguments = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-implicit:none',
                     '-classpath', classpath, '-d', str(classes), str(source)]
        options.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in arguments), encoding='utf-8')
        subprocess.run([str(args.javac), '@' + str(options)], check=True)

        replacements = {path.relative_to(classes).as_posix(): path.read_bytes() for path in classes.rglob('*.class')}
        assert FAMILY + '.class' in replacements and all(map(is_travel_class, replacements))
        with zipfile.ZipFile(args.baseline) as baseline:
            metadata = baseline.read('plugin.yml').decode().splitlines(keepends=True)
            assert sum(line.startswith('version:') for line in metadata) == 1
            with zipfile.ZipFile(args.output, 'x', zipfile.ZIP_DEFLATED) as candidate:
                for entry in baseline.infolist():
                    if is_travel_class(entry.filename):
                        continue
                    contents = baseline.read(entry)
                    if entry.filename == 'plugin.yml':
                        contents = ''.join('version: ' + VERSION + '\n' if line.startswith('version:') else line
                                           for line in metadata).encode()
                    candidate.writestr(copy(entry), contents)
                for name, contents in sorted(replacements.items()):
                    entry = zipfile.ZipInfo(name, (2026, 11, 11, 0, 0, 0))
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    candidate.writestr(entry, contents)
            with zipfile.ZipFile(args.output) as candidate:
                preserved = [name for name in baseline.namelist() if name != 'plugin.yml' and not is_travel_class(name)]
                assert all(baseline.read(name) == candidate.read(name) for name in preserved)

    print(VERSION, hashlib.sha256(args.output.read_bytes()).hexdigest(), f'{len(preserved)} preserved entries')


if __name__ == '__main__':
    main()
