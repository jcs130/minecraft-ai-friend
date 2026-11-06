import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import prepare_neoforge as prepare


class InstalledProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.runtime=self.root/'runtime';self.game=self.root/'camera';self.game.mkdir()
        self.base=self.runtime/'versions/1.21.1';self.base.mkdir(parents=True)
        self.profile=self.runtime/'versions/neoforge-21.1.252';self.profile.mkdir()
        original=b'isolated original client';(self.base/'1.21.1.jar').write_bytes(original)
        self.base_data={'libraries':[],'downloads':{'client':{'sha1':hashlib.sha1(original).hexdigest()}},'assetIndex':{'id':'test'},'arguments':{'jvm':['-cp','${classpath}'],'game':['--username','${auth_player_name}','--uuid','${auth_uuid}','--accessToken','${auth_access_token}']}}
        self.profile_data={'id':'neoforge-21.1.252','inheritsFrom':'1.21.1','libraries':[],'mainClass':'example.NeoForgeBootstrap','arguments':{'jvm':['-DignoreList=${version_name}.jar'],'game':[]}}
        self.save()
    def save(self):
        (self.base/'1.21.1.json').write_text(json.dumps(self.base_data))
        (self.profile/'neoforge-21.1.252.json').write_text(json.dumps(self.profile_data))
    def tearDown(self):self.temp.cleanup()
    def build(self):return prepare.manifest(self.runtime,self.game,self.root/'assets','CameraFixture','11111111-1111-3111-8111-111111111111')
    def test_inherited_client_uses_neoforge_ignore_list_name(self):
        result=self.build();cp=result['arguments'][result['arguments'].index('-cp')+1]
        self.assertTrue(cp.endswith('neoforge-21.1.252.jar'))
        self.assertIn('-DignoreList=neoforge-21.1.252.jar',result['arguments'])
        self.assertEqual((self.profile/'neoforge-21.1.252.jar').read_bytes(),(self.base/'1.21.1.jar').read_bytes())
        self.assertEqual(result['arguments'][result['arguments'].index('--accessToken')+1],'0')
    def test_modified_original_and_inherited_client_are_refused(self):
        self.build();(self.profile/'neoforge-21.1.252.jar').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'Inherited client'):self.build()
        (self.base/'1.21.1.jar').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'Original client'):self.build()
    def test_unresolved_arguments_and_unreviewed_version_are_refused(self):
        self.profile_data['arguments']['game']=['${unreviewed}'];self.save()
        with self.assertRaisesRegex(ValueError,'Unknown launcher'):self.build()
        self.profile_data['inheritsFrom']='1.21.4';self.save()
        with self.assertRaisesRegex(ValueError,'Unreviewed game'):self.build()
    def test_library_path_cannot_escape_runtime(self):
        self.profile_data['libraries']=[{'name':'example:lib:1','downloads':{'artifact':{'path':'../../external.jar'}}}];self.save()
        with self.assertRaisesRegex(ValueError,'escapes'):self.build()
    def test_only_windows_amd64_default_feature_rules_are_selected(self):
        self.assertTrue(prepare.allowed([{'action':'allow','os':{'name':'windows','arch':'amd64'}}]))
        self.assertFalse(prepare.allowed([{'action':'allow','os':{'name':'linux'}}]))
        self.assertFalse(prepare.allowed([{'action':'allow','features':{'is_demo_user':True}}]))


if __name__=='__main__':unittest.main()
