"""Build the add-on against an official installed NeoForge server and TLM jar."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent
COMMON = ROOT.parent / 'brain-extension/src/local/qdj/maids/brain/MaidBrainControl.java'
LICENSE = ROOT.parents[3] / 'LICENSE'


def classpath(server, maid):
    libraries = server / 'libraries'
    patched = sorted(libraries.glob('net/neoforged/neoforge/21.1.*/neoforge-*-server.jar'))
    game = sorted(libraries.glob('net/minecraft/server/1.21.1-*/server-*-srg.jar'))
    if len(patched) != 1 or len(game) != 1:
        raise ValueError('Use an isolated NeoForge 21.1 server installation with one patched server jar.')
    extras = sorted(jar for jar in libraries.rglob('*.jar')
                    if jar != patched[0] and 'net/minecraft/server/' not in jar.as_posix())
    return [patched[0], game[0], maid, *extras]


def compile_java(javac, arguments, options):
    options.write_text('\n'.join('"' + str(arg).replace('\\', '/').replace('"', '\\"') + '"'
                                 for arg in arguments), encoding='utf-8')
    subprocess.run([str(javac), '-J-Duser.language=en', '@' + str(options)], check=True)


def write_zip(output, entries):
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, body in sorted(entries.items()):
            member = zipfile.ZipInfo(name, (2026, 11, 16, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(member, body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', type=Path, required=True)
    parser.add_argument('--maid', type=Path, required=True)
    parser.add_argument('--javac', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, help='Also package the JAR, setup examples and optional harness gateway.')
    args = parser.parse_args()
    output = args.output.resolve()
    if not args.maid.is_file() or output == args.maid.resolve():
        parser.error('--maid must be an existing original TLM JAR separate from --output')
    bundle = args.bundle.resolve() if args.bundle else None
    if bundle is not None and bundle in {output, args.maid.resolve()}:
        parser.error('--bundle must be separate from the input and output JAR files')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent, prefix='tlm-maid-agents-') as directory:
        work = Path(directory)
        classes = work / 'classes'
        cp = os.pathsep.join(str(jar) for jar in classpath(args.server.resolve(), args.maid.resolve()))
        compile_java(args.javac, ['--release', '21', '-encoding', 'UTF-8', '-proc:none',
                     '-classpath', cp, '-d', classes, COMMON, *sorted((ROOT / 'src').rglob('*.java'))],
                     work / 'compiler.args')
        entries = {file.relative_to(classes).as_posix(): file.read_bytes() for file in classes.rglob('*.class')}
        entries['META-INF/neoforge.mods.toml'] = (ROOT / 'neoforge.mods.toml').read_bytes()
        entries['META-INF/LICENSE.txt'] = LICENSE.read_bytes()
        write_zip(work / 'addon.jar', entries)
        (work / 'addon.jar').replace(output)
    print(f'{hashlib.sha256(output.read_bytes()).hexdigest()}  {output.name}')
    if bundle is not None:
        bundle.parent.mkdir(parents=True, exist_ok=True)
        package = {output.name: output.read_bytes(), 'README.md': (ROOT / 'README.md').read_bytes(),
                   'LICENSE': LICENSE.read_bytes(), 'gateway/gateway.py': (ROOT.parent / 'harness/gateway.py').read_bytes()}
        for name in ('COMPANIONS.md', 'VALIDATION_COMPANIONS.md', 'companion-memory.mjs'):
            package[name] = (ROOT / name).read_bytes()
        for name in ('dsh_gateway.py', 'qwen_code.py', 'requirements.txt'):
            package[f'gateway/{name}'] = (ROOT / name).read_bytes()
        for row in sorted((ROOT / 'examples').glob('*.json')):
            package[f'examples/{row.name}'] = row.read_bytes()
        write_zip(bundle, package)
        print(f'{hashlib.sha256(bundle.read_bytes()).hexdigest()}  {bundle.name}')


if __name__ == '__main__':
    main()
