import importlib.util,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('voice_config_check',Path(__file__).parents[1]/'ops/voice-config-check.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
BASE='port=24454\nbind_address=*\nvoice_host=\nmax_voice_distance=48.0\nwhisper_distance=24.0\nforce_voice_chat=false\nallow_recording=false\nallow_pings=true\n'

class WritebackTest(unittest.TestCase):
    def test_comments_and_plugin_defaults(self):self.assertEqual(module.compare(BASE,'# SVC generated config\n'+BASE+'codec=VOIP\n')['requiredKeys'],8)
    def test_force_requirement_changed(self):
        with self.assertRaises(ValueError):module.compare(BASE,BASE.replace('force_voice_chat=false','force_voice_chat=true'))
    def test_port_changed(self):
        with self.assertRaises(ValueError):module.compare(BASE,BASE.replace('24454','25565'))
    def test_missing_property(self):
        with self.assertRaises(ValueError):module.compare(BASE,BASE.replace('voice_host=\n',''))
    def test_duplicate_property(self):
        with self.assertRaises(ValueError):module.compare(BASE,BASE+'force_voice_chat=true\n')
    def test_unknown_candidate_property(self):
        with self.assertRaises(ValueError):module.compare(BASE+'unexpected=1\n',BASE+'unexpected=1\n')
    def test_spacing_does_not_change_values(self):self.assertTrue(module.compare(BASE,BASE.replace('port=','port = '))['passed'])

if __name__=='__main__':unittest.main()
