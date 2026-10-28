"""Build the optional native player addon; never mutates a live installation."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import zipfile

from build_addons import classpath, sha
from recipe_catalog_patch import patch as patch_recipes

HERE = Path(__file__).parent
SHARED = ('PlayerRecipeCatalog.java', 'RecipeIngredientEncoding.java')


def build(source, server, java, output):
    source, server, output = map(lambda p: Path(p).resolve(), (source, server, output))
    output.mkdir(parents=True, exist_ok=False)
    if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Reusable recipe source must be a clean checkout')
    cp = classpath(server) + sorted((server / 'mods').glob('*.jar'))
    own = HERE / 'native-bridge'
    originals = source / 'world/society-bridge-src/src/main/java/dev/qiandeng/maw'
    inputs = sorted((own / 'src').rglob('*.java'))
    shared = [originals / name for name in SHARED]
    with tempfile.TemporaryDirectory(prefix='native-', dir=output) as name:
        work = Path(name)
        derived = work / 'src'
        derived.mkdir()
        for path in shared:
            text = path.read_text(encoding='utf-8')
            if path.name == 'PlayerRecipeCatalog.java':
                text = patch_recipes(text)
            marker = 'package dev.qiandeng.maw;'
            if text.count(marker) != 1:
                raise ValueError('Recipe source package changed')
            target = derived / path.name
            target.write_text(text.replace(marker, 'package dev.qiandeng.maw.taunative;'), encoding='utf-8')
            inputs.append(target)
        # NeoForge embeds API dependencies in jarjar entries. Read, never install them.
        for mod in list(cp):
            if mod.parent != server / 'mods':
                continue
            with zipfile.ZipFile(mod) as archive:
                for entry in archive.namelist():
                    if entry.startswith('META-INF/jarjar/') and entry.endswith('.jar'):
                        data = archive.read(entry)
                        target = work / (hashlib.sha256(data).hexdigest()[:16] + '.jar')
                        if not target.exists():
                            target.write_bytes(data)
                            cp.append(target)
        classes = work / 'classes'
        classes.mkdir()
        quote = lambda p: '"' + str(p).replace('\\', '/') + '"'
        args = work / 'javac.args'
        args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8',
            '-cp', quote(os.pathsep.join(map(str, cp))), '-d', quote(classes), *map(quote, inputs)]), encoding='utf-8')
        compile_inputs = {str(p.relative_to(server)) if p.is_relative_to(server) else 'jarjar/' + p.name: sha(p) for p in cp}
        result = subprocess.run([str(Path(java).with_name('javac.exe')), '-J-Duser.language=en', '@' + str(args)],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
        (output / 'compile.log').write_text(result.stdout + result.stderr, encoding='utf-8')
        if result.returncode:
            raise RuntimeError(result.stderr[-12000:])
        resources = own / 'resources'
        files = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
        files.update({p.relative_to(resources).as_posix(): p.read_bytes() for p in resources.rglob('*') if p.is_file()})
        files['native-operations.json'] = (own / 'operations.json').read_bytes()
        artifact = output / 'maw-tau-native-0.1.0.jar'
        with zipfile.ZipFile(artifact, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in sorted(files.items()):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, content)
    record = {'schemaVersion': 1, 'artifact': artifact.name, 'sha256': sha(artifact),
        'sourceCommit': subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
        'compilerSha256': sha(Path(java).with_name('javac.exe')), 'compileInputs': compile_inputs,
        'sharedSource': {p.name: sha(p) for p in shared},
        'recipePatchSha256': sha(HERE / 'recipe_catalog_patch.py'),
        'nativeSource': {p.relative_to(own).as_posix(): sha(p) for p in own.rglob('*') if p.is_file()},
        'minecraft': '1.21.1', 'neoforge': '21.1.234', 'serverOnly': True, 'installed': False,
        'thirdPartyModified': False}
    (output / 'build-record.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('source', 'server', 'java', 'output'):
        parser.add_argument('--' + key, required=True, type=Path)
    args = parser.parse_args()
    result=build(args.source, args.server, args.java, args.output)
    print(json.dumps({key:result[key] for key in ('artifact','sha256','minecraft','neoforge','installed')}))
