import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('roles_sync',Path(__file__).resolve().parents[1]/'roles_sync.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
DATE='Fri, 30 Oct 2026 08:53:07 GMT'
BASE=int(module.email.utils.parsedate_to_datetime(DATE).timestamp()*1000)
class ClockTest(unittest.TestCase):
 def test_cross_host_skew_preserves_source_and_shortens_lease(self):
  body={'observedAt':BASE+800,'expiresAt':BASE+45800,'roles':[]}
  for received in [BASE-700,BASE+20000]:
   result=module.local_clock(body,DATE,received,120)
   self.assertEqual(result['sourceObservedAt'],body['observedAt']);self.assertEqual(result['sourceExpiresAt'],body['expiresAt'])
   self.assertEqual(result['expiresAt']-result['observedAt'],45000);self.assertLess(result['expiresAt']-received,45000);self.assertLessEqual(result['observedAt'],received)
 def test_expired_body_cannot_receive_a_new_lease(self):
  with self.assertRaises(ValueError):module.local_clock({'observedAt':BASE-60000,'expiresAt':BASE-15000},DATE,BASE,10)
 def test_future_source_timestamp_denied(self):
  with self.assertRaises(ValueError):module.local_clock({'observedAt':BASE+2000,'expiresAt':BASE+47000},DATE,BASE,10)
 def test_network_delay_consumes_lease(self):
  with self.assertRaises(ValueError):module.local_clock({'observedAt':BASE-44000,'expiresAt':BASE+1000},DATE,BASE,1500)
 def test_missing_origin_clock_denied(self):
  with self.assertRaises(ValueError):module.local_clock({'observedAt':BASE,'expiresAt':BASE+45000},None,BASE,10)
if __name__=='__main__':unittest.main()
