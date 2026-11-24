"""Build the explicitly approved complete recipe-book guide as a minimal native-platform overlay.
Only two new classes, the mixin registration and version metadata change. No production installation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

BASE_SHA = 'f08e83768ea917d3d40680be7e2e2e8c208b27316be11f810d58775b83ed2841'
PREFIX = 'local/tlmcompat/numen/'
CLASSES = [PREFIX + 'RecipeBookGuide.class', PREFIX + 'mixin/RecipeBookGuideInit.class']
RESOURCES = ['qiandengji-native.mixins.json', 'META-INF/neoforge.mods.toml']


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--jdk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert sha(args.baseline) == BASE_SHA, 'Native-platform baseline changed; audit before building'
    assert not args.output.exists(), 'Output already exists; no overwrite or build replay'
    root = Path(__file__).resolve().parent
    sources = [root / 'platform-src/local/tlmcompat/numen/RecipeBookGuide.java',
               root / 'platform-src/local/tlmcompat/numen/mixin/RecipeBookGuideInit.java']
    assert all(file.is_file() for file in sources)
    patched = list((args.runtime / 'libraries/net/neoforged/neoforge').glob('21.1.*/neoforge-*-server.jar'))
    game = list((args.runtime / 'libraries/net/minecraft/server').glob('1.21.1-*/server-*-srg.jar'))
    assert len(patched) == len(game) == 1, 'Exact observed Minecraft/NeoForge runtime inputs required'
    libraries = sorted((args.runtime / 'libraries').rglob('*.jar'))
    cp = os.pathsep.join(str(p) for p in [args.baseline, patched[0], game[0], *libraries])
    args.output.mkdir(parents=True)
    classes = args.output / 'classes'
    classes.mkdir()
    argfile = args.output / 'javac.args'
    quoted = lambda value: '"' + str(value).replace('\\', '/') + '"'
    compiler = ['--release', '21', '-encoding', 'UTF-8', '-proc:none', '-classpath', cp, '-d', classes, *sources]
    argfile.write_text('\n'.join(quoted(p) for p in compiler) + '\n', encoding='utf8')
    subprocess.run([str(args.jdk / 'bin/javac.exe'), '@' + str(argfile)], check=True)
    compiled = {str(p.relative_to(classes)).replace('\\', '/'): p.read_bytes() for p in classes.rglob('*.class')}
    assert set(compiled) == set(CLASSES), 'Unexpected generated native-platform classes'
    tests = [root / 'tests/RecipeBookGuideCheck.java', root / 'tests/RecipeBookGuideQa.java']
    test_classes = args.output / 'test-classes'
    test_classes.mkdir()
    test_cp = os.pathsep.join([str(classes), cp])
    test_args = args.output / 'test-javac.args'
    test_args.write_text('\n'.join(quoted(p) for p in ['--release', '21', '-encoding', 'UTF-8', '-proc:none',
                          '-classpath', test_cp, '-d', test_classes, *tests]) + '\n', encoding='utf8')
    subprocess.run([str(args.jdk / 'bin/javac.exe'), '@' + str(test_args)], check=True)
    # NeoForge registry initialization requires its genuine loader, not a mocked LoadingModList.
    # The test-only mod runs the unchanged real-state assertions after the isolated server starts.
    probe = args.output / 'recipebook-qa-probe.jar'
    with zipfile.ZipFile(probe, 'x', zipfile.ZIP_DEFLATED) as jar:
        for file in test_classes.rglob('*.class'):
            jar.writestr(str(file.relative_to(test_classes)).replace('\\', '/'), file.read_bytes())
        jar.writestr('META-INF/neoforge.mods.toml', 'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="recipeguideqa"\nversion="1.0"\ndisplayName="Isolated recipe-book assertions; never deploy"\n')

    with zipfile.ZipFile(args.baseline) as jar:
        assert not any(n.upper().endswith(('.SF', '.RSA', '.DSA')) for n in jar.namelist()), 'Signed baseline needs its original signing workflow'
        original = {n: jar.read(n) for n in jar.namelist() if not n.endswith('/')}
    assert all(name not in original for name in CLASSES), 'Guide already exists in baseline'
    config = json.loads(original[RESOURCES[0]])
    assert config['package'] == 'local.tlmcompat.numen.mixin' and config['required'] is True
    assert 'RecipeBookGuideInit' not in config['mixins']
    config['mixins'].append('RecipeBookGuideInit')
    mods = original[RESOURCES[1]].decode('utf8')
    assert mods.count('version="0.1.8"') == 1
    replacement = {**compiled,
                   RESOURCES[0]: (json.dumps(config, separators=(',', ':')) + '\n').encode('utf8'),
                   RESOURCES[1]: mods.replace('version="0.1.8"', 'version="0.1.9"', 1).encode('utf8')}
    candidate = args.output / 'qiandengji-native-platform-0.1.9-recipebook.jar'
    with zipfile.ZipFile(candidate, 'x', zipfile.ZIP_DEFLATED) as jar:
        for name, value in original.items():
            jar.writestr(name, replacement.get(name, value))
        for name in CLASSES:
            jar.writestr(name, replacement[name])
    with zipfile.ZipFile(candidate) as jar:
        unchanged = [name for name, value in original.items() if name not in RESOURCES and jar.read(name) == value]
        assert len(unchanged) == len(original) - len(RESOURCES), 'Unrelated native-platform behavior changed'
        for family in ['NativeClientProjection', 'NativeClientRecipes']:
            name = PREFIX + family + '.class'
            assert jar.read(name) == original[name], 'Existing mod compatibility filtering must remain byte-identical'
    manifest = {'version': '0.1.9', 'baselineSha256': BASE_SHA, 'candidate': str(candidate),
                'sha256': sha(candidate), 'newClasses': CLASSES, 'changedResources': RESOURCES,
                'unchangedEntriesByteIdentical': len(unchanged),
                'sources': {str(file): sha(file) for file in sources},
                'scope': 'User-approved complete compatible recipe-book visibility for all players; no craft, XP, item or permission grant',
                'qaProbe': str(probe), 'runtimeStateChecks': 'COMPILED_NOT_YET_RUN',
                'productionModified': False, 'playerDataImported': False, 'worldRestored': False}
    (args.output / 'build-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
