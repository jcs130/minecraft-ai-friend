import hashlib
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from tools import maw_agent_mc_trial_health as health

class TrialTaskHealthTests(unittest.TestCase):
    def test_task_monitor_failure_cannot_hide_behind_the_ten_legacy_checks(self):
        with tempfile.TemporaryDirectory(prefix='maw-trial-health-') as temporary:
            root = Path(temporary); trial = root/'trial'; trial.mkdir()
            old = root/'agents/maw-explorer'; old.mkdir(parents=True)
            (old/'actions.jsonl').write_bytes(b'')
            (old/'state.json').write_text(json.dumps({'round':464}))
            world = trial/'world.json'
            config = {'stateDirectory':str(trial),'worldConfigFile':str(world),'username':'Test',
                      'maxModelCalls':20,'task':{'id':'one'},'node':'node','worldPackageFile':str(root/'index.mjs')}
            data = {
                'config.json':config, 'world.json':{'username':'Test','expectedUuid':'same'},
                'status.json':{'pid':1,'phase':'stopped','username':'Test','model':'qwen3.7-plus','qwenpawConnected':False,
                               'current':{'bodyId':'same'},'modelState':{'calls':10},'task':{'id':'one'}},
                'process.json':{'pid':1},
                'production-baseline.json':{'files':{},'oldLedger':{'bytes':0,'sha256':hashlib.sha256(b'').hexdigest()},
                                           'owners':{'28985':'owner','28996':'owner'}}
            }
            for name,value in data.items(): (trial/name).write_text(json.dumps(value),encoding='utf-8')
            owner={'runId':'owner','healthy':True,'paused':False,'heartbeatEpoch':time.time()}
            report={'health':{'ok':True},'attempts':1,'totalModelCalls':4}
            with patch.object(health,'DEFAULT_ROOT',root), patch.object(health,'urlopen',side_effect=lambda *a,**k:io.BytesIO(json.dumps(owner).encode())):
                with patch.object(health.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(report))):
                    ok=health.probe(trial); self.assertTrue(ok['ok']); self.assertEqual(len(ok['checks']),13)
                with patch.object(health.subprocess,'run',side_effect=FileNotFoundError()):
                    broken=health.probe(trial); self.assertFalse(broken['ok']); self.assertEqual(len(broken['checks']),10)
                report['health']['ok']=False
                with patch.object(health.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout=json.dumps(report))):
                    self.assertFalse(health.probe(trial)['ok'])

if __name__ == '__main__': unittest.main()
