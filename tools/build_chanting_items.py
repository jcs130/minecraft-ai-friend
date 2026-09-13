"""Build the shared D-project chanting-items mod. No deployment or game calls."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'world/chanting-items-src'
ITEMS = ('whispering_staff', 'resonance_staff')


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def geometry_parent_chain(model, load_model):
    """An elements model must never reach Minecraft's sprite/entity baker roots.

    ModelBakerImpl replaces any builtin/generated-root model with layer-derived
    geometry. A handheld parent therefore discards these staffs' own elements.
    Follow ancestors rather than merely checking the immediate parent spelling.
    """
    chain = []
    parent = model.get('parent')
    while parent:
        assert isinstance(parent, str) and re.fullmatch(r'(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+', parent), 'Invalid model parent'
        canonical = parent if ':' in parent else 'minecraft:' + parent
        assert canonical not in ('minecraft:builtin/generated', 'minecraft:builtin/entity'), '3D staff cannot inherit builtin/generated or builtin/entity'
        assert canonical not in chain and len(chain) < 16, 'Cyclic or excessive model parent chain'
        chain.append(canonical)
        parent = load_model(canonical).get('parent')
    return chain


def check_resources(minecraft):
    resources = SOURCE / 'resources'
    meta = tomllib.loads((resources / 'META-INF/neoforge.mods.toml').read_text('utf-8'))
    assert meta['mods'][0]['modId'] == 'qiandeng_chanting'
    assert meta['mixins'][0]['config'] == 'qiandeng_chanting.client.mixins.json'
    mixin = json.loads((resources / meta['mixins'][0]['config']).read_text('utf-8'))
    assert mixin.get('client') == ['StaffPttMixin', 'StaffHotbarMixin', 'StaffAudioMixin'] and not mixin.get('mixins'), 'PTT/hotbar mixins must be client-only'
    parsed = {p.relative_to(resources).as_posix(): json.loads(p.read_text('utf-8')) for p in resources.rglob('*.json')}
    language = parsed['assets/qiandeng_chanting/lang/zh_cn.json']
    texture_names = set()
    for item in ITEMS:
        model = parsed[f'assets/qiandeng_chanting/models/item/{item}.json']
        assert model['elements'] and all(t.startswith('minecraft:block/') for t in model['textures'].values())
        texture_names.update(model['textures'].values())
        for element in model['elements']:
            assert all(-16 <= lo < hi <= 32 for lo, hi in zip(element['from'], element['to']))
            assert all(face['texture'][1:] in model['textures'] for face in element['faces'].values())
        recipe = parsed[f'data/qiandeng_chanting/recipe/{item}.json']
        assert recipe['result'] == {'id': 'qiandeng_chanting:' + item, 'count': 1}
        assert recipe['type'] == 'minecraft:crafting_shaped'
        assert set(''.join(recipe['pattern']).replace(' ', '')) == set(recipe['key'])
        assert language['item.qiandeng_chanting.' + item]
        assert parsed[f'data/qiandeng_chanting/advancement/recipes/tools/{item}.json']['rewards']['recipes'] == ['qiandeng_chanting:' + item]
    vanilla = minecraft / 'libraries/net/minecraft/client/1.21.1-20240808.144430/client-1.21.1-20240808.144430-extra.jar'
    parent_chains = {}
    with zipfile.ZipFile(vanilla) as archive:
        def load_parent(identifier):
            namespace, name = identifier.split(':', 1)
            path = f'assets/{namespace}/models/{name}.json'
            return parsed[path] if path in parsed else json.loads(archive.read(path))
        for item in ITEMS:
            parent_chains[item] = geometry_parent_chain(parsed[f'assets/qiandeng_chanting/models/item/{item}.json'], load_parent)
            assert parent_chains[item] == ['minecraft:block/block'], 'Use the verified vanilla 3D geometry parent'
        # Regression: the former real vanilla handheld -> generated chain must
        # fail even though the local model itself declares valid elements.
        try:
            geometry_parent_chain({'parent': 'minecraft:item/handheld'}, load_parent)
        except AssertionError as error:
            assert 'builtin/generated' in str(error)
        else:
            raise AssertionError('Former invisible handheld model was not rejected')
        for texture in texture_names:
            name = 'assets/minecraft/textures/' + texture.split(':', 1)[1] + '.png'
            assert archive.read(name).startswith(b'\x89PNG\r\n\x1a\n'), 'Missing original vanilla texture: ' + name
    return {'ok': True, 'json_files': len(parsed), 'item_models': 2, 'recipes': 2, 'existing_vanilla_textures': len(texture_names),
            'geometry_parent_chains': parent_chains, 'former_generated_chain_rejected': True,
            'scope': 'Offline geometry/vanilla parent-chain/recipe/PNG checks; rendered item appearance requires separate client screenshots'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--minecraft', type=Path, default=Path(os.environ.get('APPDATA', '')) / '.minecraft')
    parser.add_argument('--libraries', type=Path, default=ROOT / 'server/mc/libraries')
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get('JDK21_BIN', r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    suffix = '.exe' if os.name == 'nt' else ''
    javac, java = args.jdk_bin / ('javac' + suffix), args.jdk_bin / ('java' + suffix)
    if not javac.is_file():
        raise SystemExit('Java 21 JDK required; set JDK21_BIN or --jdk-bin')
    server = module('chanting_server_cp', ROOT / 'world/botgate-src/build.py')
    client = module('chanting_client_cp', ROOT / 'world/client-controls-src/build.py')
    # Read-only official caches; this mod has no compile dependency on Iron's.
    dependencies = list(dict.fromkeys([*map(Path, server.full_cp(args.libraries).split(os.pathsep)), *client.classpath(args.minecraft), ROOT/'client/mods/voicechat-neoforge-1.21.1-2.6.22.jar']))
    resources = check_resources(args.minecraft)
    sources = sorted((SOURCE / 'src').rglob('*.java'))
    build_root = (ROOT / 'runtime/chanting-build').resolve()
    build_root.mkdir(parents=True, exist_ok=True)
    target = ROOT / 'vendor/chanting-cache/qiandeng-chanting-0.1.0.jar'
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='classes-', dir=build_root) as temporary:
        classes = Path(temporary).resolve()
        assert classes.is_relative_to(build_root) and build_root.is_relative_to(ROOT.resolve())
        quote = lambda value: '"' + str(value).replace('\\', '/').replace('"', '\\"') + '"'
        argfile = classes / 'javac.args'
        argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp',
            quote(os.pathsep.join(map(str, dependencies))), '-d', quote(classes), *map(quote, sources)]) + '\n', encoding='utf-8')
        subprocess.run([str(javac), '@' + str(argfile)], check=True, timeout=180)
        tests = sorted((SOURCE / 'tests').glob('*.java'))
        # Pure tests compile separately, with only JDK + the actual state classes.
        test_classes = classes / 'tests'
        test_classes.mkdir()
        pure_sources = [SOURCE / ('src/dev/qiandeng/chanting/' + name + '.java') for name in
            ['GestureBook', 'StaffAudioSession', 'client/StaffAudioGate', 'client/StaffAudioDrain', 'client/StaffPttState', 'client/StaffInputEdge', 'client/StaffContextGuard', 'client/StaffReleaseGate']]
        subprocess.run([str(javac), '--release', '21', '-encoding', 'UTF-8', '-d', str(test_classes), *map(str, pure_sources), *map(str, tests)], check=True, timeout=60)
        results = {}
        for test in tests:
            output = subprocess.run([str(java), '-cp', str(test_classes), test.stem], check=True,
                capture_output=True, text=True, encoding='utf-8', timeout=15)
            try:
                results[test.stem] = json.loads(output.stdout)
            except json.JSONDecodeError:
                # The existing client fixture also has a human-readable form.
                match = re.fullmatch(r'StaffPttStateTest: (\d+) assertions passed; no audio was captured\.', output.stdout.strip())
                if test.stem != 'StaffPttStateTest' or not match:
                    raise
                results[test.stem] = {'ok': True, 'assertions': int(match.group(1))}
            assert results[test.stem]['ok'] is True
        entries = [(p, p.relative_to(classes).as_posix()) for p in (classes / 'dev').rglob('*.class')]
        entries += [(p, p.relative_to(SOURCE / 'resources').as_posix()) for p in (SOURCE / 'resources').rglob('*') if p.is_file()]
        # No test classes, private state, keys, caches, or source paths enter the mod.
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path, name in sorted(entries, key=lambda pair: pair[1]):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, path.read_bytes())
        with zipfile.ZipFile(target) as archive:
            assert archive.testzip() is None
            assert 'dev/qiandeng/chanting/client/mixin/StaffPttMixin.class' in archive.namelist()
            assert all(not n.startswith('tests/') for n in archive.namelist())
    inputs = [*sources, *tests, *[p for p in (SOURCE / 'resources').rglob('*') if p.is_file()], Path(__file__)]
    record = {'ok': True, 'mod_id': 'qiandeng_chanting', 'version': '0.1.0', 'minecraft': '1.21.1',
        'neoforge': '21.1.248', 'java_release': 21, 'side': 'both', 'jar': str(target),
        'sha256': digest(target), 'tests': results, 'resources': resources,
        'source_files': [{'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p)} for p in sorted(inputs)],
        'deployment': 'not performed', 'live_validation': 'pending'}
    (build_root / 'build-record.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: record[k] for k in ['ok', 'jar', 'sha256', 'tests', 'resources', 'deployment', 'live_validation']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
