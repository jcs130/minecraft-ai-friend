"""Readonly health must distinguish missing current native evidence from idle."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import navigation_sense_health as health

BODY='d4ac9523-4962-43ed-98c5-19b49e104048'
OWNER='e5005711-be9f-44b7-aaad-6993c0ba5df4'
NOW=1800000000


class ProbeTests(unittest.TestCase):
    def setUp(self):
        exact={'bodyUuid':BODY,'ownerUuid':OWNER,'bodyName':'Kirito'}
        self.files={health.BUILD_RECORD:{'ok':True,'sha256':'a','sources':{n:'a' for n in health.REQUIRED_SOURCES},
            'dependencies':{Path(health.NUMEN).name:'a'}},health.MANIFEST:{'schema_version':1,'files':[{'path':health.JAR,'sha256':'a'}]},
            health.SETTINGS:exact,health.CONFIG:{'schema':1,'enabled':True,'bodies':[exact]}}
        self.row={'schema':1,'capability':'numen_navigation_sense_v1','ok':True,'actorUuid':BODY,'dimension':'minecraft:overworld',
            'observedAt':NOW*1000,'gameTime':10,'bodyTickCount':8,'queuedTask':None,
            'bodyControl':{'available':True,'sample':'last_native_scheduler_selection','kind':'idle','name':'none','nativeAvoidanceActive':False}}
        self.calls=[]
    def run_probe(self):
        def sample(body):self.calls.append(body);return self.row
        with patch.object(health,'digest',return_value='a'),patch.object(health,'document',side_effect=lambda root,name:self.files[name]):
            return health.probe(sample=sample,clock=lambda:NOW)
    def test_current_idle_and_native_avoidance_are_both_healthy(self):
        self.assertTrue(self.run_probe()['ok'])
        self.row['bodyControl'].update(kind='reflex',name='mob_defense',nativeAvoidanceActive=True)
        result=self.run_probe();self.assertTrue(result['ok']);self.assertEqual(result['evidence']['geometryScans'],0)
        self.assertEqual(self.calls,[BODY,BODY])
    def test_missing_scheduler_is_not_falsely_idle(self):
        self.row['bodyControl']={'available':False,'code':'native_scheduler_layout_unavailable'}
        self.assertFalse(self.run_probe()['ok'])
    def test_old_or_wrong_body_is_not_healthy(self):
        self.row['observedAt']-=16000;self.assertFalse(self.run_probe()['ok'])
        self.row['observedAt']=NOW*1000;self.row['actorUuid']=OWNER;self.assertFalse(self.run_probe()['ok'])
    def test_wrong_config_does_not_query_another_body(self):
        self.files[health.CONFIG]['bodies']=[];self.assertFalse(self.run_probe()['ok']);self.assertEqual(self.calls,[])
    def test_dependency_and_source_drift_remain_failed(self):
        self.files[health.BUILD_RECORD]['dependencies'][Path(health.NUMEN).name]='other'
        self.assertFalse(self.run_probe()['ok'])
        self.files[health.BUILD_RECORD]['dependencies'][Path(health.NUMEN).name]='a'
        self.files[health.BUILD_RECORD]['sources']={};self.assertFalse(self.run_probe()['ok'])

if __name__=='__main__':unittest.main()
