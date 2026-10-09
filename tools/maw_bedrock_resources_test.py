import hashlib
import io
import json
import datetime
from pathlib import Path
import tempfile
import unittest
import zipfile
from PIL import Image
import maw_bedrock_resources as resources


class ResourcesTests(unittest.TestCase):
    def test_unimplemented_runtime_tint_is_not_replaced_by_a_plain_white_egg(self):
        with tempfile.TemporaryDirectory() as tmp:
            assets, *_ = self.fixture(Path(tmp))
            with self.assertRaisesRegex(ValueError, 'runtime_tint'):
                resources.Assets(assets).model('minecraft:item/template_spawn_egg')

    def test_actual_registration_must_belong_to_current_child_and_have_all_items(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp)/'geyser.log'
            now = datetime.datetime.now()
            log.write_text(now.strftime('%Y-%m-%d %H:%M:%S,000')+' [main/INFO] (Geyser) Registered 760 custom items\n')
            self.assertEqual(resources.registered_items(log, {'itemCount':759}, now.timestamp()-2)['nativeItems'],759)
            with self.assertRaisesRegex(ValueError,'Stale'):
                resources.registered_items(log, {'itemCount':759}, now.timestamp()+2)
            with self.assertRaisesRegex(ValueError,'incomplete'):
                resources.registered_items(log, {'itemCount':760}, now.timestamp()-2)

    def fixture(self, root):
        assets = root/'native'; assets.mkdir(); manifest = {'assetIntegrityVerified': True, 'assets': {}}
        def put(key, data):
            path = assets/key; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            manifest['assets'][key] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
        def obj(key, data): put(key, json.dumps(data).encode())
        png = io.BytesIO(); Image.new('RGBA', (16, 16), (80, 160, 30, 255)).save(png, 'PNG')
        put('assets/test/textures/item/meal.png', png.getvalue())
        obj('assets/test/models/item/meal.json', {'parent': 'minecraft:item/generated', 'textures': {'layer0': 'test:item/meal'}})
        obj('assets/test/models/item/renderer.json', {'parent': 'builtin/entity'})
        obj('assets/test/models/item/moving.json', {'parent': 'minecraft:item/generated', 'textures': {'layer0': 'test:item/moving'}})
        put('assets/test/textures/item/moving.png', png.getvalue())
        obj('assets/test/textures/item/moving.png.mcmeta', {'animation': {'frametime': 2}})
        obj('assets/test/lang/en_us.json', {'item.test.meal': 'Meal'})
        obj('assets/test/lang/zh_cn.json', {'item.test.meal': '原料理'})
        (assets/'native-assets.json').write_text(json.dumps(manifest), 'utf-8')
        registry = root/'items.tsv'; registry.write_text('minecraft:paper\t1091\ntest:meal\t2000\ntest:renderer\t2001\ntest:moving\t2002\n')
        idmap = root/'idmap.json'; idmap.write_text(json.dumps({'items': {str(i): 1091 for i in range(2000, 2003)}}))
        return assets, registry, idmap, png.getvalue()

    def test_original_png_name_mapping_archive_and_deterministic_rebuild(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); assets, registry, idmap, png = self.fixture(root)
            a, b = root/'a', root/'b'
            contract = resources.build(assets, registry, idmap, a)
            resources.build(assets, registry, idmap, b)
            self.assertEqual(contract['itemCount'], 1)
            self.assertEqual({r['reason'] for r in contract['excluded']},
                             {'special_renderer_required', 'animated_texture_not_yet_adapted'})
            for file in [resources.PACK, resources.MAPPINGS, resources.CATALOG, resources.CONTRACT]:
                self.assertEqual((a/file).read_bytes(), (b/file).read_bytes())
            with zipfile.ZipFile(a/resources.PACK) as z:
                self.assertEqual(z.read('textures/items/test/meal.png'), png)
            definition = json.loads((a/resources.MAPPINGS).read_bytes())['items']['minecraft:paper'][0]
            self.assertEqual(definition['display_name'], '原料理')
            self.assertEqual(definition['custom_model_data'], 8002000)

    def test_modified_native_texture_is_excluded_and_cannot_be_published_as_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); assets, registry, idmap, _ = self.fixture(root)
            (assets/'assets/test/textures/item/meal.png').write_bytes(b'bad texture')
            with self.assertRaisesRegex(ValueError, 'Empty'):
                resources.build(assets, registry, idmap, root/'out')

    def test_deployed_layout_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); assets, registry, idmap, _ = self.fixture(root)
            output = root/'out'; resources.build(assets, registry, idmap, output)
            (output/'packs').mkdir(); (output/'custom_mappings').mkdir()
            (output/resources.PACK).rename(output/'packs'/resources.PACK)
            (output/resources.MAPPINGS).rename(output/'custom_mappings'/resources.MAPPINGS)
            self.assertEqual(resources.validate(output, deployed=True)['itemCount'], 1)
            (output/resources.CATALOG).write_bytes(b'{}')
            with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                resources.validate(output, deployed=True)


if __name__ == '__main__': unittest.main()
