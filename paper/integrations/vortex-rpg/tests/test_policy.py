from pathlib import Path
import importlib.util,json,unittest,zipfile,hashlib
import yaml
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('policy',ROOT.parent/'agent-anticheat/prepare.py');policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
class PolicyTest(unittest.TestCase):
 def test_allowed_automation_not_identity_based(self):
  with zipfile.ZipFile('E:/MC/ops/repairs/vortex-mmo-20261027/LightAntiCheat-1.2.6.jar')as z:c=yaml.safe_load(z.read('config.yml'))
  c,report=policy.configure(c)
  self.assertEqual(len(report['enabledChecks']),46);self.assertEqual(len(report['disabledAutomationChecks']),11)
  self.assertEqual(set(report['correctiveChecks']),{'flight_a','flight_b','flight_c'});self.assertTrue(c['api']['enabled'])
  for group in ['autobot','autoclicker','sorting']:
   checks=next(v[group]for v in c['checks'].values()if group in v)
   self.assertTrue(all(not x['enabled']for x in checks.values()))
  for family,group in [('movement','flight'),('movement','speed'),('combat','reach'),('interaction','fastbreak'),('packet','badpackets')]:
   self.assertTrue(any(x['enabled']for x in c['checks'][family][group].values()))
  for groups in c['checks'].values():
   for checks in groups.values():
    for item in checks.values():self.assertFalse(item['punishment']['punishable']);self.assertEqual(item['punishment']['commands'],[])
  self.assertTrue(c['permission']['disable-all-bypass-permissions']);self.assertFalse(c['geyser-hook']['uuid']['enabled']);self.assertFalse(c['geyser-hook']['prefix']['enabled']);self.assertTrue(c['geyser-hook']['floodgate']['enabled'])
  self.assertTrue(all(not item['enabled']for item in c['alerts'].values()if isinstance(item,dict)))
 def test_facility_geometry_matches_original_map_survey(self):
  source=json.loads(Path('E:/MC/ops/repairs/vortex-mmo-20261027/city-survey/city-survey.json').read_text())
  city=yaml.safe_load((ROOT/'resources/city-facilities.yml').read_text(encoding='utf8'))
  self.assertEqual(source['archiveSha256'],city['source-map-sha256']);self.assertEqual(len(city['facilities']),7)
  for value in city['facilities'].values():
   match=next(r for r in source['rooms']if r['entrance']==value['entrance']and r['inside']==value['inside'])
   self.assertEqual(value['roofed-floor-cells'],match['walkableRoofedCells'])
 def test_upstream_artifact_conservation(self):
  report=json.loads(Path('E:/MC/ops/repairs/vortex-mmo-20261027/VortexRPG-1.2.2-alpha-qd-preview5.json').read_text())
  with zipfile.ZipFile('E:/MC/ops/repairs/conquest-rpg-20261026/vortex/VortexRPG-1.2.2-alpha-paper1211-compat.jar')as base,zipfile.ZipFile('E:/MC/ops/repairs/vortex-mmo-20261027/VortexRPG-1.2.2-alpha-qd-preview5.jar')as new:
   changed=[]
   for name in base.namelist():
    if base.read(name)!=new.read(name):changed.append(name)
   self.assertTrue(set(changed).issubset(set(report['changedClasses'])))
   self.assertEqual(base.read('plugin.yml'),new.read('plugin.yml'));self.assertEqual(base.read('config.yml'),new.read('config.yml'))
   self.assertEqual(hashlib.sha256(Path(new.filename).read_bytes()).hexdigest(),report['sha256'])
if __name__=='__main__':unittest.main(verbosity=2)
