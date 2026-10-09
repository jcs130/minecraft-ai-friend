"""Build a private Bedrock icon pack from verified native assets, never invented icons.

Only static generated/handheld item models are eligible in this first adapter.
Animated, stateful, block/BER models and entities remain explicitly unsupported.
Generated assets belong outside Git; the source manifest and registry are inputs.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import io
import json
import datetime
import re
from pathlib import Path, PurePosixPath
import uuid
import zipfile
from PIL import Image

PACK = 'maw-native-icons.mcpack'
MAPPINGS = 'maw-native-icons.json'
CATALOG = 'maw-native-items.json'
CONTRACT = 'resource-contract.json'
MARKER_BASE = 8_000_000  # exact in both Java int and post-1.21.4 float component
PACK_VERSION = [1, 0, 2]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n').encode('utf-8')


class Assets:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.manifest_bytes = (root/'native-assets.json').read_bytes()
        self.manifest = json.loads(self.manifest_bytes)
        if self.manifest.get('assetIntegrityVerified') is not True:
            raise ValueError('Native asset integrity was not verified')
        self.used = {}

    def read(self, key: str) -> bytes:
        parts = PurePosixPath(key)
        if parts.is_absolute() or '..' in parts.parts or '\\' in key:
            raise ValueError('unsafe_asset_path')
        meta = self.manifest['assets'].get(key)
        if not meta:
            raise ValueError('asset_missing')
        if meta.get('variants') or meta.get('overriddenSources'):
            raise ValueError('ambiguous_resource_priority')
        path = self.root.joinpath(*parts.parts)
        if path.is_symlink() or not path.resolve().is_relative_to(self.root):
            raise ValueError('unsafe_asset_path')
        data = path.read_bytes()
        if len(data) != meta['bytes'] or sha(data) != meta['sha256']:
            raise ValueError('native_asset_hash_mismatch')
        self.used[key] = meta['sha256']
        return data

    def json(self, key):
        return json.loads(self.read(key))

    def model(self, name, seen=()):
        if name == 'minecraft:item/template_spawn_egg':
            raise ValueError('runtime_tint_not_yet_adapted')
        if name in ('minecraft:item/generated', 'minecraft:item/handheld',
                    'minecraft:item/handheld_rod'):
            return {'textures': {}, 'handheld': name != 'minecraft:item/generated'}
        if name in seen or len(seen) > 16:
            raise ValueError('cyclic_model_parent')
        namespace, local = name.split(':', 1)
        data = self.json(f'assets/{namespace}/models/{local}.json')
        if data.get('overrides'):
            raise ValueError('stateful_item_model')
        if data.get('elements') is not None or data.get('loader'):
            raise ValueError('three_dimensional_or_custom_renderer')
        parent = data.get('parent', '')
        if not parent or parent in ('builtin/entity', 'minecraft:builtin/entity'):
            raise ValueError('special_renderer_required')
        if ':' not in parent:
            parent = 'minecraft:'+parent
        base = self.model(parent, (*seen, name))
        return {**base, 'textures': {**base['textures'], **data.get('textures', {})}}

    def icon(self, model):
        textures = model['textures']
        layers = sorted(k for k in textures if k.startswith('layer') and k[5:].isdigit())
        if not layers or layers != [f'layer{i}' for i in range(len(layers))]:
            raise ValueError('invalid_generated_layers')
        raws, images = [], []
        for layer in layers:
            texture = textures[layer]
            seen = set()
            while texture.startswith('#'):
                if texture in seen:
                    raise ValueError('cyclic_texture_reference')
                seen.add(texture); texture = textures[texture[1:]]
            if ':' not in texture:
                texture = 'minecraft:'+texture
            namespace, local = texture.split(':', 1)
            key = f'assets/{namespace}/textures/{local}.png'
            if key+'.mcmeta' in self.manifest['assets']:
                meta = self.json(key+'.mcmeta')
                if meta.get('animation') is not None:
                    raise ValueError('animated_texture_not_yet_adapted')
            raw = self.read(key)
            image = Image.open(io.BytesIO(raw)).convert('RGBA')
            if image.width != image.height or not 1 <= image.width <= 512:
                raise ValueError('non_square_icon')
            raws.append(raw); images.append(image)
        if len(images) == 1:
            return raws[0], 'source_png_exact'
        if any(im.size != images[0].size for im in images):
            raise ValueError('mixed_layer_sizes')
        result = images[0].copy()
        for layer in images[1:]:
            result.alpha_composite(layer)
        buffer = io.BytesIO(); result.save(buffer, format='PNG')
        return buffer.getvalue(), 'native_layers_alpha_composite'


def build(assets_root: Path, registry: Path, idmap: Path, output: Path):
    assets = Assets(assets_root)
    rows = []
    for line in registry.read_text('utf-8').splitlines():
        key, number = line.split('\t')[:2]; rows.append((key, int(number)))
    vanilla = {number: key for key, number in rows if key.startswith('minecraft:')}
    mapping = json.loads(idmap.read_text('utf-8'))['items']
    languages = {}
    for namespace in {key.split(':')[0] for key, _ in rows}:
        merged = {}
        for lang in ['en_us', 'zh_cn']:
            key = f'assets/{namespace}/lang/{lang}.json'
            if key in assets.manifest['assets']:
                merged.update(assets.json(key))
        languages[namespace] = merged
    catalog, definitions, entries, excluded = [], {}, {}, []
    for key, number in sorted(rows):
        if key.startswith('minecraft:'):
            continue
        namespace, local = key.split(':')
        try:
            model = assets.model(namespace+':item/'+local)
            raw, method = assets.icon(model)
            base = vanilla.get(mapping.get(str(number)))
            if not base:
                raise ValueError('vanilla_projection_base_missing')
            identifier = 'maw_native:'+namespace+'__'+local.replace('/', '__')
            icon = identifier.replace(':', '.')
            png_path = 'textures/items/'+namespace+'/'+local+'.png'
            entries[png_path] = raw
            title = (languages[namespace].get('item.'+namespace+'.'+local)
                     or languages[namespace].get('block.'+namespace+'.'+local) or key)
            marker = MARKER_BASE + number
            if marker >= 2**24:
                raise ValueError('inexact_float_marker')
            row = {'nativeItem': key, 'nativeId': number, 'baseItem': base,
                   'customModelData': marker, 'bedrockIdentifier': identifier,
                   'icon': icon, 'displayName': title, 'png': png_path,
                   'pngSha256': sha(raw), 'method': method, 'handheld': model['handheld']}
            catalog.append(row)
            definitions.setdefault(base, []).append({'type': 'legacy',
                'custom_model_data': marker, 'bedrock_identifier': identifier,
                'display_name': title, 'bedrock_options': {'icon': icon,
                'display_handheld': model['handheld'], 'creative_category': 'none'}})
        except (ValueError, KeyError, FileNotFoundError) as error:
            excluded.append({'nativeItem': key, 'reason': str(error)})
    if not catalog or len({r['bedrockIdentifier'] for r in catalog}) != len(catalog):
        raise ValueError('Empty or ambiguous custom item catalog')
    pack_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://github.com/jcs130/minecraft-ai-friend/bedrock-icons'))
    entries['manifest.json'] = encoded({'format_version': 2, 'header': {
        'name': 'My Agent World · 模组物品图标',
        'description': '经校验的原模组静态物品贴图；不包含未适配模型和模组客户端逻辑。',
        'uuid': pack_uuid, 'version': PACK_VERSION, 'min_engine_version': [1, 21, 0]},
        'modules': [{'type': 'resources', 'uuid': str(uuid.uuid5(uuid.UUID(pack_uuid), 'resources')),
                     'version': PACK_VERSION}]})
    entries['textures/item_texture.json'] = encoded({'resource_pack_name': 'maw_native_icons',
        'texture_name': 'atlas.items', 'texture_data': {r['icon']: {'textures': r['png'][:-4]} for r in catalog}})
    entries['texts/languages.json'] = encoded(['zh_CN', 'en_US'])
    for lang in ['zh_CN', 'en_US']:
        entries['texts/'+lang+'.lang'] = ('\n'.join('item.'+r['bedrockIdentifier']+'.name='+r['displayName']
                                                   for r in catalog)+'\n').encode('utf-8')
    pack_buffer = io.BytesIO()
    with zipfile.ZipFile(pack_buffer, 'w', zipfile.ZIP_DEFLATED) as z:
        for key, raw in sorted(entries.items()):
            info = zipfile.ZipInfo(key, (2026, 10, 9, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, raw)
    artifacts = {PACK: pack_buffer.getvalue(), MAPPINGS: encoded({'format_version': 2, 'items': definitions}),
                 CATALOG: encoded({'schemaVersion': 1, 'items': catalog})}
    contract = {'schemaVersion': 1, 'packVersion': PACK_VERSION, 'packUuid': pack_uuid,
        'itemCount': len(catalog), 'perNamespace': dict(collections.Counter(r['nativeItem'].split(':')[0] for r in catalog)),
        'files': {name: {'sha256': sha(raw), 'bytes': len(raw)} for name, raw in artifacts.items()},
        'inputs': {'assetsManifestSha256': sha(assets.manifest_bytes), 'registrySha256': sha(registry.read_bytes()),
                   'idmapSha256': sha(idmap.read_bytes()), 'usedNativeAssets': assets.used},
        'excluded': excluded, 'actualBedrockVisualVerified': False,
        'scope': 'Static generated/handheld inventory, ground and held item sprites; no blocks, entities or mod GUI parity'}
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in artifacts.items():
        (output/name).write_bytes(raw)
    (output/CONTRACT).write_bytes(encoded(contract))
    validate(output)
    return contract


def validate(directory: Path, *, deployed=False):
    contract = json.loads((directory/CONTRACT).read_bytes())
    destinations = {PACK: directory/'packs'/PACK, MAPPINGS: directory/'custom_mappings'/MAPPINGS,
                    CATALOG: directory/CATALOG} if deployed else {name: directory/name for name in [PACK, MAPPINGS, CATALOG]}
    if contract.get('schemaVersion') != 1 or set(contract['files']) != set(destinations):
        raise ValueError('Invalid resource contract')
    for name, path in destinations.items():
        raw = path.read_bytes(); expected = contract['files'][name]
        if path.is_symlink() or len(raw) != expected['bytes'] or sha(raw) != expected['sha256']:
            raise ValueError('Bedrock resource integrity mismatch: '+name)
    catalog = json.loads(destinations[CATALOG].read_bytes())['items']
    if len(catalog) != contract['itemCount'] or not catalog:
        raise ValueError('Resource catalog count mismatch')
    mappings = json.loads(destinations[MAPPINGS].read_bytes())
    defs = {r['bedrock_identifier']: (base, r) for base, rows in mappings['items'].items() for r in rows}
    if mappings['format_version'] != 2 or len(defs) != len(catalog):
        raise ValueError('Geyser definitions mismatch')
    with zipfile.ZipFile(destinations[PACK]) as z:
        if z.testzip() is not None or len(set(z.namelist())) != len(z.namelist()):
            raise ValueError('Invalid resource archive')
        manifest = json.loads(z.read('manifest.json'))
        if manifest['header']['uuid'] != contract['packUuid'] or manifest['header']['version'] != contract['packVersion']:
            raise ValueError('Pack version mismatch')
        atlas = json.loads(z.read('textures/item_texture.json'))['texture_data']
        for r in catalog:
            if defs[r['bedrockIdentifier']][0] != r['baseItem'] or defs[r['bedrockIdentifier']][1]['custom_model_data'] != r['customModelData']:
                raise ValueError('Marker mapping mismatch')
            if atlas[r['icon']]['textures']+'.png' != r['png'] or sha(z.read(r['png'])) != r['pngSha256']:
                raise ValueError('Missing/incorrect native texture')
    return contract


def registered_items(log: Path, contract: dict, started_after: float):
    """Check this owned child's actual Geyser startup, not an old successful run."""
    with log.open('rb') as stream:
        stream.seek(max(0, log.stat().st_size-131072))
        text = stream.read().decode('utf-8', errors='replace')
    matches = re.findall(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}).*Registered (\d+) custom items', text)
    if not matches:
        raise ValueError('Geyser custom item registration not observed')
    stamp, count = matches[-1]
    at = datetime.datetime.strptime(stamp, '%Y-%m-%d %H:%M:%S,%f').timestamp()
    # One built-in item is registered by this pinned Geyser distribution.
    if at < started_after or int(count) != contract['itemCount']+1:
        raise ValueError('Stale or incomplete Geyser item registration')
    return {'registeredCustomItems': int(count), 'nativeItems': contract['itemCount'], 'atEpoch': at}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--idmap', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = build(args.assets, args.registry, args.idmap, args.output)
    print(json.dumps({k: result[k] for k in ['itemCount', 'perNamespace', 'actualBedrockVisualVerified']}, ensure_ascii=False))
