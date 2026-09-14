from pathlib import Path
import sys,unittest,copy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from configure_survivor_vision import prepare_policy

class VisionPolicyTests(unittest.TestCase):
    def setUp(self):
        self.names=('status','look','view_scene')
        self.before={'default_effect':'deny','client_overrides':[],'tool_overrides':[],
            'unmanaged_rules_count':0,'tool_defaults':[{'tool_name':n,'effect':'allow'} for n in self.names[:-1]]}

    def test_append_only_and_idempotent_without_mutating_input(self):
        original=copy.deepcopy(self.before);after=prepare_policy(self.before,self.names)
        self.assertEqual(self.before,original)
        self.assertEqual(after,self.before|{'tool_defaults':self.before['tool_defaults']+[{'tool_name':'view_scene','effect':'allow'}]})
        self.assertEqual(prepare_policy(after,self.names),after)

    def test_foreign_denial_or_unmanaged_policy_cannot_be_overwritten(self):
        for key,value in (('default_effect','allow'),('tool_overrides',[{}]),('client_overrides',[{}]),('unmanaged_rules_count',1)):
            with self.subTest(key=key),self.assertRaises(ValueError):prepare_policy(self.before|{key:value},self.names)
        for rule in ({'tool_name':'foreign','effect':'allow'},{'tool_name':'look','effect':'deny'},self.before['tool_defaults'][0]):
            with self.assertRaises(ValueError):prepare_policy(self.before|{'tool_defaults':self.before['tool_defaults']+[rule]},self.names)

if __name__=='__main__':unittest.main()
