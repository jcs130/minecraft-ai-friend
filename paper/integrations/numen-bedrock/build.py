"""Build against explicit local dependencies; output is private, never installs."""
from pathlib import Path
import argparse, hashlib, json, subprocess, zipfile

ROOT = Path(__file__).resolve().parent
p = argparse.ArgumentParser()
for name in ('jdk', 'paper-api', 'core', 'numen-api', 'floodgate', 'geyser', 'libraries', 'output'):
    p.add_argument('--' + name, required=True, type=Path)
a = p.parse_args()
out = a.output.resolve()
assert not out.exists() and not out.is_relative_to(ROOT.parents[2]), 'Use a fresh private build directory'
deps = [a.paper_api, a.core, a.numen_api, a.floodgate, a.geyser]
assert all(path.is_file() for path in deps), 'Missing build dependency'
assert hashlib.sha256(a.numen_api.read_bytes()).hexdigest() == '3179afb4d5b6cc9f83588cce18eb5141c5f7f0876c790b78a80f1a168ec5a693', 'Different Numen API requires compatibility review'
out.mkdir(parents=True)
classes = out / 'classes'
classes.mkdir()
classpath = ';'.join(str(path.resolve()) for path in deps + sorted(a.libraries.rglob('*.jar')))
sources = sorted((ROOT / 'src').rglob('*.java'))
args = ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', classpath, '-d', str(classes), *map(str, sources)]
# javac argfile avoids the Windows command-line length limit. No credentials.
argfile = out / 'javac.args'
argfile.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in args), encoding='utf-8')
subprocess.run([str(a.jdk / 'bin/javac.exe'), '@' + str(argfile)], check=True)
test_classes = out / 'test-classes'
test_classes.mkdir()
test_args = ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', str(classes) + ';' + classpath,
             '-d', str(test_classes), *map(str, sorted((ROOT / 'test').rglob('*.java')))]
test_argfile = out / 'javac-test.args'
test_argfile.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in test_args), encoding='utf-8')
subprocess.run([str(a.jdk / 'bin/javac.exe'), '@' + str(test_argfile)], check=True)
run_args = ['-cp', str(test_classes) + ';' + str(classes) + ';' + classpath, 'org.afuhome.numen.FormsTest']
run_argfile = out / 'java-test.args'
run_argfile.write_text('\n'.join('"' + value.replace('\\', '/') + '"' for value in run_args), encoding='utf-8')
subprocess.run([str(a.jdk / 'bin/java.exe'), '@' + str(run_argfile)], check=True)
jar = out / 'NumenBedrock-0.1.0.jar'
with zipfile.ZipFile(jar, 'w', zipfile.ZIP_DEFLATED) as dst:
    for path in sorted(classes.rglob('*.class')):
        dst.writestr(path.relative_to(classes).as_posix(), path.read_bytes())
    dst.writestr('paper-plugin.yml', (ROOT / 'paper-plugin.yml').read_bytes())
    dst.writestr('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\r\npaperweight-mappings-namespace: mojang\r\n\r\n')
manifest = {
    'dependencies': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in deps},
    'sources': {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources},
    'tests': 'FormsTest passed; native Bedrock wire tests are separate',
    'outputs': {jar.name: hashlib.sha256(jar.read_bytes()).hexdigest()},
}
(out / 'build-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest['outputs']))
