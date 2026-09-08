"""Pure fixture tests; never contact Qwen, trigger models or mutate the world."""
import hashlib
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('world_team_smoke_tool', ROOT / 'tools/world_team_health.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class WorldTeamSmokeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')
        return path

    def test_member_display_name_follows_roster_without_changing_actor(self):
        inventory = {'game:5swvhK': ('结衣', 'PRIVATE_SCOPE')}
        self.assertEqual(smoke.member_identity('game:5swvhK', inventory),
                         {'actor': 'game:5swvhK', 'displayName': '结衣'})
        inventory['game:5swvhK'] = ('新显示名', 'PRIVATE_SCOPE')
        self.assertEqual(smoke.member_identity('game:5swvhK', inventory)['displayName'], '新显示名')
        with self.assertRaises(KeyError):
            smoke.member_identity('game:unknown', inventory)

    def test_hosted_engineer_api_and_cron_trace_use_new_workspace_with_old_session(self):
        import world_team
        import world_team_hosts as hosts
        import world_team_profiles as profiles
        import world_team_schedule as schedule
        import role_learning_profiles
        from native_role_capabilities import NATIVE_SKILLS
        actor = hosts.ENGINEER
        path = self.write('server/team-state/runtime-hosts.json', {'schema': 1, 'migration': hosts.MIGRATION,
            'phase': 'active', 'logicalActor': actor, 'source': hosts.SOURCE, 'target': hosts.TARGET})
        calls, binding_checks = [], []
        inventory = {actor: ('天神 · 世界工程师', 'fixture engineering scope')}
        filename = 'qiandeng-world-team_world-team-operations-mc-god--cron--qd-team-engineer.json'
        self.write('server/agents/work/workspaces/qd-engineer/sessions/console/' + filename,
                   {'agent': {'state': {'context': [{'role': 'assistant', 'usage': {'input_tokens': 7},
                       'content': [{'type': 'tool_result', 'name': 'qd_world_team__team_context', 'state': 'success'}]}]}}})
        def request(runtime, route, role):
            calls.append((runtime, route, role))
            if route == '/agents':
                return {'agents': [{'id': 'qd-engineer', 'enabled': True}] if runtime == 'game' else []}
            self.assertEqual((runtime, role), ('game', 'qd-engineer'))
            if route == '/skills': return [{'name': name, 'enabled': True} for name in NATIVE_SKILLS]
            if route.endswith('/history'): return []
            if route == '/cron/jobs/qd-team-engineer':
                return {'spec': schedule.team_job(actor), 'state': {'last_status': 'success'}}
            if route == '/mcp/qd_world_team': return {}
            raise AssertionError('unanticipated route')
        def check_api(get, role, runtime):
            binding_checks.append((role, runtime))
            get('/mcp/qd_world_team')
        with mock.patch.dict(os.environ, {'TEAM_RUNTIME_HOSTS_FILE': str(path)}), \
                mock.patch.object(world_team, 'members', return_value=inventory), \
                mock.patch.object(profiles, 'check_api', side_effect=check_api), \
                mock.patch.object(role_learning_profiles, 'role_skills', return_value=[]), \
                mock.patch.object(schedule, 'SCHEDULES', {actor: schedule.SCHEDULES[actor]}), \
                mock.patch.object(smoke, 'sha', return_value='0' * 64), \
                mock.patch.object(smoke, 'team_metadata', return_value={}), \
                mock.patch.object(smoke, 'admin_metadata', return_value={}), \
                mock.patch.object(smoke, 'content_metadata', return_value={}), \
                mock.patch.object(smoke, 'engineering_metadata', return_value={}), \
                mock.patch.object(smoke, 'survivor_metadata', return_value={'enabled': True}):
            result = smoke.collect(self.root, request=request, probe=lambda root: {'ok': True})
        self.assertTrue(result['ok'], result['errors'])
        self.assertEqual(binding_checks, [('qd-engineer', 'game')])
        self.assertEqual(result['roles'][0]['actor'], actor)
        self.assertEqual(result['roles'][0]['nativeHost'], hosts.TARGET)
        cron = result['nativeSchedules'][0]
        self.assertEqual(cron['sessionId'], 'world-team-operations-mc-god')
        self.assertEqual(cron['dedicatedSession']['usage']['input_tokens'], 7)
        self.assertFalse(any(runtime == 'operations' and role == 'mc-god' for runtime, route, role in calls))
        self.assertEqual(result['modelRequests'], 0)

    def test_trace_never_discloses_text_arguments_errors_or_domain_success(self):
        message = {'role': 'assistant', 'error': {'message': 'PRIVATE_ERROR'},
            'created_at': '2026-09-09T01:00:00', 'finished_at': '2026-09-09T01:01:00',
            'usage': {'input_tokens': 80, 'output_tokens': 9, 'not_a_token': 'PRIVATE_USAGE'},
            'content': [{'type': 'thinking', 'thinking': 'PRIVATE_THINKING'},
                {'type': 'text', 'text': 'PRIVATE_TEXT'},
                {'type': 'tool_call', 'name': 'qd_world_team__world_admin_rule', 'state': 'finished', 'input': 'PRIVATE_ARGS'},
                {'type': 'tool_result', 'name': 'qd_world_team__world_admin_rule', 'state': 'success',
                 'output': [{'type': 'text', 'text': '{"ok":false,"code":"PRIVATE_REJECTED"}'}]}]}
        result = smoke.session_metadata({'agent': {'state': {'context': [message]}}})
        self.assertNotIn('PRIVATE_', json.dumps(result))
        self.assertTrue(result['assistantMessages'][0]['hasError'])
        self.assertTrue(result['toolExecutionObserved'])
        self.assertFalse(result['domainSuccessFromToolState'])
        self.assertEqual(result['usage'], {'input_tokens': 80, 'output_tokens': 9})

    def test_database_is_query_only_and_ledger_identity_is_validated(self):
        path = self.root / 'team.sqlite3'
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('CREATE TABLE cases(id,author,owner,status,version,updated_at)')
            db.execute('CREATE TABLE cycles(actor,status,at)')
            db.execute("INSERT INTO cases VALUES('case-1','game:mc-god','operations:mc-god','open',1,9)")
        before = path.read_bytes()
        with smoke.database(path) as db:
            with self.assertRaises(sqlite3.OperationalError):
                db.execute('DELETE FROM cases')
        result = smoke.team_metadata(path, {'game:mc-god', 'operations:mc-god'})
        self.assertEqual(result['caseCount'], 1)
        self.assertEqual(before, path.read_bytes())
        with self.assertRaisesRegex(ValueError, 'identity_invalid'):
            smoke.team_metadata(path, {'game:mc-god'})

    def test_completed_diagnostics_and_unknown_writes_are_not_confirmed_mutations(self):
        path = self.root / 'admin.sqlite3'
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('CREATE TABLE requests(id,actor,kind,status,receipt,created)')
            for index, (kind, status, confirmed) in enumerate((('diagnostics', 'completed', False),
                    ('rule', 'claimed', True), ('rule', 'completed', True))):
                db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?)', (str(index), 'game:mc-god', kind, status,
                    json.dumps({'ok': True, 'executionConfirmed': confirmed, 'private': 'HIDDEN'}), index))
        result = smoke.admin_metadata(path)
        self.assertEqual(result['confirmedMutationsInWindow'], 1)
        self.assertNotIn('HIDDEN', json.dumps(result))
        self.assertEqual(next(r for r in result['receipts'] if r['requestId'] == '1')['status'], 'unknown')

    def test_no_mutating_route_is_ever_requested(self):
        with mock.patch.object(smoke.urllib.request, 'build_opener') as opener:
            for route in ('/cron/jobs/qd-team-goddess/run', '/agents/mc-god/resume',
                          '/mcp/../console/chat/task', '/console/chat/task'):
                with self.assertRaisesRegex(ValueError, 'read_only'):
                    smoke.api('game', route, 'mc-god')
            opener.assert_not_called()

    def test_recent_native_failure_uses_exact_id_and_never_invents_missing_metadata(self):
        folder = self.root / 'server/survival-agent-state/survival'
        folder.mkdir(parents=True)
        rows = [{'taskId': 'task-111111111111', 'resultStatus': 'failed'},
                {'taskId': 'task-222222222222', 'resultStatus': 'failed'},
                {'kind': 'observation', 'private': 'HIDDEN'}]
        (folder / 'episodes.jsonl').write_text('\n'.join(map(json.dumps, rows)), encoding='utf-8')
        calls = []
        def api(runtime, route, role):
            calls.append((runtime, route, role))
            if route.endswith('111111111111'):
                raise urllib.error.HTTPError(route, 404, 'HIDDEN', {}, None)
            return {'status': 'finished', 'result': {'status': 'failed', 'error': {'code': 'timeout', 'message': 'HIDDEN'}}}
        result = smoke.recent_tasks(self.root, api)
        self.assertEqual(result[0]['taskId'], 'task-222222222222')
        self.assertEqual(result[0]['failureCode'], 'timeout')
        self.assertFalse(result[1]['nativeAvailable'])
        self.assertEqual(result[1]['httpStatus'], 404)
        self.assertNotIn('failureCode', result[1])
        self.assertNotIn('HIDDEN', json.dumps(result))
        self.assertTrue(all(runtime == 'game' and role == 'qd-survivor' for runtime, _, role in calls))

    def engineering(self):
        from engineering_workspace import canonical, digest
        folder = 'server/engineering/'
        test_body = b'assert True\n'
        test_sha = hashlib.sha256(test_body).hexdigest()
        entries = [{'path': 'tests/fixed.py', 'sha256': test_sha, 'mode': '100644', 'size': len(test_body)}]
        source = digest(canonical(entries))
        plan = {'id': 'fixed', 'image': 'sha256:' + '1' * 64, 'checks': {'tests/fixed.py': test_sha}}
        request = {'schema': 1, 'role': 'mc-god', 'jobId': smoke.BASELINE_ID, 'planId': 'fixed',
            'sourceSha256': source, 'planSha256': digest(canonical(plan)), 'baseCommit': 'a' * 40,
            'head': 'a' * 40, 'branch': 'codex/ops-fixture'}
        self.write(folder + 'requests/' + smoke.BASELINE_ID + '.json', request)
        receipt = request | {'status': 'passed', 'exitCode': 0, 'imageId': plan['image'], 'containerRemoved': True,
            'log': 'Ran 8 tests in 0.01s\nOK\n'}
        path = self.write(folder + 'receipts/' + smoke.BASELINE_ID + '.json', receipt)
        self.write(folder + 'config.json', {'plans': [plan]})
        self.write(folder + 'snapshots/' + source + '/manifest.json', {'sourceSha256': source, 'entries': entries})
        source_path = self.root / folder / 'snapshots' / source / 'source/tests/fixed.py'
        source_path.parent.mkdir(parents=True)
        source_path.write_bytes(test_body)
        return path, receipt, source_path

    def test_engineering_baseline_is_bound_to_image_manifest_and_fixed_checks_not_deployment(self):
        _, _, source = self.engineering()
        result = smoke.engineering_metadata(self.root)
        self.assertEqual(result['testsReported'], 8)
        self.assertEqual(result['candidateFixDeployed'], 'not_verified')
        source.write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'fixed_test_mismatch'):
            smoke.engineering_metadata(self.root)

    def test_engineering_failed_or_foreign_image_receipt_cannot_pass(self):
        path, receipt, _ = self.engineering()
        for patch in ({'status': 'failed'}, {'imageId': 'sha256:' + '2' * 64}, {'jobId': 'other'}):
            path.write_text(json.dumps(receipt | patch))
            with self.assertRaises(ValueError):
                smoke.engineering_metadata(self.root)


if __name__ == '__main__':
    unittest.main()
