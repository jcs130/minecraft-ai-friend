"""Build the test-only visibility benchmark; this never installs or starts a server."""
from pathlib import Path
import argparse
import subprocess
import zipfile

p = argparse.ArgumentParser()
p.add_argument('--server', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--jdk', type=Path, default=Path('E:/MC/jdk/jdk-21.0.12.1+1'))
a = p.parse_args()
a.output.mkdir(exist_ok=False)
paper = Path(__file__).resolve().parents[1]
cp = [a.server / 'versions/1.21.1/paper-1.21.1.jar']
cp += sorted((a.server / 'libraries').rglob('*.jar')) + sorted((a.server / 'plugins').glob('*.jar'))
args = ['-proc:none', '-implicit:none', '-encoding', 'UTF-8', '--release', '21',
        '-cp', ';'.join(str(f.resolve()) for f in cp), '-d', str(a.output.resolve()),
        str(paper / 'plugins/AgentVision/tests/VisibilityBenchmark.java')]
argfile = a.output / 'javac.args'
argfile.write_text('\n'.join('"' + s.replace('\\', '/') + '"' for s in args), encoding='utf8')
subprocess.run([str(a.jdk / 'bin/javac.exe'), '@' + str(argfile)], check=True)
descriptor = '''name: VisibilityBenchmark
version: '1.0.0'
main: org.afuhome.agentvision.tests.VisibilityBenchmark
api-version: '1.21'
dependencies:
  server:
    numen:
      load: BEFORE
      required: true
      join-classpath: true
'''
with zipfile.ZipFile(a.output / 'VisibilityBenchmark-TEST-ONLY.jar', 'x', compression=zipfile.ZIP_DEFLATED) as out:
    out.writestr('paper-plugin.yml', descriptor)
    for file in a.output.rglob('*.class'):
        out.write(file, file.relative_to(a.output).as_posix())
print(a.output / 'VisibilityBenchmark-TEST-ONLY.jar')
