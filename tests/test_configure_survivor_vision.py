from pathlib import Path
import sys,unittest,copy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from configure_survivor_vision import prepare_policy, apply_tool_scope

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

    def test_native_control_extension_preserves_existing_scene_permission(self):
        names=(*self.names,'interact_at')
        before=prepare_policy(self.before,self.names)
        after=prepare_policy(before,names,added_tool='interact_at')
        self.assertEqual(after['tool_defaults'][:-1],before['tool_defaults'])
        self.assertEqual(after['tool_defaults'][-1],{'tool_name':'interact_at','effect':'allow'})
        with self.assertRaises(ValueError):
            prepare_policy(self.before,names,added_tool='interact_at')

    def test_say_and_receipt_permission_are_added_together_without_other_changes(self):
        before = prepare_policy(self.before, self.names)
        names = (*self.names, 'say', 'say_status')
        after = prepare_policy(before, names, added_tool='say')
        self.assertEqual(after['tool_defaults'][:-2], before['tool_defaults'])
        self.assertEqual(after['tool_defaults'][-2:], [
            {'tool_name': 'say', 'effect': 'allow'}, {'tool_name': 'say_status', 'effect': 'allow'}])
        self.assertEqual(prepare_policy(after, names, added_tool='say'), after)
        with self.assertRaises(ValueError):
            prepare_policy(self.before, names, added_tool='say')

    def test_tool_extension_keeps_credential_card_out_of_console_roundtrip(self):
        after = prepare_policy(self.before,self.names)
        enabled = set(self.names[:-1]); policy = copy.deepcopy(self.before); writes = []
        def api(method,route,role,payload=None):
            nonlocal policy
            self.assertEqual(role,'qd-survivor')
            if method == 'PUT':
                writes.append(route)
                if route == '/mcp/policy/numen_survival':
                    policy = copy.deepcopy(payload)
                elif route == '/mcp/tools/numen_survival':
                    enabled.clear(); enabled.update(payload['tools'])
                else:
                    self.fail('client DTO would drop env-backed credentials')
            if route == '/mcp/policy/numen_survival': return policy
            if route == '/mcp/tools/numen_survival':
                return [{'name':n,'enabled':n in enabled} for n in self.names]
            self.fail('unexpected route')
        apply_tool_scope(api,'qd-survivor',list(self.names[:-1]),after,self.names)
        self.assertEqual(writes,['/mcp/policy/numen_survival','/mcp/tools/numen_survival'])
        self.assertEqual(enabled,set(self.names))

if __name__=='__main__':unittest.main()
