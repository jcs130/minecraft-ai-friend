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
    def test_soul_charm_variants_use_native_shared_chinese_name_instead_of_registry_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);assets,registry,idmap,png=self.fixture(root)
            manifest=json.loads((assets/'native-assets.json').read_bytes())
            values={'assets/touhou_little_maid/lang/zh_cn.json':json.dumps({'item.touhou_little_maid.smart_slab':'魂符'},ensure_ascii=False).encode()}
            for variant in ['smart_slab_init','smart_slab_empty','smart_slab_has_maid']:
                values['assets/touhou_little_maid/models/item/'+variant+'.json']=json.dumps({'parent':'minecraft:item/generated','textures':{'layer0':'test:item/meal' if variant=='smart_slab_empty' else 'touhou_little_maid:item/animated'}}).encode()
            image=Image.new('RGBA',(16,32),(0,255,0,255));image.paste((0,0,255,255),(0,16,16,32));buffer=io.BytesIO();image.save(buffer,'PNG')
            values['assets/touhou_little_maid/textures/item/animated.png']=buffer.getvalue()
            values['assets/touhou_little_maid/textures/item/animated.png.mcmeta']=json.dumps({'animation':{'frametime':2,'frames':[1,0]}}).encode()
            for key,data in values.items():
                path=assets/key;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
                manifest['assets'][key]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
            (assets/'native-assets.json').write_text(json.dumps(manifest),'utf-8')
            names=['touhou_little_maid:smart_slab_'+v for v in ['init','empty','has_maid']]
            registry.write_text('minecraft:paper\t1091\n'+''.join(f'{name}\t{2000+i}\n' for i,name in enumerate(names)))
            resources.build(assets,registry,idmap,root/'out',display_names={k:k for k in names})
            rows=json.loads((root/'out'/resources.CATALOG).read_bytes())['items']
            self.assertEqual(len(rows),3);self.assertTrue(all(r['displayName']=='魂符' for r in rows))
            with zipfile.ZipFile(root/'out'/resources.PACK) as archive:
                for row in rows:
                    if row['nativeItem'].endswith('_empty'):continue
                    self.assertEqual(row['method'],'source_animation_first_frame_exact')
                    icon=Image.open(io.BytesIO(archive.read(row['png'])))
                    self.assertEqual(icon.size,(16,16));self.assertEqual(icon.getpixel((0,0)),(0,0,255,255))

    def test_fom_shifted_vanilla_ids_and_separate_pack_cache_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);assets,registry,idmap,png=self.fixture(root)
            registry.write_text(registry.read_text().replace('minecraft:paper\t1091','minecraft:paper\t15000'))
            table=json.loads(idmap.read_text());table['reverseVanillaItems']={'1091':15000};idmap.write_text(json.dumps(table))
            a=resources.build(assets,registry,idmap,root/'a',identity='fom-2.42-a')
            b=resources.build(assets,registry,idmap,root/'b',identity='fom-2.42-b')
            self.assertNotEqual(a['packUuid'],b['packUuid'])
            definition=json.loads((root/'a'/resources.MAPPINGS).read_bytes())['items']['minecraft:paper'][0]
            self.assertEqual(definition['display_name'],'原料理')
            with zipfile.ZipFile(root/'a'/resources.PACK) as z:self.assertEqual(z.read('textures/items/test/meal.png'),png)

    def test_conflicting_locale_does_not_change_texture_or_native_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);assets,registry,idmap,png=self.fixture(root)
            file=assets/'native-assets.json';manifest=json.loads(file.read_text())
            for lang in ['en_us','zh_cn']:manifest['assets'][f'assets/test/lang/{lang}.json']['variants']=[{'source':'another.jar'}]
            file.write_text(json.dumps(manifest))
            contract=resources.build(assets,registry,idmap,root/'out',display_names={'test:meal':'服中原料理'})
            self.assertEqual(contract['itemCount'],1)
            row=json.loads((root/'out'/resources.CATALOG).read_bytes())['items'][0]
            self.assertEqual(row['displayName'],'服中原料理');self.assertEqual(row['nativeItem'],'test:meal')

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

    def test_long_native_item_name_uses_short_bedrock_texture_path_without_changing_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); assets, registry, idmap, png = self.fixture(root)
            name = 'very_long_native_material_name_' * 4
            model = f'assets/test/models/item/{name}.json'
            raw = json.dumps({'parent':'minecraft:item/generated','textures':{'layer0':'test:item/meal'}}).encode()
            (assets/model).write_bytes(raw)
            manifest = json.loads((assets/'native-assets.json').read_text('utf-8'))
            manifest['assets'][model] = {'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
            (assets/'native-assets.json').write_text(json.dumps(manifest),'utf-8')
            registry.write_text(f'minecraft:paper\t1091\ntest:{name}\t2000\n')
            resources.build(assets, registry, idmap, root/'out')
            with zipfile.ZipFile(root/'out'/resources.PACK) as archive:
                self.assertEqual(archive.read('textures/items/long/2000.png'),png)
                self.assertTrue(all(len(n)<80 for n in archive.namelist() if n.endswith('.png')))

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
