from pathlib import Path
from unittest.mock import patch,Mock
import json,tempfile,unittest
from launch_java_client_bridge import launch

class LoaderSelectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.mc=self.root/'minecraft';self.game=self.root/'qa-game'
        (self.game/'mods').mkdir(parents=True);(self.mc/'versions/1.21.1').mkdir(parents=True)
        base={'libraries':[],'assetIndex':{'id':'17'},'arguments':{'jvm':[],'game':['--username','${auth_player_name}']}}
        (self.mc/'versions/1.21.1/1.21.1.json').write_text(json.dumps(base))
        for version in ['21.1.248','21.1.250']:
            directory=self.mc/f'versions/neoforge-{version}';directory.mkdir()
            (directory/f'neoforge-{version}.json').write_text(json.dumps({'libraries':[],'inheritsFrom':'1.21.1','id':'neoforge-'+version,'arguments':{'jvm':[],'game':['--loader',version]},'mainClass':'bootstrap.Test'}))
    def test_explicit_patch_selects_new_profile_without_relabelling_old_one(self):
        with patch('launch_java_client_bridge.subprocess.Popen',return_value=Mock(pid=17)):
            _,log=launch(self.mc,self.game,self.root/'java.exe','NativeQA','127.0.0.1:39220',neoforge='21.1.250')
            log.close()
        args=(self.game/'bridge-launch/java.args').read_text('utf-8')
        self.assertIn('21.1.250',args);self.assertNotIn('21.1.248',args)
        self.assertIn('NativeQA',args)
    def test_loader_profile_path_cannot_escape_cache(self):
        with self.assertRaisesRegex(ValueError,'patch required'):
            launch(self.mc,self.game,self.root/'java.exe','NativeQA','127.0.0.1:39220',neoforge='../../other')
    def test_offline_helper_cannot_connect_real_remote_identity(self):
        with self.assertRaisesRegex(ValueError,'loopback server'):
            launch(self.mc,self.game,self.root/'java.exe','NativeQA','example.net:28976',neoforge='21.1.250')

if __name__=='__main__':unittest.main()
