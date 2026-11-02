"""Render one pixel using the camera's pinned Mesa runtime, without Minecraft."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--jdk', type=Path, required=True)
    parser.add_argument('--libraries', type=Path, required=True)
    parser.add_argument('--natives', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    output = args.out.resolve()
    repository = source.parents[3]
    if os.name != 'nt':
        raise SystemExit('This probe requires the reviewed Windows x64 Mesa runtime')
    if output.exists() or output.is_relative_to(repository):
        raise SystemExit('Use a new external diagnostics directory')
    executable = args.jdk / 'bin' / 'qiandeng-camera.exe'
    if not executable.is_file() or not args.natives.is_dir():
        raise SystemExit('Missing reviewed camera executable or native libraries')
    libraries = list(args.libraries.resolve().rglob('*.jar'))
    if not libraries:
        raise SystemExit('Missing installed Java libraries')
    output.mkdir(parents=True)
    classes = output / 'classes'
    classes.mkdir()
    classpath = os.pathsep.join(map(str, libraries + [classes]))
    values = ['--release', '21', '-encoding', 'UTF-8', '-proc:none',
              '-classpath', classpath, '-d', str(classes),
              str(source.parent / 'client' / 'MesaIntelAdapter.java'),
              str(source / 'CameraAdapterProbe.java')]
    arguments = output / 'compile.args'
    arguments.write_text('\n'.join('"' + value.replace('\\', '/').replace('"', '\\"') + '"'
                                    for value in values), encoding='utf-8')
    subprocess.run([str(args.jdk / 'bin' / 'javac.exe'), '@' + str(arguments)], check=True)
    launch = [str(executable), '-Dqiandeng.camera.enabled=true',
              '-Dqiandeng.camera.mesaIntelAdapter=true',
              '-Djava.library.path=' + str(args.natives.resolve()),
              '-Dorg.lwjgl.librarypath=' + str(args.natives.resolve()),
              '-classpath', classpath, 'CameraAdapterProbe']
    environment = dict(os.environ, GALLIUM_DRIVER='d3d12', WGL_DISABLE_ERROR_DIALOGS='1')
    checks = []
    for mode, extra in [('actual-pixel', []),
                        ('missing-runtime', ['missing-library', str(output / 'missing-runtime')])]:
        result = subprocess.run(launch + extra, capture_output=True, text=True,
                                env=environment, timeout=30)
        (output / (mode + '.out')).write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
        checks.append({'mode': mode, 'exitCode': result.returncode, 'output': result.stdout.strip()})
        if result.returncode:
            raise SystemExit('Probe failed: ' + mode + '; see isolated output')
    (output / 'result.json').write_text(json.dumps({'passed': True, 'checks': checks}, indent=2) + '\n')
    print(json.dumps({'passed': True, 'checks': checks}))


if __name__ == '__main__':
    main()
