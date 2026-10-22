import copy,importlib.util,json,os,shutil,tempfile,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('fom_native_builder',Path(__file__).parents[1]/'tools/build_fom_native_view.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

@unittest.skipUnless(os.environ.get('FOM_NATIVE_LANGUAGE_EXPORT'),'Set FOM_NATIVE_LANGUAGE_EXPORT to the verified original Minecraft 1.21.1 language export')
class OriginalLanguageExportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source';self.output=self.root/'output';self.source.mkdir();self.output.mkdir()
        original=Path(os.environ['FOM_NATIVE_LANGUAGE_EXPORT']);data=json.loads((original/'native-assets.json').read_bytes())
        self.key='assets/minecraft/lang/zh_cn.json';entry=data['assets'][self.key]
        self.manifest={'minecraftVersion':'1.21.1','clientJarSha256':data['clientJarSha256'],'assetIntegrityVerified':True,'assets':{},'sources':[],'counts':{'files':0}}
        source=copy.deepcopy(self.manifest);source['assets'][self.key]=entry;source['sources']=[s for s in data['sources']if s['name']==entry['source']]
        (self.source/'native-assets.json').write_text(json.dumps(source),encoding='utf-8')
        target=self.source/self.key;target.parent.mkdir(parents=True);shutil.copyfile(original/self.key,target)
        self.save_output()
    def save_output(self):
        (self.output/'native-assets.json').write_text(json.dumps(self.manifest),encoding='utf-8')
    def test_exact_language_and_provenance_are_copied_idempotently(self):
        before=(self.source/self.key).read_bytes();builder.add_vanilla_language_export(self.output,self.source)
        self.assertEqual((self.output/self.key).read_bytes(),before)
        result=json.loads((self.output/'native-assets.json').read_bytes());self.assertEqual(result['counts']['files'],1);self.assertEqual(len(result['sources']),1)
        builder.add_vanilla_language_export(self.output,self.source)
        self.assertEqual(json.loads((self.output/'native-assets.json').read_bytes()),result)
    def test_changed_bytes_fail_before_destination_changes(self):
        (self.source/self.key).write_bytes(b'{}');before=(self.output/'native-assets.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'object differs'):builder.add_vanilla_language_export(self.output,self.source)
        self.assertEqual((self.output/'native-assets.json').read_bytes(),before);self.assertFalse((self.output/self.key).exists())
    def test_another_client_is_refused(self):
        self.manifest['clientJarSha256']='0'*64;self.save_output()
        with self.assertRaisesRegex(ValueError,'another client'):builder.add_vanilla_language_export(self.output,self.source)
    def test_conflicting_existing_asset_is_preserved(self):
        target=self.output/self.key;target.parent.mkdir(parents=True);target.write_bytes(b'original existing bytes')
        with self.assertRaisesRegex(ValueError,'Conflicting language file'):builder.add_vanilla_language_export(self.output,self.source)
        self.assertEqual(target.read_bytes(),b'original existing bytes')
    def test_unaudited_locale_is_refused(self):
        with self.assertRaisesRegex(ValueError,'not audited'):builder.add_vanilla_language_export(self.output,self.source,('xx_xx',))

if __name__=='__main__':unittest.main()
