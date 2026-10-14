import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('migration',Path(__file__).resolve().parents[1]/'migrate-datapacks-1.21.py')
migration=importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

class DatapackMigrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)

    def source(self,entries,meta=None):
        path=self.root/'original.zip'
        with zipfile.ZipFile(path,'w') as archive:
            archive.writestr('pack.mcmeta',json.dumps(meta or {'pack':{'pack_format':41,'description':'Original author'}}))
            for name,raw in entries.items(): archive.writestr(name,raw)
        return path

    def test_active_overlays_keep_priority_original_nbt_and_source_bytes(self):
        meta={'pack':{'pack_format':15,'supported_formats':[15,41],'description':'Author'},'overlays':{'entries':[
            {'formats':[26,41],'directory':'one'},{'formats':41,'directory':'two'},
            {'formats':48,'directory':'future'}]}}
        original=b'\x0a\x00\x00\x08\x00\x04name\x00\x05house\x00'
        source=self.source({'data/example/structures/house.nbt':b'base',
            'one/data/example/structures/house.nbt':b'first',
            'two/data/example/structures/house.nbt':original,
            'future/data/example/structures/house.nbt':b'future'},meta)
        before=source.read_bytes(); output=self.root/'converted.zip'
        report=migration.convert(source,output)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read('data/example/structure/house.nbt'),original)
            self.assertFalse(any(p.startswith(('one/','two/','future/')) for p in archive.namelist()))
            converted=json.loads(archive.read('pack.mcmeta'))
            self.assertEqual(converted['pack']['pack_format'],48)
            self.assertNotIn('overlays',converted)
        self.assertEqual(report['appliedOverlays'],['one','two'])
        self.assertEqual(source.read_bytes(),before)

    def test_compatible_pack_is_copied_byte_for_byte(self):
        source=self.source({'data/example/structure/house.nbt':b'exact'},
            {'pack':{'pack_format':15,'supported_formats':[15,512],'description':'Author'}})
        output=self.root/'converted.zip'
        report=migration.convert(source,output)
        self.assertTrue(report['originalCompatible'])
        self.assertEqual(source.read_bytes(),output.read_bytes())

    def test_only_registry_directory_segments_are_renamed(self):
        self.assertEqual(migration.renamed('data/example/tags/entity_types/animals.json'),'data/example/tags/entity_type/animals.json')
        self.assertEqual(migration.renamed('data/example/functions/items/path.mcfunction'),'data/example/function/items/path.mcfunction')
        self.assertEqual(migration.renamed('assets/example/structures/a.json'),'assets/example/structures/a.json')

    def test_enchantment_selection_and_non_treasure_intent_survive(self):
        original={'functions':[{'function':'minecraft:enchant_randomly','enchantments':['minecraft:mending']},
            {'function':'minecraft:enchant_with_levels','levels':30,'treasure':False}]}
        converted=migration.loot_schema(original)
        self.assertEqual(converted['functions'][0]['options'],['minecraft:mending'])
        self.assertEqual(converted['functions'][1]['options'],'#minecraft:in_enchanting_table')
        self.assertNotIn('treasure',converted['functions'][1])
        self.assertIn('treasure',original['functions'][1])

    def test_looting_probability_is_equivalent_at_levels_zero_through_five(self):
        converted=migration.loot_schema({'condition':'minecraft:random_chance_with_looting','chance':0.2,'looting_multiplier':0.05})
        for level in range(6):
            actual=converted['unenchanted_chance'] if level==0 else converted['enchanted_chance']['base']+(level-1)*converted['enchanted_chance']['per_level_above_first']
            self.assertAlmostEqual(actual,0.2+level*0.05)

    def test_unknown_and_worldgen_json_remain_original_bytes(self):
        raw=b'{"name":"worldgen uses Gson", /*author comment*/ "elements": []}'
        source=self.source({'data/example/worldgen/template_pool/house.json':raw,
            'data/example/mod_metadata/template.json':b'not a vanilla registry'})
        output=self.root/'converted.zip'
        migration.convert(source,output)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read('data/example/worldgen/template_pool/house.json'),raw)
            self.assertEqual(archive.read('data/example/mod_metadata/template.json'),b'not a vanilla registry')

    def test_directory_collision_and_existing_destination_are_rejected(self):
        source=self.source({'data/example/structures/a.nbt':b'old','data/example/structure/a.nbt':b'new'})
        output=self.root/'converted.zip'
        with self.assertRaisesRegex(ValueError,'collision'): migration.convert(source,output)
        self.assertFalse(output.exists())
        output.write_bytes(b'previous candidate')
        with self.assertRaisesRegex(ValueError,'Fresh destination'): migration.convert(source,output)
        self.assertEqual(output.read_bytes(),b'previous candidate')

    def test_zip_traversal_is_rejected_without_extraction(self):
        source=self.source({'../outside.txt':b'never extract'})
        with self.assertRaisesRegex(ValueError,'Unsafe'): migration.convert(source,self.root/'converted.zip')
        self.assertFalse((self.root/'outside.txt').exists())

if __name__=='__main__': unittest.main()
