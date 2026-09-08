from pathlib import Path
from types import SimpleNamespace as N
import importlib.util,unittest,copy
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('maid_driver_health',ROOT/'world/ops/qwenpaw_health.py')
health=importlib.util.module_from_spec(spec); spec.loader.exec_module(health)
class MaidDriverHealth(unittest.TestCase):
 def setUp(self):
  self.authorization='Bearer '+'fixture-'*7
  self.card=N(name='maid_native',protocol='mcp',enabled=True,
   endpoint={'transport':'streamable_http','url':'http://npc:8091/mcp','headers':{'Authorization':{'source':'credential','credential':'static','field':'authorization'}}},
   credentials={'static':N(kind='static',ref='mcp/maid_native')},config={'tools':sorted(health.MAID_TOOLS)},
   policy=N(default_effect='deny',rules=[N(subject='*',effect='allow',condition=None,target=N(kind='tool',name=t),principal=N(source_type='channel',source_value='console',subject_type='all',subject_value='')) for t in sorted(health.MAID_TOOLS)]))
  self.clients={'qd_learning':{}}
  self.client={'key':'maid_native','enabled':True,'transport':'streamable_http','url':'http://npc:8091/mcp','tools':sorted(health.MAID_TOOLS),'headers':{'Authorization':self.authorization}}
  self.policy={'default_effect':'deny','client_overrides':[],'tool_defaults':[],'unmanaged_rules_count':0,'tool_overrides':[{'source_type':'channel','source_value':'console','subject_type':'all','subject_value':'','effect':'allow','tool_name':t} for t in sorted(health.MAID_TOOLS)]}
  self.api={'/mcp':[{'key':'maid_native'},{'key':'qd_learning'}],'/mcp/maid_native':self.client,'/mcp/policy/maid_native':self.policy,'/mcp/tools/maid_native':[{'name':t,'enabled':True} for t in sorted(health.MAID_TOOLS)]}
 def check(self): health.check_maid_card(self.card,self.clients,self.authorization)
 def check_api(self):
  def get(path,aid=None):
   self.assertEqual(aid,'fixture-maid'); return self.api[path]
  health.check_maid_api(get,'fixture-maid')
 def test_native_api_created_card_needs_no_legacy_duplicate(self): self.check(); self.check_api()
 def test_consistent_legacy_is_allowed_and_conflicts_rejected(self):
  self.clients['maid_native']=copy.deepcopy(self.client); self.check()
  self.clients['maid_native']['headers']={'Authorization':'Bearer '+'other-'*8}
  with self.assertRaises(AssertionError): self.check()
 def test_unknown_legacy_client_rejected(self):
  self.clients['foreign']={}
  with self.assertRaises(AssertionError): self.check()
 def test_unscoped_or_foreign_channel_rules_rejected(self):
  for principal in [None,N(source_type='channel',source_value='*',subject_type='all',subject_value=''),N(source_type='channel',source_value='discord',subject_type='all',subject_value='')]:
   self.card.policy.rules[0].principal=principal
   with self.assertRaises(AssertionError): self.check()
 def test_extra_card_tool_or_duplicate_rule_rejected(self):
  self.card.config['tools'].append('shell')
  with self.assertRaises(AssertionError): self.check()
  self.card.config['tools'].remove('shell'); self.card.policy.rules[0]=self.card.policy.rules[1]
  with self.assertRaises(AssertionError): self.check()
 def test_live_api_must_match_exact_console_scope(self):
  self.policy['tool_overrides'][0]['source_value']='*'
  with self.assertRaises(AssertionError): self.check_api()
 def test_live_api_cannot_hide_inactive_or_missing_tools(self):
  self.api['/mcp/tools/maid_native'][0]['enabled']=False
  with self.assertRaises(AssertionError): self.check_api()
 def test_live_unmanaged_policy_rejected(self):
  self.policy['unmanaged_rules_count']=1
  with self.assertRaises(AssertionError): self.check_api()
if __name__=='__main__': unittest.main()
