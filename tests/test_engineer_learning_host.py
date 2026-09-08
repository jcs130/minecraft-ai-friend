"""Native workspace identity stays distinct from the engineer's old ledger ID."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from agent_learning import LearningTools, write, managed_job
from role_learning_profiles import roles, learning_client, learning_identity, learning_job, role_skills, validate_jobs
from native_role_capabilities import rules
from world_team_hosts import ENGINEER, SOURCE, TARGET, MIGRATION


class EngineerLearningHostTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.state = self.root / 'state'
        self.mapping = self.root / 'runtime-hosts.json'
        env = patch.dict(os.environ, {'TEAM_RUNTIME_HOSTS_FILE': str(self.mapping)})
        env.start(); self.addCleanup(env.stop)
        self.phase('active')
        write(self.state / 'config.json', {'agents': {'profiles': {
            'mc-god': {'enabled': True}, 'qd-engineer': {'enabled': True}}}})
        for role in ('mc-god', 'qd-engineer'):
            write(self.state / 'workspaces' / role / 'agent.json', {'id': role, 'mcp': {'clients': {}}})
        self.calls = []
        def api(role, method, path, payload=None):
            self.calls.append((role, method, path, payload))
            return {'success': True, 'spec': managed_job('mc-god', 'operations')}
        self.api = api

    def phase(self, value):
        write(self.mapping, {'schema': 1, 'migration': MIGRATION, 'phase': value,
            'logicalActor': ENGINEER, 'source': SOURCE, 'target': TARGET})

    def test_active_roster_and_skills_keep_logical_duties(self):
        self.assertIn('qd-engineer', roles('game'))
        self.assertNotIn('mc-god', roles('operations'))
        self.assertIn('mc-god', roles('game'))
        self.assertEqual(learning_identity('qd-engineer', 'game'), ('mc-god', 'operations'))
        self.assertEqual(role_skills('qd-engineer', 'game'),
            ['qd-evidence-report', 'qd-priority-review', 'qd-skill-evolution', 'qd-world-team'])

    def test_learning_writes_and_api_target_only_new_workspace(self):
        tools = LearningTools('mc-god', 'operations', self.state, api=self.api,
                              native_role='qd-engineer', native_runtime='game')
        self.assertEqual((tools.role, tools.runtime), ('mc-god', 'operations'))
        self.assertEqual(tools.workspace, self.state / 'workspaces/qd-engineer')
        tools.maintenance()
        self.assertTrue((self.state / 'workspaces/qd-engineer/learning/maintenance.json').exists())
        self.assertFalse((self.state / 'workspaces/mc-god/learning').exists())
        tools.schedule(enabled=False)
        tools._reload('example-skill')
        self.assertTrue(all(call[0] == 'qd-engineer' for call in self.calls))
        self.assertEqual(self.calls[0][2], '/cron/jobs/qd-learning-mc-god')

    def test_cron_factory_actual_identity_automatically_maps_to_old_ledger(self):
        tools = LearningTools('qd-engineer', 'game', self.state, api=self.api)
        self.assertEqual((tools.role, tools.runtime, tools.native_role), ('mc-god', 'operations', 'qd-engineer'))
        expected = managed_job('mc-god', 'operations')
        self.assertEqual(learning_job('qd-engineer', 'game'), expected)
        validate_jobs({'jobs': [expected]}, 'qd-engineer', 'game')

    def test_prepared_only_allows_building_not_execution(self):
        self.phase('prepared')
        self.assertNotIn('qd-engineer', roles('game'))
        self.assertIn('mc-god', roles('operations'))
        self.assertIn('--native-role', learning_client('qd-engineer', 'game')['args'])
        with self.assertRaisesRegex(ValueError, 'unregistered_learning_role'):
            LearningTools('qd-engineer', 'game', self.state)
        old = LearningTools('mc-god', 'operations', self.state)
        self.phase('active')
        with self.assertRaisesRegex(ValueError, 'inactive'): old.assert_host()
        with self.assertRaisesRegex(ValueError, 'unregistered_learning_role'):
            LearningTools('mc-god', 'operations', self.state)

    def test_explicit_cross_role_or_partial_binding_is_rejected(self):
        for native_role, native_runtime in (('mc-god', 'game'), ('mc-herald', 'game'), ('qd-engineer', None)):
            with self.subTest(native_role=native_role), self.assertRaises(ValueError):
                LearningTools('mc-god', 'operations', self.state,
                              native_role=native_role, native_runtime=native_runtime)

    def test_file_and_cron_guard_rebind_without_opening_goddess_or_git(self):
        rows = rules('qd-engineer')
        def denied(tool, key, value):
            return any(tool in row['tools'] and key in row['params']
                       and any(re.search(p, value) for p in row['patterns']) for row in rows)
        self.assertFalse(denied('write_file', 'file_path', '/state/work/workspaces/qd-engineer/engineering/repo/world/a.py'))
        self.assertTrue(denied('write_file', 'file_path', '/state/work/workspaces/mc-god/notes/a.md'))
        self.assertTrue(denied('write_file', 'file_path', 'engineering/repo/.git/config'))
        self.assertFalse(denied('execute_shell_command', 'command',
                                'qwenpaw cron get qd-learning-mc-god --agent-id qd-engineer'))
        self.assertTrue(denied('execute_shell_command', 'command',
                               'qwenpaw cron get qd-learning-mc-god --agent-id mc-god'))


if __name__ == '__main__': unittest.main()
