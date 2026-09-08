"""Host relocation changes native execution, never logical authorship or lanes."""
import json
import inspect
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
import world_team_hosts as hosts
import world_team_profiles as profiles
import world_team_schedule as schedule
from world_team import TeamStore, members


class HostMappingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'runtime-hosts.json'
        self.env = patch.dict(os.environ, {'TEAM_RUNTIME_HOSTS_FILE': str(self.path)})
        self.env.start(); self.addCleanup(self.env.stop)
        self.config = {'schema': 1, 'migration': hosts.MIGRATION, 'phase': 'prepared',
                       'logicalActor': hosts.ENGINEER, 'source': dict(hosts.SOURCE), 'target': dict(hosts.TARGET)}
        self.calls, self.reservations = 0, []

    def phase(self, value):
        self.path.write_text(json.dumps(self.config | {'phase': value}), encoding='utf-8')

    def assign(self):
        god = TeamStore('game:mc-god', self.root)
        case = god.report('fixture-report', 'fixture-case', 'A reproducible issue', 'bug',
                          'Observed', 'Expected', ['fixture:observed'])
        god.update('fixture-route', case['caseId'], 1, 'working', 'Assigned engineer',
                   ['fixture:assigned'], hosts.ENGINEER)
        return case['caseId']

    async def run_native(self, runtime, role, spec=None):
        spec = spec or schedule.team_job(hosts.ENGINEER)
        job = N(id=spec['id'], model_dump=lambda **kw: spec)
        executor = N(_workspace=N(agent_id=role))
        async def original(*args):
            self.calls += 1
            return {'delivery_status': 'suppressed', 'run_id': 'fixture-native'}
        def reserve(*args):
            self.reservations.append(args)
            return {'ok': True, 'runId': 'original-ledger-run'}
        native = N(reserve_operation=reserve, finish_run=lambda *a, **k: None)
        with patch.dict(sys.modules, {'fcntl': N(LOCK_EX=1, LOCK_NB=2, flock=lambda *a: None),
                                      'operations_native_tasks': native}), \
             patch.object(schedule, 'TeamStore', lambda actor: TeamStore(actor, self.root)):
            return await schedule.execute(executor, job, original, runtime)

    def test_missing_is_legacy_prepared_does_not_authorize_new_host(self):
        self.assertEqual(hosts.host_config()['phase'], 'legacy')
        self.assertEqual(hosts.native_host(hosts.ENGINEER), hosts.SOURCE)
        self.assertIsNone(hosts.logical_actor('game', 'qd-engineer'))
        self.phase('prepared')
        self.assertEqual(hosts.native_host(hosts.ENGINEER), hosts.SOURCE)
        self.assertIsNone(hosts.logical_actor('game', 'qd-engineer'))
        self.assertEqual(hosts.logical_actor('game', 'qd-engineer', allow_prepared=True), hosts.ENGINEER)
        self.assertEqual(profiles.bindings('qd-engineer', 'game'), {})
        ready = profiles.bindings('qd-engineer', 'game', allow_prepared=True)
        suffix = ['--native-runtime', 'game', '--native-role', 'qd-engineer']
        self.assertEqual(ready['qd_world_team']['args'], ['/ops/world_team_mcp.py', '--actor', hosts.ENGINEER] + suffix)
        self.assertEqual(ready['qd_engineering']['args'], ['/ops/engineering_mcp.py', '--role', 'mc-god'] + suffix)

    def test_only_the_exact_predefined_relocation_is_accepted(self):
        for change in ({'phase': 'legacy'}, {'phase': 'unknown'}, {'schema': True},
                       {'target': {'runtime': 'game', 'agentId': 'mc-god'}},
                       {'logicalActor': 'operations:default'}, {'extra': True}):
            self.path.write_text(json.dumps(self.config | change), encoding='utf-8')
            with self.assertRaises(ValueError): hosts.host_config()
        self.path.write_text(json.dumps(self.config)[:-1] + ',"phase":"active"}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'duplicate'): hosts.host_config()
        self.phase('active')
        with patch.object(Path, 'is_symlink', lambda p: p == self.path):
            with self.assertRaisesRegex(ValueError, 'linked'): hosts.host_config()

    def test_active_host_changes_binding_not_members_or_chronology(self):
        original = members()
        old_job = schedule.team_job(hosts.ENGINEER)
        self.phase('active')
        self.assertEqual(members(), original)
        self.assertEqual(hosts.native_host(hosts.ENGINEER), hosts.TARGET)
        self.assertIsNone(hosts.logical_actor('operations', 'mc-god'))
        self.assertEqual(hosts.logical_actor('game', 'qd-engineer'), hosts.ENGINEER)
        self.assertEqual(profiles.bindings('mc-god', 'operations'), {})
        new_job = schedule.team_job(hosts.ENGINEER)
        self.assertEqual(new_job | {'meta': old_job['meta']}, old_job)
        self.assertEqual(new_job['meta'], old_job['meta'] | {'nativeHost': hosts.TARGET})
        roster = TeamStore(hosts.ENGINEER, self.root).roster()['members']
        engineer = next(row for row in roster if row['actor'] == hosts.ENGINEER)
        self.assertEqual(engineer['nativeHost'], hosts.TARGET)
        self.assertFalse(any(row['actor'] == 'game:qd-engineer' for row in roster))

    async def test_prepared_new_executor_cannot_run_or_write_a_lane(self):
        self.assign(); self.phase('prepared')
        result = await self.run_native('game', 'qd-engineer')
        self.assertEqual(result['final_text'], 'team_native_host_inactive')
        self.assertEqual((self.calls, self.reservations), (0, []))
        self.assertIsNone(TeamStore(hosts.ENGINEER, self.root).cycle_state())

    async def test_active_target_uses_old_cycle_lock_reservation_and_cases(self):
        case_id = self.assign()
        old_job = schedule.team_job(hosts.ENGINEER)
        self.phase('active')
        old = await self.run_native('operations', 'mc-god', old_job)
        self.assertEqual(old['final_text'], 'team_native_host_inactive')
        await self.run_native('game', 'qd-engineer')
        self.assertEqual(self.calls, 1)
        self.assertEqual(self.reservations, [('mc-god', 'qd-team-engineer')])
        self.assertTrue((self.root / 'cycle-operations-mc-god.lock').exists())
        self.assertFalse((self.root / 'cycle-game-qd-engineer.lock').exists())
        self.assertEqual(TeamStore(hosts.ENGINEER, self.root).cycle_state()['status'], 'completed')
        self.assertEqual(TeamStore(hosts.ENGINEER, self.root).case(case_id)['case']['owner'], hosts.ENGINEER)

    async def test_legacy_unknown_cannot_be_replayed_by_a_new_native_host(self):
        self.assign()
        store = TeamStore(hosts.ENGINEER, self.root)
        store.save_cycle('original-fingerprint', 'unknown', {'jobId': 'qd-team-engineer'})
        self.phase('active')
        result = await self.run_native('game', 'qd-engineer')
        self.assertEqual(result['final_text'], 'previous_team_cycle_requires_reconciliation')
        self.assertEqual((self.calls, self.reservations), (0, []))
        self.assertEqual(store.cycle_state()['status'], 'unknown')

    async def test_guard_rejects_wrong_host_before_learning_or_model_initialization(self):
        import cron_guard
        self.phase('active')
        executor = N(_workspace=N(agent_id='mc-god'))
        job = N(id='qd-team-engineer', task_type='agent')
        async def original(*args): raise AssertionError('model must not be called')
        def factory(*args, **kw): raise AssertionError('learning must not initialize')
        result = await cron_guard.guarded_execute(executor, job, original, 'operations', factory=factory)
        self.assertEqual(result['final_text'], 'team_native_host_inactive')

    async def test_hosted_weekly_keeps_operations_review_not_game_local_maintenance(self):
        import cron_guard
        self.phase('active')
        workspace = self.root / 'work/workspaces/qd-engineer'
        executor = N(_workspace=N(agent_id='qd-engineer', workspace_dir=workspace))
        job = N(id='qd-learning-mc-god', meta={'project': 'qiandengji'}, task_type='agent',
                dispatch=N(channel='console'), runtime=N(timeout_seconds=180, max_concurrency=1))
        service = N(role='mc-god', runtime='operations', root=self.root / 'learning')
        factories, finished = [], []
        def factory(*args, **kwargs):
            factories.append((args, kwargs))
            return service
        async def original(*args):
            self.calls += 1
            return {'task_type': 'agent', 'delivery_status': 'suppressed'}
        native = N(finish_run=lambda *args, **kwargs: finished.append((args, kwargs)))
        with patch.object(cron_guard, 'reserve_review', return_value={'ok': True, 'runId': 'old-logical-ledger'}) as reserve, \
                patch.dict(sys.modules, {'operations_native_tasks': native}):
            await cron_guard.guarded_execute(executor, job, original, 'game', factory=factory)
        self.assertEqual(factories, [(('qd-engineer', 'game'), {'state': self.root / 'work'})])
        reserve.assert_called_once_with(service, 'qd-learning-mc-god')
        self.assertEqual(self.calls, 1)
        self.assertEqual(finished[0][0], ('old-logical-ledger', 'completed'))
        saved = json.loads((service.root / 'last-cron.json').read_text(encoding='utf-8'))
        self.assertEqual((saved['role'], saved['jobId']), ('mc-god', 'qd-learning-mc-god'))

    async def test_host_change_during_weekly_reservation_cannot_start_model(self):
        import cron_guard
        self.phase('prepared')
        workspace = self.root / 'work/workspaces/mc-god'
        executor = N(_workspace=N(agent_id='mc-god', workspace_dir=workspace))
        job = N(id='qd-learning-mc-god', meta={'project': 'qiandengji'}, task_type='agent',
                dispatch=N(channel='console'), runtime=N(timeout_seconds=180, max_concurrency=1))
        service = N(role='mc-god', runtime='operations', root=self.root / 'learning')
        def reserved(*args):
            self.phase('active')
            return {'ok': True, 'runId': 'reserved-before-host-change'}
        async def original(*args): raise AssertionError('retired native host cannot execute')
        def finish(*args, **kwargs): raise AssertionError('unresolved reservation cannot become terminal')
        with patch.object(cron_guard, 'reserve_review', side_effect=reserved), \
                patch.dict(sys.modules, {'operations_native_tasks': N(finish_run=finish)}):
            with self.assertRaisesRegex(ValueError, 'team_native_host_inactive'):
                await cron_guard.guarded_execute(executor, job, original, 'operations', factory=lambda *a, **k: service)
        saved = json.loads((service.root / 'last-cron.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['runId'], 'reserved-before-host-change')
        self.assertFalse(saved['retryAutomatically'])

    def test_mcp_calls_recheck_physical_host_after_a_process_was_started(self):
        import engineering_mcp
        import world_team_mcp
        class App:
            def __init__(self): self.tools = {}
            def tool(self):
                def add(fn): self.tools[fn.__name__] = fn; return fn
                return add
        self.phase('prepared')
        self.assign()
        app = App()
        bound = hosts.host_tool_app(app, hosts.ENGINEER)
        world_team_mcp.register_team_tools(bound, hosts.ENGINEER, state=self.root)
        calls = []
        service = N(status=lambda: calls.append('status'),
                    commit=lambda *args: calls.append('commit'))
        engineering_mcp.register_engineering_tools(bound, service)
        app.tools['engineering_status']()
        self.assertEqual(calls, ['status'])
        self.assertIn('expected_source_sha256', inspect.signature(app.tools['engineering_commit']).parameters)
        self.phase('active')
        for tool, args in (('engineering_status', ()), ('engineering_commit', ('message', 'sha', 'job', 'id')),
                           ('team_cases', ())):
            with self.subTest(tool=tool), self.assertRaisesRegex(ValueError, 'team_native_host_inactive'):
                app.tools[tool](*args)
        self.assertEqual(calls, ['status'])
        target = App()
        target_bound = hosts.host_tool_app(target, hosts.ENGINEER, 'game', 'qd-engineer')
        engineering_mcp.register_engineering_tools(target_bound, service)
        target.tools['engineering_status']()
        self.assertEqual(calls, ['status', 'status'])
        self.phase('prepared')
        with self.assertRaisesRegex(ValueError, 'team_native_host_inactive'):
            target.tools['engineering_status']()
        with self.assertRaisesRegex(ValueError, 'team_native_host_inactive'):
            hosts.host_tool_app(App(), hosts.ENGINEER, 'game', 'qd-engineer')
        other = App()
        self.assertIs(hosts.host_tool_app(other, 'game:mc-god'), other)
        with self.assertRaises(ValueError): hosts.host_tool_app(other, 'game:mc-god', 'game', 'qd-engineer')
        with self.assertRaises(ValueError): hosts.host_tool_app(other, hosts.ENGINEER, 'game')

    def test_target_api_health_requires_explicit_native_binding_on_both_drivers(self):
        self.phase('active')
        expected = profiles.bindings('qd-engineer', 'game')
        answers = {}
        for key, client in expected.items():
            answers['/mcp/' + key] = dict(client)
            answers['/mcp/policy/' + key] = profiles.policy_payload(client['tools']) | {'unmanaged_rules_count': 0}
            answers['/mcp/tools/' + key] = [{'name': name, 'enabled': True} for name in client['tools']]
        self.assertTrue(profiles.check_api(answers.__getitem__, 'qd-engineer', 'game'))
        for key in expected:
            with self.subTest(driver=key):
                saved = answers['/mcp/' + key]
                answers['/mcp/' + key] = saved | {'args': saved['args'][:-4]}
                with self.assertRaisesRegex(AssertionError, 'client_drift'):
                    profiles.check_api(answers.__getitem__, 'qd-engineer', 'game')
                answers['/mcp/' + key] = saved

    @unittest.skipUnless(importlib.util.find_spec('mcp') is not None, 'native MCP schema package required')
    async def test_real_mcp_registration_keeps_typed_tool_schema_with_the_host_guard(self):
        from mcp.server.fastmcp import FastMCP
        import engineering_mcp
        import world_team_mcp
        self.phase('active')
        app = FastMCP('isolated-host-schema')
        bound = hosts.host_tool_app(app, hosts.ENGINEER, 'game', 'qd-engineer')
        world_team_mcp.register_team_tools(bound, hosts.ENGINEER, state=self.root)
        # Registration/listing never invokes the fake domain service or model.
        engineering_mcp.register_engineering_tools(bound, N())
        tools = {tool.name: tool.inputSchema for tool in await app.list_tools()}
        self.assertEqual(set(tools), set(world_team_mcp.COMMON_TOOLS) | set(engineering_mcp.TOOLS))
        self.assertEqual(set(tools['engineering_commit']['required']),
            {'message', 'expected_source_sha256', 'test_job_id', 'request_id'})
        self.assertEqual(tools['engineering_diff']['properties']['max_chars']['type'], 'integer')
        self.assertIn('case_id', tools['team_update']['required'])


if __name__ == '__main__': unittest.main()
