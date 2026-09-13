"""CLI/report integration against native host selection; no network/model calls."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
if os.name != 'nt':
    import operations_native_tasks as native
    import operations_team_run as runner
    from operations_team_mcp import OperationsTools
    from world_team_hosts import MIGRATIONS


@unittest.skipIf(os.name == 'nt', 'uses the deployed Linux ledger module')
class OperationsTeamRunTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.manifest = self.root / 'runtime-hosts.json'
        self.manifest.write_text(json.dumps({'schema': 2, 'phases': {}}))
        environment = patch.dict(os.environ, {'TEAM_RUNTIME_HOSTS_FILE': str(self.manifest)}, clear=True)
        environment.start(); self.addCleanup(environment.stop)
        # Only map the helper's two absolute roots into this disposable fixture.
        paths = patch('operations_state.Path', side_effect=lambda path: self.root / path.lstrip('/'))
        paths.start(); self.addCleanup(paths.stop)
        state = patch.object(native, 'STATE', self.root / 'unbound')
        state.start(); self.addCleanup(state.stop)

    def completed_report(self, hosted):
        expected = self.root / ('operations-state' if hosted else 'state')
        request = 'ops-cli-fixture-mc-god'
        def delegate(caller, role, task):
            self.assertEqual((caller, role), ('default', 'mc-god'))
            self.assertEqual(native.STATE, expected)
            kwargs = {'native_role': 'qd-engineer', 'native_runtime': 'game'} if hosted else {}
            service = OperationsTools(role, **kwargs)
            service.submit(request, 'Fixture native report', [], [])
            return {'ok': True, 'runId': 'ops-cli-fixture', 'requestId': request,
                    'taskId': 'task-fixture', 'startedAt': 100}
        output = io.StringIO()
        with patch.object(runner, 'delegate', side_effect=delegate), \
                patch.object(runner, 'usage', return_value={'total_calls': 0,
                    'total_prompt_tokens': 0, 'total_completion_tokens': 0}), \
                patch.object(runner, 'api', return_value={'status': 'finished',
                    'result': {'status': 'completed'}}) as api, redirect_stdout(output):
            self.assertEqual(runner.run('mc-god', 'Read current evidence'), 0)
        self.assertEqual(api.call_args_list[0].args, ('GET', '/console/chat/task/task-fixture', 'mc-god'))
        self.assertEqual(api.call_count, 1)  # A valid report never causes a stop request.
        report = json.loads(output.getvalue())
        self.assertTrue(report['ok'])
        self.assertTrue(report['roles'][0]['reportRecorded'])
        self.assertEqual(json.loads((expected / 'run-reports/latest.json').read_text()), report)
        self.assertFalse((self.root / ('state' if hosted else 'operations-state')).exists())

    def test_hosted_cli_reads_mcp_report_and_archives_in_shared_root_without_env(self):
        self.manifest.write_text(json.dumps({'schema': 2,
            'phases': {name: 'active' for name in MIGRATIONS},
            'retired': ['qd-diagnostics', 'mc-priest', 'mc-guard-kirito'],
            'dormant': ['mc-guard-naruto']}))
        self.completed_report(hosted=True)

    def test_wrong_inherited_root_cannot_redirect_hosted_cli(self):
        self.manifest.write_text(json.dumps({'schema': 2,
            'phases': {name: 'active' for name in MIGRATIONS}}))
        os.environ['QIANDENG_OPERATIONS_STATE_DIR'] = '/wrong-root'
        self.completed_report(hosted=True)

    def test_legacy_cli_retains_original_root(self):
        self.completed_report(hosted=False)

    def test_retired_coordinator_refuses_before_api_or_delegation(self):
        self.manifest.write_text(json.dumps({'schema': 2,
            'phases': {name: 'active' for name in MIGRATIONS}, 'retired': ['qd-steward']}))
        with patch.object(runner, 'usage') as usage, patch.object(runner, 'delegate') as delegate:
            with self.assertRaisesRegex(ValueError, 'team_native_host_inactive'):
                runner.run('mc-god', 'Read current evidence')
            usage.assert_not_called(); delegate.assert_not_called()

    def test_old_specialists_still_cannot_be_delegated(self):
        with patch.object(runner, 'usage', return_value={}), patch.object(native, 'api') as api, \
                redirect_stdout(io.StringIO()):
            for role in ('mc-herald', 'mc-priest', 'mc-guard-kirito', 'mc-guard-naruto'):
                self.assertEqual(runner.run(role, 'Read current evidence'), 1)
            api.assert_not_called()
        self.assertFalse(any(self.root.glob('*/operations-budget/delegations.json')))


if __name__ == '__main__':
    unittest.main()
