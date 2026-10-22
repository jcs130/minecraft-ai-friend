"""Build the server-only mailbox against the exact local NeoForge/MixAuth APIs."""
import argparse, hashlib, json, os, subprocess, tempfile, zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
p = argparse.ArgumentParser(description=__doc__)
for name in ('server', 'jdk', 'output'):
    p.add_argument('--' + name, type=Path, required=True)
p.add_argument('--neoforge', default='21.1.250')
a = p.parse_args()
assert a.neoforge == '21.1.250', 'Revalidate a new native API before changing this pin'
mix = a.server / 'mods/mixauth-1.21.1-1.3.3.jar'
assert mix.is_file() and hashlib.sha256(mix.read_bytes()).hexdigest() == 'c57bd2c5ce9f911f8935102aa5beb77b3df147071d669ff5e1f8696e4f98bc3d', 'Exact reviewed MixAuth 1.3.3 is required'
libs = a.server / 'libraries'
neo = libs / f'net/neoforged/neoforge/{a.neoforge}'
cp = [neo / f'neoforge-{a.neoforge}-server.jar',
      libs / 'net/minecraft/server/1.21.1-20240808.144430/server-1.21.1-20240808.144430-srg.jar',
      neo / f'neoforge-{a.neoforge}-universal.jar', mix, *sorted(libs.rglob('*.jar'))]
assert all(f.is_file() for f in cp[:4])
a.output.mkdir(parents=True, exist_ok=False)
sources = sorted((root / 'src').rglob('*.java'))
quote = lambda s: '"' + str(s).replace('\\', '/') + '"'
with tempfile.TemporaryDirectory(prefix='classes-', dir=a.output) as temp:
    classes = Path(temp)
    args = a.output / 'compile.args'
    args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp',
                              quote(os.pathsep.join(map(str, cp))), '-d', quote(classes), *map(quote, sources)]), encoding='utf-8')
    result = subprocess.run([str(a.jdk / 'bin/javac.exe'), '@' + str(args)], capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=180)
    (a.output / 'compile.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    jar = a.output / 'qiandeng-world-accounts-0.1.0.jar'
    with zipfile.ZipFile(jar, 'x', zipfile.ZIP_DEFLATED) as archive:
        for folder in (classes, root / 'resources'):
            for file in sorted(folder.rglob('*')):
                if file.is_file():
                    info = zipfile.ZipInfo(file.relative_to(folder).as_posix(), (1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, file.read_bytes())
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
record = dict(schemaVersion=1, jar=str(jar), sha256=sha(jar), serverOnly=True, clientRequired=False,
              minecraft='1.21.1', neoforge=a.neoforge, mixauthSha256=sha(mix),
              sources={str(f.relative_to(root)): sha(f) for f in [Path(__file__), *sources, *sorted((root/'resources').rglob('*'))] if f.is_file()})
(a.output / 'build.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
print(json.dumps({k: record[k] for k in ('jar', 'sha256', 'serverOnly', 'clientRequired')}))
