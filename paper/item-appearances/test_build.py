"""Cross-format identity, authored geometry and ordinary item regressions."""
import hashlib, importlib.util, json, os, tempfile, unittest, zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('item_build',Path(__file__).with_name('build.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class ResourceBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='item-art-tests-')
        cls.client=Path(os.environ['MC_TEST_CLIENT_JAR']);cls.out=Path(cls.temp.name)/'pack'
        cls.web=builder.build(cls.out,client_jar=cls.client);cls.catalog=builder.load_catalog()
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def read(self,name): return json.loads((self.out/name).read_text('utf8'))
    def test_identity_and_texture_bytes_are_shared(self):
        mapping=self.read('qiandengji-items.geyser.json')
        for item in self.catalog['items']:
            id=item['id'];row=next(r for r in self.web['items'] if r['id']==id)
            be=next(r for r in mapping['items'][item['baseId']] if r['custom_model_data']==item['modelData'])
            self.assertEqual(be['bedrock_identifier'],'qiandengji:'+id)
            self.assertEqual(row['modelData'],item['modelData'])
            java=(self.out/f'java/assets/qiandengji/textures/item/{id}.png').read_bytes()
            self.assertEqual(java,(self.out/f'bedrock/textures/entity/{id}.png').read_bytes())
            self.assertEqual(java,(self.out/f'web/textures/{id}.png').read_bytes())
    def test_bedrock_geometry_is_the_same_cuboids_and_uv(self):
        for item in self.catalog['items']:
            id=item['id'];java=self.read(f'java/assets/qiandengji/models/item/{id}.json')
            bone=self.read(f'bedrock/models/entity/{id}.geo.json')['minecraft:geometry'][0]['bones'][0]
            self.assertIn('item_slot_to_bone_name',bone['binding'])
            self.assertEqual(len(bone['cubes']),len(java['elements']))
            for cube,element in zip(bone['cubes'],java['elements']):
                self.assertEqual(cube['origin'],[v-8 for v in element['from']])
                self.assertEqual(cube['size'],[b-a for a,b in zip(element['from'],element['to'])])
                self.assertEqual(cube['uv']['north']['uv'],[v*2 for v in element['faces']['north']['uv'][:2]])
    def test_ordinary_crossbow_preserves_original_charge_and_projectile_overrides(self):
        with zipfile.ZipFile(self.client) as z: original=json.loads(z.read('assets/minecraft/models/item/crossbow.json'))
        actual=self.read('java/assets/minecraft/models/item/crossbow.json')
        self.assertEqual(actual['overrides'][:len(original['overrides'])],original['overrides'])
        for key,value in original.items():
            if key!='overrides':self.assertEqual(actual[key],value)
    def test_exact_numbers_do_not_recolor_unrelated_items(self):
        for item in self.catalog['items']:
            base=item['baseId'].split(':')[1];overrides=self.read(f'java/assets/minecraft/models/item/{base}.json')['overrides']
            for number in [0,9876,731000,731001,731002,731003,731004,731005,731006,800000]:
                selected=None
                for row in overrides:
                    p=row['predicate']
                    if set(p)=={'custom_model_data'} and p['custom_model_data']<=number:selected=row['model']
                expected=next((i for i in self.catalog['items'] if i['baseId']==item['baseId'] and i['modelData']==number),None)
                if expected:self.assertEqual(selected,'qiandengji:item/'+expected['id'])
                elif selected:self.assertEqual(selected,'qiandengji:item/base/'+base)
    def test_all_assets_have_exact_hashes_and_stable_archives(self):
        for name,row in self.web['assets'].items():
            data=(self.out/'web'/name).read_bytes();self.assertEqual(len(data),row['bytes']);self.assertEqual(hashlib.sha256(data).hexdigest(),row['sha256'])
        second=Path(self.temp.name)/'again';builder.build(second,client_jar=self.client)
        for name in ['qiandengji-items-java-1.20.6.zip','qiandengji-items-bedrock.mcpack']:
            self.assertEqual((self.out/name).read_bytes(),(second/name).read_bytes())
    def test_mismatched_version_and_reused_outputs_fail_before_mutation(self):
        bad=Path(self.temp.name)/'wrong.jar';bad.write_bytes(b'not the locked client')
        destination=Path(self.temp.name)/'invalid'
        with self.assertRaisesRegex(ValueError,'locked'):builder.build(destination,client_jar=bad)
        self.assertFalse(destination.exists())
        with self.assertRaises(FileExistsError):builder.build(self.out,client_jar=self.client)

if __name__=='__main__': unittest.main(verbosity=2)
