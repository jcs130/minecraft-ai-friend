"""Build the narrow FAWE hybrid-item event adapter; never installs it."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jdk', required=True, type=Path)
    parser.add_argument('--classpath', required=True, nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    assert not out.exists() and not out.is_relative_to(ROOT.parent.parent.parent)
    classes = out / 'classes'
    classes.mkdir(parents=True)
    sources = list((ROOT / 'src').rglob('*.java'))
    subprocess.run([str(args.jdk / 'bin/javac.exe'), '-proc:none', '-encoding', 'UTF-8',
                    '--release', '21', '-cp', ';'.join(map(str, args.classpath)),
                    '-d', str(classes), *map(str, sources)], check=True)
    jar = out / 'QiandengjiFaweHybrid-0.1.0.jar'
    with zipfile.ZipFile(jar, 'w', zipfile.ZIP_DEFLATED) as dst:
        for file in classes.rglob('*.class'):
            dst.write(file, file.relative_to(classes).as_posix())
        dst.writestr('plugin.yml', "name: QiandengjiFaweHybrid\nversion: 0.1.0\n"
                     "main: org.afuhome.compat.FaweHybrid\napi-version: '1.21'\n"
                     "softdepend: [FastAsyncWorldEdit]\n")
    report = {'sha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
              'sources': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
              'dependencies': {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in args.classpath}, 'productionWrites': False}
    (out / 'build-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'file': jar.name, 'sha256': report['sha256']}))


if __name__ == '__main__':
    main()
