"""Build a narrow, pinned bridge overlay; never install into a live server."""
from pathlib import Path
import argparse, hashlib, json, subprocess, tempfile, zipfile

p = argparse.ArgumentParser()
for key in ('baseline', 'classpath-file', 'javac', 'output'):
    p.add_argument('--' + key, type=Path, required=True)
a = p.parse_args()
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert a.baseline.resolve() != a.output.resolve()
assert sha(a.baseline) == 'fbf629147c0d089f27a27f97d7ad3b2dc71d2a59fde2ca55ec00afb6c837c628', 'Review changed production baseline'
names = ('HybridMaidPlugin', 'NativeMaidInventory')
prefix = 'local/tlmcompat/hybrid/'
root = Path(__file__).parent
replace = lambda n: any(n == prefix + c + '.class' or n.startswith(prefix + c + '$') for c in names)
a.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='inventory-receipts-', dir=a.output.parent) as tmp:
    temp = Path(tmp)
    args = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-cp', str(a.baseline) + ';' + a.classpath_file.read_text(encoding='utf-8-sig').strip(), '-d', str(temp / 'classes')]
    args += [str(root / 'hybrid-src' / prefix / (n + '.java')) for n in names]
    argfile = temp / 'javac.args'
    argfile.write_text('\n'.join('"' + v.replace('\\', '/') + '"' for v in args), encoding='utf-8')
    subprocess.run([str(a.javac), '-J-Duser.language=en', '-J-Dfile.encoding=UTF-8', '@' + str(argfile)], check=True)
    with zipfile.ZipFile(a.baseline) as old, zipfile.ZipFile(a.output, 'w', zipfile.ZIP_DEFLATED) as new:
        for entry in old.infolist():
            if replace(entry.filename):
                continue
            data = old.read(entry.filename)
            if entry.filename == 'plugin.yml':
                data = ('\n'.join('version: 0.1.15-inventory-receipts' if s.startswith('version:') else s for s in data.decode().splitlines()) + '\n').encode()
            new.writestr(entry, data)
        for file in sorted((temp / 'classes').rglob('*.class')):
            name = file.relative_to(temp / 'classes').as_posix()
            if replace(name):
                entry = zipfile.ZipInfo(name, (2026, 11, 9, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                new.writestr(entry, file.read_bytes())
    with zipfile.ZipFile(a.baseline) as old, zipfile.ZipFile(a.output) as new:
        untouched = [n for n in old.namelist() if n != 'plugin.yml' and not replace(n)]
        assert all(old.read(n) == new.read(n) for n in untouched)
        assert set(old.namelist()) == set(new.namelist())
    print(json.dumps({'artifact': str(a.output), 'sha256': sha(a.output), 'unrelatedEntriesPreserved': len(untouched)}))
