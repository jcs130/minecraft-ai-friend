import copy,json,subprocess,sys,tempfile,unittest
from pathlib import Path
import yaml

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/'ops/prepare-dungeon-content.py'
CONNECTOR=ROOT/'probe/crypt-route/connector.json'
OLD=['undead_crypt','creeping_crypt','bunker','illager_camp','aincrad_01']
ADDED=['corsair_cove','tide_sanctum','sunken_dynasty','frost_keep','ember_foundry','jungle_covenant','sky_watch','void_citadel','deep_mineworks','winter_manor']

class DungeonContentMergeTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.base={'schema-version':1,'retained-metadata':'unchanged','sites':{k:{'name':k,'hint':'old hint','rooms':[{'center':[1,45,2]}]} for k in OLD}}
        self.ruins=copy.deepcopy(self.base)
        for k in ADDED:self.ruins['sites'][k]={'name':k,'rooms':[{'center':[8000,80,8000]}]*3}
    def run_merge(self,optimized=False):
        for name,value in [('base',self.base),('ruins',self.ruins)]:
            (self.root/(name+'.yml')).write_text(yaml.safe_dump(value),encoding='utf8')
        return subprocess.run([sys.executable,*(['-O'] if optimized else []),str(SCRIPT),'--base',str(self.root/'base.yml'),'--ruins',str(self.root/'ruins.yml'),'--connector',str(CONNECTOR),'--output',str(self.root/'output')],capture_output=True,text=True)
    def test_merge_retains_every_legacy_combat_field(self):
        result=self.run_merge();self.assertEqual(result.returncode,0,result.stderr)
        data=yaml.safe_load((self.root/'output/dungeons.yml').read_text(encoding='utf8'));self.assertEqual(len(data['sites']),15);self.assertEqual(data['retained-metadata'],'unchanged')
        for k in OLD:
            value=copy.deepcopy(data['sites'][k])
            if k=='creeping_crypt':value.pop('approach');value.pop('protection-boxes')
            self.assertEqual(value,self.base['sites'][k])
        proof=json.loads((self.root/'output/configuration-proof.json').read_text());self.assertTrue(proof['oldCombatDefinitionsPreserved']);self.assertEqual(proof['protectedConnectorCells'],34)
    def test_changed_old_site_is_not_overwritten(self):
        self.ruins['sites']['bunker']['hint']='conflicting candidate';r=self.run_merge();self.assertNotEqual(r.returncode,0);self.assertIn('Current old definitions changed',r.stderr);self.assertFalse((self.root/'output').exists())
    def test_current_custom_entry_requires_fresh_review(self):
        self.base['sites']['creeping_crypt']['entry']=[1,2,3];self.ruins['sites']['creeping_crypt']['entry']=[1,2,3];r=self.run_merge();self.assertNotEqual(r.returncode,0);self.assertIn('Current entrance changed',r.stderr);self.assertFalse((self.root/'output').exists())
    def test_existing_output_is_preserved(self):
        (self.root/'output').mkdir();(self.root/'output/sentinel').write_text('keep');r=self.run_merge();self.assertNotEqual(r.returncode,0);self.assertIn('Use a fresh output directory',r.stderr);self.assertEqual((self.root/'output/sentinel').read_text(),'keep')
    def test_unknown_site_does_not_silently_expand_catalogue(self):
        self.ruins['sites']['unexpected']={'rooms':[]};r=self.run_merge();self.assertNotEqual(r.returncode,0);self.assertIn('Current old definitions changed',r.stderr)
    def test_optimized_python_still_enforces_current_definition_gate(self):
        self.ruins['sites']['bunker']['hint']='conflict';r=self.run_merge(optimized=True);self.assertNotEqual(r.returncode,0);self.assertIn('Current old definitions changed',r.stderr)

if __name__=='__main__':unittest.main()
