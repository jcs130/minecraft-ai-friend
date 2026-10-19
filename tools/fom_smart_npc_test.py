from pathlib import Path
import shutil,tempfile,unittest
from fom_smart_npc import check_policy,JAR

SOURCE=Path(__file__).resolve().parents[1]/'world/fom-smart-npc'

class SmartNpcPolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.server=Path(self.tmp.name)
        (self.server/'mods').mkdir();(self.server/'mods'/JAR).write_bytes(b'jar checked by FOM hash lock')
        shutil.copytree(SOURCE/'config',self.server/'config')
        shutil.copytree(SOURCE/'datapack',self.server/'world/datapacks/fom-smart-npc')
        (self.server/'java.args').write_text('--fml.neoForgeVersion 21.1.250\n')
    def test_known_release_has_labelled_chinese_dialogue_and_bounded_cooperative_ai(self):
        self.assertEqual(len(check_policy(self.server)),3)
    def test_existing_fom_without_npc_keeps_its_old_policy(self):
        (self.server/'mods'/JAR).unlink();self.assertEqual(check_policy(self.server),{})
    def test_stale_loader_is_rejected(self):
        (self.server/'java.args').write_text('--fml.neoForgeVersion 21.1.248\n')
        with self.assertRaisesRegex(ValueError,'NeoForge'):check_policy(self.server)
    def test_unbounded_natural_population_rejected(self):
        p=self.server/'config/smart_npc-server.toml';p.write_text(p.read_text().replace('maxNaturalPlayerNpcs = 4','maxNaturalPlayerNpcs = -1'))
        with self.assertRaisesRegex(ValueError,'budget'):check_policy(self.server)
    def test_lost_chinese_dialogue_not_silently_accepted(self):
        (self.server/'world/datapacks/fom-smart-npc/data/smart_npc/chat/zh_cn/call_help.json').unlink()
        with self.assertRaises(FileNotFoundError):check_policy(self.server)
    def test_player_hunting_role_not_silently_accepted(self):
        p=self.server/'config/smart_npc-names.toml';p.write_text(p.read_text('utf-8').replace('"CAUTIOUS"','"HUNT_PLAYERS"'),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'cooperative'):check_policy(self.server)

if __name__=='__main__':unittest.main()
