"""Build the disposable Bukkit probe; never installs or starts a server."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess

parser = argparse.ArgumentParser(description=__doc__)
for name in ('server', 'jdk', 'output'):
    parser.add_argument('--' + name, type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent
output = args.output.resolve()
if output.exists() or output.is_relative_to(args.server.resolve()):
    parser.error('Use a new output directory outside the server')
libraries = list((args.server / 'libraries').rglob('*.jar'))
if not libraries:
    parser.error('The verified server copy must contain its API/dependency libraries')
output.mkdir(parents=True)
classes = output / 'classes'
classes.mkdir()
options = ['--release', '21', '-proc:none', '-encoding', 'UTF-8', '-cp',
           os.pathsep.join(map(str, libraries)), '-d', str(classes),
           str(source / 'src' / 'YouerUpstreamProbe.java')]
argfile = output / 'compile.args'
argfile.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in options), encoding='utf-8')
with (output / 'compile.log').open('wb') as log:
    subprocess.run([str(args.jdk / 'bin' / 'javac'), '@' + str(argfile)],
                   stdout=log, stderr=subprocess.STDOUT, check=True)
(classes / 'plugin.yml').write_text(
    'name: YouerUpstreamProbe\nversion: 1.0\nmain: org.qiandengji.test.YouerUpstreamProbe\n'
    'api-version: "1.21.1"\ncommands:\n  upstreamprobe:\n'
    '    description: Disposable console-only test\n', encoding='utf-8')
artifact = output / 'YouerUpstreamProbe.jar'
subprocess.run([str(args.jdk / 'bin' / 'jar'), '--create', '--file', str(artifact),
                '-C', str(classes), '.'], check=True)
receipt = {'artifact': artifact.name, 'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(),
           'productionChanged': False}
(output / 'build.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt))
