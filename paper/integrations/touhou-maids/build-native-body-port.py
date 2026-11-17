"""Build an optional loopback body port over the reviewed live .39 bridge; never install."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

BASE = '7e9a8de37c57e21a4ac68c7e7b284e2603e307e3ae9636c1a6bfe362239a53a0'
NAMES = ('HybridMaidPlugin', 'MaidBodyControl', 'NativeMaidBodyPort', 'NativeMaidBodyActions',
         'NativeMaidAgentSupport', 'NativeMaidBrainSupport', 'MaidBrainToolGuard', 'NativeMaidInventory',
         'NativeMaidCompanionSupport', 'NativeMaidResidence', 'NativeMaidOwnerTravel', 'NativeMaidSocialSupport',
         'NativeWorldPermissions')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('server', 'baseline', 'javac', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.baseline.read_bytes()).hexdigest() != BASE:
        raise ValueError('Unreviewed baseline')
    if args.output.resolve().is_relative_to(args.server.resolve()) or args.output.resolve() == args.baseline.resolve():
        raise ValueError('Build outside server and never overwrite baseline')
    root = Path(__file__).parent / 'hybrid-src/local/tlmcompat/hybrid'
    sources = [root / (name + '.java') for name in NAMES]
    cp = os.pathsep.join(map(str, [args.baseline, *args.server.glob('libraries/**/*.jar'),
                                  *args.server.glob('mods/*.jar'), *args.server.glob('plugins/*.jar')]))
    with tempfile.TemporaryDirectory(prefix='maid-body-build-') as folder:
        folder = Path(folder)
        classes = folder / 'classes'
        options = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-implicit:none', '-cp', cp,
                   '-d', str(classes), *map(str, sources)]
        argfile = folder / 'compile.args'
        argfile.write_text('\n'.join('"' + v.replace('\\', '/') + '"' for v in options), encoding='utf8')
        subprocess.run([str(args.javac), '-J-Duser.language=en', '@' + str(argfile)], check=True)
        updates = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
        assert all(n.startswith('local/tlmcompat/hybrid/') and n.rsplit('/', 1)[-1].split('$')[0].removesuffix('.class') in NAMES for n in updates)
        with zipfile.ZipFile(args.baseline) as archive:
            entries = {n: archive.read(n) for n in archive.namelist() if not n.endswith('/')}
        original = entries.copy()
        entries.update(updates)
        descriptor, count = re.subn(r'(?m)^version:.*$', 'version: 0.1.42-unified-companion', entries['plugin.yml'].decode())
        assert count == 1
        entries['plugin.yml'] = descriptor.encode()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output, 'x', zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(entries.items()):
                info = zipfile.ZipInfo(name, (2026, 11, 17, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
        assert all(entries[n] == b for n, b in original.items() if n not in updates and n != 'plugin.yml')
        report = {'version': '0.1.42-unified-companion', 'baseSha256': BASE,
                  'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
                  'changedClasses': sorted(updates), 'productionChanged': False,
                  'sourceHashEncoding': 'UTF-8 with LF (Git-normalized)',
                  'sources': {p.name: hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest() for p in sources}}
        args.output.with_suffix('.build.json').write_text(json.dumps(report, indent=2), encoding='utf8')
        print(json.dumps({'sha256': report['sha256'], 'output': str(args.output)}))


if __name__ == '__main__':
    main()
