"""Rebuild only the two audited LibreLogin listeners against pinned 0.24.0.

All other upstream classes/resources are copied verbatim. Output stays outside
the repository; the unmodified official release remains the rollback artifact.
"""
import argparse, hashlib, json, subprocess, zipfile
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--proxy', required=True, type=Path)
p.add_argument('--jdk', required=True, type=Path)
p.add_argument('--output', required=True, type=Path)
a = p.parse_args()
root = Path(__file__).resolve().parent
upstream = a.proxy / 'plugins/LibreLogin-0.24.0.jar'
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
assert sha(upstream) == '3df848d4058e63f37cf9fe997542fd49c84374440d116a34ac4052278aa77e4f'
assert sha(a.proxy / 'velocity.jar') == 'fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef'
assert not a.output.exists(), 'Use a new output directory'
a.output.mkdir(parents=True)
classes = a.output / 'classes'
classes.mkdir()
deps = [upstream, a.proxy / 'velocity.jar', *sorted((a.proxy / 'plugins/librelogin/lib').rglob('*.jar'))]
cp = ';'.join(map(str, deps))
sources = sorted((root / 'src').rglob('*.java'))
subprocess.run([str(a.jdk / 'bin/javac.exe'), '-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', cp, '-d', str(classes), *map(str, sources)], check=True)
replacements = {f.relative_to(classes).as_posix(): f.read_bytes() for f in classes.rglob('*.class')}
prefixes = ('xyz/kyngs/librelogin/common/listener/AuthenticListeners', 'xyz/kyngs/librelogin/velocity/VelocityListeners')
assert replacements and all(n.startswith(prefixes) for n in replacements)
jar = a.output / 'LibreLogin-0.24.0.jar'
with zipfile.ZipFile(upstream) as src, zipfile.ZipFile(jar, 'w', zipfile.ZIP_DEFLATED) as dest:
    assert not any(n.upper().endswith(('.SF', '.RSA', '.DSA')) for n in src.namelist()), 'Signed upstream requires separate handling'
    for info in src.infolist():
        if not (info.filename.startswith(prefixes) and info.filename.endswith('.class')):
            dest.writestr(info, src.read(info.filename))
    for name, data in replacements.items():
        dest.writestr(name, data)
(a.output / 'classpath.txt').write_text(str(classes) + ';' + cp, encoding='utf-8')
(a.output / 'build.json').write_text(json.dumps({'upstreamSha256': sha(upstream), 'jarSha256': sha(jar), 'replacedClasses': sorted(replacements), 'sources': {str(f.relative_to(root)): sha(f) for f in sources}}, indent=2), encoding='utf-8')
print('Built pinned LibreLogin 0.24.0 with dual session listeners')
