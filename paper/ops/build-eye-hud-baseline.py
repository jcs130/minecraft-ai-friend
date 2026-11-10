"""Build a narrow HUD-baseline candidate; never installs or starts a server."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server-root', type=Path, required=True)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--expected-base-sha256', required=True)
    parser.add_argument('--jdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--version', choices=['0.1.21-hud-baseline-candidate', '0.1.21-hud-baseline'], default='0.1.21-hud-baseline-candidate')
    args = parser.parse_args()
    assert not args.output.resolve().is_relative_to(args.server_root.resolve()), 'Output must be outside the server'
    assert hashlib.sha256(args.base.read_bytes()).hexdigest() == args.expected_base_sha256, 'Base artifact changed'
    root = Path(__file__).resolve().parents[2]
    src = root / 'paper/plugins/CortiEyeMirror/src/org/afuhome/cortieye'
    families = ('EyeHudBaseline', 'EyeInventoryMirror', 'AdditionalEyeMirrors')
    classpath = [args.server_root / 'versions/1.21.1/paper-1.21.1.jar', args.base]
    classpath += [args.server_root / 'plugins' / name for name in
                  ('ProtocolLib-5.3.0.jar', 'AuraSkills-2.4.0.jar', 'spectatorplus-paper-1.2.1.jar')]
    classpath += sorted((args.server_root / 'libraries').rglob('*.jar'))
    assert all(p.is_file() for p in classpath)
    version = args.version
    with tempfile.TemporaryDirectory(prefix='eye-hud-build-') as temporary:
        work = Path(temporary)
        options = ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp',
                   __import__('os').pathsep.join(str(p.resolve()) for p in classpath), '-d', str(work)]
        options += [str(src / (family + '.java')) for family in families]
        arguments = work / 'arguments.txt'
        arguments.write_text('\n'.join('"' + option.replace('\\', '/') + '"' for option in options), encoding='utf8')
        javac = args.jdk / 'bin' / ('javac.exe' if __import__('os').name == 'nt' else 'javac')
        subprocess.run([str(javac), '@' + str(arguments)], check=True)
        replacement = {p.relative_to(work).as_posix(): p.read_bytes() for p in work.rglob('*.class')}
        def owned(name):
            return any(name == 'org/afuhome/cortieye/' + family + '.class'
                       or name.startswith('org/afuhome/cortieye/' + family + '$') for family in families)
        assert replacement and all(owned(name) for name in replacement)
        with zipfile.ZipFile(args.base) as original:
            entries = {name: original.read(name) for name in original.namelist() if not owned(name)}
            entries['plugin.yml'], changed = re.subn(rb'(?m)^version:.*$', ('version: "' + version + '"').encode(), entries['plugin.yml'])
            assert changed == 1
            entries.update(replacement)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as target:
                for name, content in sorted(entries.items()):
                    info = zipfile.ZipInfo(name, (2026, 11, 10, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    target.writestr(info, content)
        with zipfile.ZipFile(args.base) as before, zipfile.ZipFile(args.output) as after:
            preserved = [name for name in before.namelist() if not owned(name) and name != 'plugin.yml']
            assert all(before.read(name) == after.read(name) for name in preserved)
    print(json.dumps({'version': version, 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
                      'baseSha256': args.expected_base_sha256, 'ownedFamilies': families,
                      'preservedEntries': len(preserved), 'installed': False}))


if __name__ == '__main__':
    main()
