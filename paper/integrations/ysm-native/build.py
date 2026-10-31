"""Build the optional Youer/native YSM adapter. Does not install or download anything."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--jdk', required=True, type=Path)
parser.add_argument('--classpath', required=True, nargs='+', type=Path)
args = parser.parse_args()
out = args.output.resolve()
assert not out.exists() and not out.is_relative_to(ROOT), 'Use a new external build directory'
classes = out / 'classes'
classes.mkdir(parents=True)
shared = ROOT.parent / 'freesia-optional/bridge/org/afuhome/appearance'
sources = list((ROOT / 'src').rglob('*.java')) + [shared / name for name in [
    'AutomaticAppearance.java', 'SelfAppearance.java', 'ModelCatalog.java', 'BedrockProjection.java']]
assert all(source.is_file() for source in sources)
subprocess.run([str(args.jdk / 'bin/javac.exe'), '-proc:none', '-encoding', 'UTF-8', '--release', '21',
                '-cp', ';'.join(map(str, args.classpath)), '-d', str(classes), *map(str, sources)], check=True)
jar = out / 'AgentAppearanceNative-0.4.0.jar'
with zipfile.ZipFile(jar, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in classes.rglob('*.class'):
        archive.write(file, file.relative_to(classes).as_posix())
    archive.writestr('plugin.yml', '''name: AgentAppearanceNative
version: 0.4.0
main: org.afuhome.appearance.NativeAppearance
api-version: '1.21'
description: Optional original-body YSM metadata and self selection for Youer.
commands:
  appearance:
    description: View and select your own verified native appearance.
    usage: /appearance status | list [page] | set <model> [texture]
''')
record = {'output': jar.name, 'sha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
          'sources': {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in sources},
          'dependencies': {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in args.classpath},
          'nativeArtifactRebuilt': False, 'productionWrites': False}
(out / 'build-manifest.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'output': jar.name, 'sha256': record['sha256'], 'productionWrites': False}))
