"""Build the companion action and workshop increment over the verified deployed portal bridge."""
import argparse
from copy import copy
import hashlib
from pathlib import Path
import subprocess
import tempfile
import zipfile

BASELINE_SHA256 = '278f6e0c2c9619c8ed92ed7616f7717d86a88bfc638eb03338ae7024ee052c47'
VERSION = '0.1.27-workshop'
PACKAGE = 'local/tlmcompat/hybrid/'
CLASSES = ('CompanionActionCallback', 'MaidCompanionActions', 'NativeMaidBrainSupport',
           'NativeMaidSocialSupport', 'HybridMaidPlugin', 'NativeMaidFollowSupport', 'NativeMaidOwnerTravel',
           'NativeMaidNearbyChat', 'MaidConversationWindow', 'MaidConversationInitiative', 'NativeMaidAgentSupport',
           'NativeMaidWorkshop', 'MaidWorkshopRecipes')


def replaced(name):
    return any(name == PACKAGE + cls + '.class' or
               name.startswith(PACKAGE + cls + '$') and name.endswith('.class') for cls in CLASSES)


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
    args.output.parent.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).parent
    with tempfile.TemporaryDirectory(dir=args.output.parent) as temporary:
        classes = Path(temporary) / 'classes'
        classpath = str(args.baseline.resolve()) + ';' + args.classpath_file.read_text(encoding='utf-8-sig').strip()
        arguments = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-implicit:none',
                     '-classpath', classpath, '-d', str(classes)]
        arguments += [str(root / 'hybrid-src' / PACKAGE / (cls + '.java')) for cls in CLASSES]
        options = Path(temporary) / 'javac.args'
        options.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in arguments), encoding='utf-8')
        subprocess.run([str(args.javac), '@' + str(options)], check=True)
        replacements = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
        assert all(map(replaced, replacements))
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output, 'x', zipfile.ZIP_DEFLATED) as new:
            for entry in old.infolist():
                if replaced(entry.filename):
                    continue
                content = old.read(entry)
                if entry.filename == 'plugin.yml':
                    content = ''.join('version: ' + VERSION + '\n' if line.startswith('version:') else line
                                      for line in content.decode().splitlines(keepends=True)).encode()
                new.writestr(copy(entry), content)
            for name, content in sorted(replacements.items()):
                entry = zipfile.ZipInfo(name, (2026, 11, 12, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                new.writestr(entry, content)
        with zipfile.ZipFile(args.baseline) as old, zipfile.ZipFile(args.output) as new:
            preserved = [n for n in old.namelist() if n != 'plugin.yml' and not replaced(n)]
            assert all(old.read(n) == new.read(n) for n in preserved)
    print(VERSION, hashlib.sha256(args.output.read_bytes()).hexdigest(), len(preserved), 'preserved entries')


if __name__ == '__main__':
    main()
