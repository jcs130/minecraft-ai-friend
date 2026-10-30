import json,pathlib,sys,tempfile,unittest
BASE=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(BASE))
from ali_login_compat import draft,verify_mods,ALI_JAR,EXCEPTION

class AliLoginContract(unittest.TestCase):
 def config(self):return {'sessionGracePeriod':0,'minPasswordLength':8,'loginTimeout':60,'maxLoginAttempts':5,'heldPayloadExceptions':['maw_agent:world_query'],'deferredScreenPayloads':['origins:network#1'],'other':{'unchanged':True}}
 def test_only_exact_read_only_packet_is_added(self):
  before=self.config();original=json.loads(json.dumps(before));after=draft(before)
  self.assertEqual(before,original);self.assertEqual(after['heldPayloadExceptions'],['maw_agent:world_query','ali:network#4'])
  self.assertEqual({k:v for k,v in after.items()if k!='heldPayloadExceptions'},{k:v for k,v in before.items()if k!='heldPayloadExceptions'})
 def test_repeat_is_a_read_only_noop(self):
  first=draft(self.config());self.assertEqual(draft(first),first);self.assertEqual(first['heldPayloadExceptions'].count(EXCEPTION),1)
 def test_other_ali_messages_cannot_be_mistaken_for_bootstrap(self):
  for entry in ['ali:network','ali:network#1','ali:network#2','ali:network#3']:
   c=self.config();c['heldPayloadExceptions'].append(entry)
   with self.assertRaisesRegex(ValueError,'requires_review'):draft(c)
 def test_existing_auth_gates_cannot_be_relaxed(self):
  for patch in [{'sessionGracePeriod':600},{'minPasswordLength':6}]:
   with self.assertRaisesRegex(ValueError,'auth_policy_required'):draft(self.config()|patch)
 def test_bad_exception_shape_is_diagnosed(self):
  for value in [None,'ali:network#4',[4]]:
   with self.assertRaisesRegex(ValueError,'string_array'):draft(self.config()|{'heldPayloadExceptions':value})
 def test_changed_jar_requires_wire_contract_review(self):
  with tempfile.TemporaryDirectory()as d:
   (pathlib.Path(d)/ALI_JAR).write_bytes(b'new-version-with-possibly-different-discriminators')
   with self.assertRaisesRegex(ValueError,'wire_contract'):verify_mods(d)
if __name__=='__main__':unittest.main()
