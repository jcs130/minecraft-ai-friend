"""Provisioning follows the active native host without changing logical duties."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
with patch.dict(os.environ):
    import configure_world_team as configure
import world_team_hosts as hosts


class HostedProvisioningTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.path = self.root / 'runtime-hosts.json'
        self.path.write_text(json.dumps({'schema': 1, 'migration': hosts.MIGRATION,
            'phase': 'active', 'logicalActor': hosts.ENGINEER,
            'source': hosts.SOURCE, 'target': hosts.TARGET}), encoding='utf-8')
        env = patch.dict(os.environ, {'TEAM_RUNTIME_HOSTS_FILE': str(self.path)})
        env.start(); self.addCleanup(env.stop)

    def test_preview_and_activation_only_address_the_active_target(self):
        from world_team_schedule import team_job
        calls = []
        profile = {'id': 'qd-engineer', 'name': '天神', 'language': 'zh',
                   'workspace_dir': 'workspaces/qd-engineer', 'active_model': {'model': 'preserved'},
                   'fallback_models': [], 'running': {'unchanged': True}}
        def api(runtime, method, route, role, body=None, headers=None):
            calls.append((runtime, method, route, role))
            self.assertEqual((runtime, role), ('game', 'qd-engineer'))
            if route == '/agents/qd-engineer': return dict(profile)
            if route == '/cron/jobs': return [team_job(hosts.ENGINEER) | {'enabled': False}]
            if route == '/cron/jobs/qd-team-engineer/resume': return {'success': True}
            raise AssertionError('unexpected route')
        with patch.object(configure, 'ROOT', self.root), \
                patch.object(configure, 'members', return_value={hosts.ENGINEER: ('天神', 'engineering')}), \
                patch.object(configure, 'api', side_effect=api), patch('builtins.print'):
            before = configure.configure('preview')
            self.assertEqual(calls, [('game', 'GET', '/agents/qd-engineer', 'qd-engineer')])
            after = configure.configure('activate')
        self.assertEqual(before['roles'][0]['actor'], hosts.ENGINEER)
        self.assertEqual(before['roles'][0]['nativeHost'], hosts.TARGET)
        self.assertEqual(after['roles'][0]['nativeHost'], hosts.TARGET)
        self.assertEqual([r for r in calls if r[1] != 'GET'],
                         [('game', 'POST', '/cron/jobs/qd-team-engineer/resume', 'qd-engineer')])

    def test_retired_source_cannot_be_reenabled_by_a_late_configuration_write(self):
        with patch.object(configure.urllib.request, 'build_opener') as network:
            with self.assertRaisesRegex(ValueError, 'team_native_host_inactive'):
                configure.api('operations', 'POST', '/cron/jobs/qd-team-engineer/resume', 'mc-god')
            with self.assertRaisesRegex(ValueError, 'team_native_host_inactive'):
                configure.api('operations', 'PUT', '/agents/mc-god', 'mc-god', {'enabled': True})
            network.assert_not_called()


if __name__ == '__main__': unittest.main()
