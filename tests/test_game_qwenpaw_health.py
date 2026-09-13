import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('game_upgrade_health', Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class GameRuntimeHealth(unittest.TestCase):
    def probe(self, receipt=None, behavior=True, exit_code=0):
        if receipt is None:
            receipt = {'ok': True, 'project': 'qiandengji', 'packageVersion': '2.2.0',
                       'agents': 6, 'enabledTools': 7, 'authMode': 'local-passwordless', 'nativeToolPolicyVerified': True,
                       'anonymousAccess': True, 'baseAgents': 6, 'maidAgents': 0,
                       'cronBudgetGuardVerified': True, 'installedSkillBindings': 30}
        result = SimpleNamespace(returncode=exit_code, stdout=json.dumps(receipt))
        with patch.object(health.subprocess, 'run', return_value=result) as call, \
                patch.object(health, 'probe_recorded_behavior', return_value={'ok': behavior}):
            answer = health.probe_game_qwenpaw()
            self.assertEqual(call.call_args.args[0], ['docker', 'exec', 'qiandengji-qwenpaw-1', 'python', '/ops/qwenpaw_health.py'])
            return answer

    def test_current_runtime_and_recorded_behavior_both_required(self):
        self.assertTrue(self.probe()['ok'])
        self.assertFalse(self.probe(behavior=False)['ok'])
        self.assertFalse(self.probe(exit_code=1)['ok'])

    def test_old_version_or_wrong_roles_cannot_pass(self):
        valid = {'ok': True, 'project': 'qiandengji', 'packageVersion': '2.2.0',
                 'agents': 6, 'enabledTools': 7, 'authMode': 'local-passwordless', 'anonymousAccess': True,
                 'baseAgents': 6, 'maidAgents': 0, 'cronBudgetGuardVerified': True, 'installedSkillBindings': 30, 'nativeToolPolicyVerified': True}
        for key, value in [('packageVersion','2.1.0'),('project','qiandengji-ops'),('agents',3),
                           ('enabledTools',1),('enabledTools',False),('anonymousAccess',False),
                           ('maidAgents',1),('cronBudgetGuardVerified',False),('installedSkillBindings',0),('nativeToolPolicyVerified',False)]:
            with self.subTest(key=key, value=value):
                self.assertFalse(self.probe({**valid,key:value})['ok'])


if __name__ == '__main__': unittest.main()
