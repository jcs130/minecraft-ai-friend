"""Convert locked TLM/YSM model packs, preserving original geometry and PNGs.

This is a resource adapter, not a port of Java animation controllers or mod GUI.
The paired pinned Geyser extension binds tracked maids and this account's skin.
"""
from __future__ import annotations
import argparse
import copy
import datetime
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import uuid
import zipfile
from PIL import Image
from maw_bedrock_resources import Assets, encoded, sha

CATALOG = 'modpack-catalog.json'
CONTRACT = 'modpack-contract.json'
EXTENSION = 'MawModels.jar'
VERSION = [1, 0, 2]
TLM_SHA = 'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27'
YSM_SHA = 'b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb'
RESOURCE = re.compile(r'^[a-z0-9_.-]+:[a-z0-9_./-]+$')


def relative(key):
    path = PurePosixPath(key)
    if not key or path.is_absolute() or '..' in path.parts or '\\' in key:
        raise ValueError('unsafe_model_resource_path')
    return path


def geometry(raw, identifier):
    """1.10 description relocation only; never rebuild or approximate cubes."""
    original = json.loads(raw)
    if 'minecraft:geometry' in original:
        if len(original['minecraft:geometry']) != 1:
            raise ValueError('multiple_geometry_definitions')
        body = copy.deepcopy(original['minecraft:geometry'][0])
    else:
        keys = [k for k in original if k.startswith('geometry.')]
        if original.get('format_version') != '1.10.0' or len(keys) != 1:
            raise ValueError('unsupported_geometry_format')
        old = copy.deepcopy(original[keys[0]])
        description = {'texture_width': old.pop('texturewidth'), 'texture_height': old.pop('textureheight')}
        for key in ['visible_bounds_width', 'visible_bounds_height', 'visible_bounds_offset']:
            if key in old: description[key] = old.pop(key)
        body = {'description': description, **old}
    bones = body.get('bones')
    if not isinstance(bones, list) or not bones or len(bones) > 2048:
        raise ValueError('invalid_geometry_bones')
    names = [bone['name'] for bone in bones]
    if len(set(names)) != len(names): raise ValueError('duplicate_geometry_bones')
    for bone in bones:
        if bone.get('parent') and bone['parent'] not in names: raise ValueError('missing_bone_parent')
        if any(k in bone for k in ['poly_mesh', 'texture_mesh']): raise ValueError('mesh_geometry_requires_separate_adapter')
    body['description']['identifier'] = identifier
    w, h = body['description']['texture_width'], body['description']['texture_height']
    if not isinstance(w, int) or not isinstance(h, int) or not 1 <= w <= 2048 or not 1 <= h <= 2048:
        raise ValueError('invalid_geometry_texture_size')
    # The source bone objects, rotations, inflations, zero-width cubes and per-
    # face UVs remain byte-for-value identical after JSON parsing.
    return {'format_version': original.get('format_version') if 'minecraft:geometry' in original else '1.12.0',
            'minecraft:geometry': [body]}, (w, h)


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        for key, value in sorted(entries.items()):
            relative(key)
            if len(key) >= 80: raise ValueError('bedrock_resource_path_too_long')
            info = zipfile.ZipInfo(key, (2026, 10, 9, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, value)
    return output.getvalue()


def compile_extension(geyser: Path, java_bin: Path, output: Path):
    root = Path(__file__).resolve().parents[1]/'world/bedrock-models-src'
    classes = output/'classes'; classes.mkdir(parents=True, exist_ok=True)
    sources = list((root/'src').rglob('*.java'))
    subprocess.run([str(java_bin/'javac.exe'), '-J-Duser.language=en', '-proc:none', '-encoding', 'UTF-8',
                    '-classpath', str(geyser), '-d', str(classes), *map(str, sources)], check=True)
    files = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
    files['extension.yml'] = (root/'extension.yml').read_bytes()
    files['META-INF/MANIFEST.MF'] = b'Manifest-Version: 1.0\r\n\r\n'
    (output/EXTENSION).write_bytes(archive(files))


def build(asset_root: Path, output: Path, *, extension: Path, geyser: Path):
    assets = Assets(asset_root)
    source_hashes = {row['sha256'] for row in assets.manifest.get('sources', [])}
    if not {TLM_SHA, YSM_SHA} <= source_hashes: raise ValueError('Model metadata adapter needs the locked TLM/YSM source JARs')
    rows, excluded = [], []
    entries = {kind: {} for kind in ['touhou', 'ysm']}
    ids = set()

    def add(kind, model_id, texture_id, model_key, texture_key, definition, scale=1.0, metadata=None):
        relative(model_key); relative(texture_key)
        raw_model, png = assets.read(model_key), assets.read(texture_key)
        original_hash = sha(raw_model)
        geo_id = 'geometry.maw_native.'+original_hash[:24]
        converted, dimensions = geometry(raw_model, geo_id)
        im = Image.open(io.BytesIO(png)); im.verify()
        im = Image.open(io.BytesIO(png))
        if im.size != dimensions: raise ValueError('geometry_png_size_mismatch')
        fingerprint = sha(encoded([kind, model_id, texture_id]))[:24]
        identifier = 'maw_native:'+kind+'_'+fingerprint
        if identifier in ids: raise ValueError('duplicate_model_binding')
        ids.add(identifier)
        model_path = 'models/entity/maw/'+original_hash[:24]+'.geo.json'
        texture_path = 'textures/entity/maw/'+sha(png)[:32]+'.png'
        entity_path = 'entity/maw/'+fingerprint+'.entity.json'
        entries[kind][model_path] = encoded(converted)
        if texture_path in entries[kind] and entries[kind][texture_path] != png: raise ValueError('texture_hash_prefix_collision')
        entries[kind][texture_path] = png
        entries[kind][entity_path] = encoded({'format_version': '1.10.0', 'minecraft:client_entity': {
            'description': {'identifier': identifier, 'materials': {'default': 'entity_alphatest'},
            'textures': {'default': texture_path[:-4]}, 'geometry': {'default': geo_id},
            'render_controllers': ['controller.render.maw_native']}}})
        source_definition = assets.read(definition)
        entries[kind]['credits/'+sha(source_definition)[:24]+'.json'] = source_definition
        rows.append({'kind': kind, 'modelId': model_id, 'textureId': texture_id,
                     'bedrockIdentifier': identifier, 'pack': 'maw-'+kind+'-models.mcpack',
                     'geometry': model_path, 'texture': texture_path, 'geometryIdentifier': geo_id,
                     'scale': scale, 'sourceDefinition': definition, 'sourceModel': model_key,
                     'sourceTexture': texture_key, 'sourcePngSha256': sha(png),
                     'metadata': metadata or {}, 'javaAnimationControllersAdapted': False})
        rows[-1]['playerSkinEligible'] = kind == 'ysm' and im.size in [(64, 32), (64, 64), (128, 128)]

    for key in sorted(assets.manifest['assets']):
        if '/tlm_custom_pack/' in key and key.endswith('/maid_model.json'):
            definition = assets.json(key)
            prefix = key.rsplit('/assets/', 1)[0]+'/assets/'
            for row in definition.get('model_list', []):
                model_id = row['model_id']; namespace, local = model_id.split(':', 1)
                def resolve(resource):
                    if not RESOURCE.fullmatch(resource): raise ValueError('invalid_model_resource_id')
                    ns, name = resource.split(':', 1)
                    return prefix+ns+'/'+relative(name).as_posix()
                try:
                    model = resolve(row.get('model', namespace+':models/entity/'+local+'.json'))
                    textures = [namespace+':textures/entity/'+local+'.png', *row.get('extra_textures', [])]
                    for n, texture in enumerate(textures):
                        # TLM CustomModelPack.decorate() uses MD5(resource path),
                        # without namespace, for each additional texture suffix.
                        suffix = '' if n == 0 else '_'+hashlib.md5(texture.split(':', 1)[1].encode()).hexdigest()
                        add('touhou', model_id+suffix, texture, model, resolve(texture), key,
                            row.get('render_entity_scale', 1.0), {'isGecko': row.get('is_gecko', False)})
                except (ValueError, FileNotFoundError, KeyError) as error:
                    excluded.append({'kind': 'touhou', 'modelId': model_id, 'reason': str(error)})
        elif key.startswith('assets/yes_steve_model/builtin/') and key.endswith('/ysm.json'):
            try:
                definition = assets.json(key); prefix = key[:-len('ysm.json')]
                model_id = prefix[len('assets/yes_steve_model/builtin/'):-1]
                player = definition['files']['player']
                model = prefix+relative(player['model']['main']).as_posix()
                for texture in player['texture']:
                    if isinstance(texture, dict) and set(texture) == {'uv'}: texture = texture['uv']
                    if not isinstance(texture, str): raise ValueError('multi_channel_ysm_texture_requires_adapter')
                    texture_id = PurePosixPath(texture).stem
                    add('ysm', model_id, texture_id, model, prefix+relative(texture).as_posix(), key,
                        metadata={'license': definition.get('metadata', {}).get('license', {}),
                                  'properties': definition.get('properties', {})})
            except (ValueError, FileNotFoundError, KeyError) as error:
                excluded.append({'kind': 'ysm', 'modelId': key, 'reason': str(error)})
    if not rows: raise ValueError('No verified native models')
    output.mkdir(parents=True, exist_ok=True)
    files, packs = {}, []
    for kind, content in entries.items():
        if not content: continue
        pack_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://github.com/jcs130/minecraft-ai-friend/bedrock/'+kind))
        content['manifest.json'] = encoded({'format_version': 2, 'header': {
            'name': 'My Agent World · '+('车万女仆专属模型' if kind == 'touhou' else 'YSM 专属模型'),
            'description': '原骨骼、UV、贴图转换；Java 动画脚本与装备层另行适配。',
            'uuid': pack_uuid, 'version': VERSION, 'min_engine_version': [1, 21, 0]},
            'modules': [{'type': 'resources', 'uuid': str(uuid.uuid5(uuid.UUID(pack_uuid), 'resources')), 'version': VERSION}]})
        content['render_controllers/maw.json'] = encoded({'format_version': '1.8.0', 'render_controllers': {
            'controller.render.maw_native': {'geometry': 'Geometry.default',
            'materials': [{'*': 'Material.default'}], 'textures': ['Texture.default']}}})
        name = 'maw-'+kind+'-models.mcpack'; raw = archive(content)
        (output/name).write_bytes(raw); files[name] = {'sha256': sha(raw), 'bytes': len(raw), 'directory': 'packs'}
        packs.append({'file': name, 'uuid': pack_uuid, 'version': VERSION,
                      'models': sum(row['kind'] == kind for row in rows)})
    catalog = {'schemaVersion': 1, 'packs': packs, 'models': rows,
               'sourceManifestSha256': sha(assets.manifest_bytes), 'maidMetadata': {
                   'version': '1.5.3', 'jarSha256': TLM_SHA, 'isYsm': 19, 'ysmModel': 20,
                   'ysmTexture': 21, 'model': 23, 'defaultModel': 'touhou_little_maid:hakurei_reimu'}}
    data = encoded(catalog); (output/CATALOG).write_bytes(data)
    files[CATALOG] = {'sha256': sha(data), 'bytes': len(data), 'directory': ''}
    raw = extension.read_bytes(); (output/EXTENSION).write_bytes(raw)
    files[EXTENSION] = {'sha256': sha(raw), 'bytes': len(raw), 'directory': 'extensions'}
    contract = {'schemaVersion': 1, 'files': files, 'packs': packs, 'modelCount': len(rows),
        'geyserJarSha256': sha(geyser.read_bytes()), 'inputs': {'assetsManifestSha256': sha(assets.manifest_bytes),
            'usedNativeAssets': assets.used}, 'excluded': excluded, 'actualBedrockVisualVerified': False,
        'limitations': ['Java JS/Gecko/YSM animation controllers, equipment/backpack layers, mod GUI and moving world blocks are not ported.']}
    (output/CONTRACT).write_bytes(encoded(contract)); validate(output)
    return contract


def validate(directory: Path, *, deployed=False):
    contract = json.loads((directory/CONTRACT).read_bytes())
    if contract.get('schemaVersion') != 1 or not contract.get('packs'): raise ValueError('Invalid modpack contract')
    paths = {}
    for name, meta in contract['files'].items():
        if relative(name).name != name or meta['directory'] not in ['', 'packs', 'extensions']:
            raise ValueError('Unsafe modpack artifact')
        path = directory/meta['directory']/name if deployed else directory/name
        if path.is_symlink(): raise ValueError('Symlink modpack artifact')
        raw = path.read_bytes()
        if len(raw) != meta['bytes'] or sha(raw) != meta['sha256']: raise ValueError('Modpack integrity mismatch: '+name)
        paths[name] = path
    catalog = json.loads(paths[CATALOG].read_bytes())
    if len(catalog['models']) != contract['modelCount']: raise ValueError('Modpack model count mismatch')
    for pack in contract['packs']:
        with zipfile.ZipFile(paths[pack['file']]) as z:
            if z.testzip() or len(z.namelist()) != len(set(z.namelist())): raise ValueError('Invalid modpack ZIP')
            for name in z.namelist():
                relative(name)
                if len(name) >= 80: raise ValueError('Bedrock resource path exceeds platform limit')
            manifest = json.loads(z.read('manifest.json'))
            if manifest['header']['uuid'] != pack['uuid'] or manifest['header']['version'] != pack['version']:
                raise ValueError('Modpack manifest mismatch')
            for row in (r for r in catalog['models'] if r['pack'] == pack['file']):
                geo = json.loads(z.read(row['geometry']))['minecraft:geometry'][0]
                if geo['description']['identifier'] != row['geometryIdentifier'] or sha(z.read(row['texture'])) != row['sourcePngSha256']:
                    raise ValueError('Modpack original geometry/texture mismatch')
    return contract


def registered_models(log: Path, contract: dict, started_after: float):
    with log.open('rb') as stream:
        stream.seek(max(0, log.stat().st_size-131072)); text = stream.read().decode('utf-8', errors='replace')
    results = {}
    for key, pattern, expected in [
        ('registeredModels', r'MAW_MODELS registered=(\d+)', contract['modelCount']),
        ('packsLoaded', r'MAW_MODELS packsLoaded=(\d+)', len(contract['packs']))]:
        matches = re.findall(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}).*'+pattern, text)
        if not matches: raise ValueError('Native model registration not observed: '+key)
        stamp, count = matches[-1]
        at = datetime.datetime.strptime(stamp, '%Y-%m-%d %H:%M:%S,%f').timestamp()
        if at < started_after or int(count) != expected: raise ValueError('Stale/incomplete model registration: '+key)
        results[key] = int(count)
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True); parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--geyser', type=Path, required=True); parser.add_argument('--java-bin', type=Path, required=True)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    compile_extension(args.geyser, args.java_bin, args.output)
    value = build(args.assets, args.output, extension=args.output/EXTENSION, geyser=args.geyser)
    print(json.dumps({'modelCount': value['modelCount'], 'packs': value['packs'], 'excluded': len(value['excluded'])}, ensure_ascii=False))
