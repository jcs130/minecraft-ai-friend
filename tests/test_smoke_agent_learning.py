import ast
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('learning_smoke_test', ROOT / 'tools/smoke_agent_learning.py')
smoke = importlib.util.module_from_spec(spec); spec.loader.exec_module(smoke)
from agent_learning import managed_job, GAME_ROLES, OPS_ROLES


class LearningSmoke(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup); self.root = Path(tmp.name)
        for name in (*smoke.SOURCE_FILES, 'tools/smoke_agent_learning.py'):
            target = self.root / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / name, target)
        self.requests = []
        self.job = managed_job(smoke.ROLE, 'operations')
        self.clock = 10000.0
        self.usage = {'agent_id': smoke.ROLE, 'call_count': 8, 'prompt_tokens': 100, 'completion_tokens': 20}

    def probe(self, runtime):
        roles = GAME_ROLES if runtime == 'game' else OPS_ROLES
        return {'ok': True, 'modelTasksSubmitted': 0, 'runtime': runtime, 'guardVerified': True,
            'sourceHashes': {name: smoke.digest(self.root / name) for name in smoke.SOURCE_FILES},
            'roles': [{'role': role, 'enabledSkills': ['qd-skill-evolution', 'make-skill', 'file_reader', 'cron'], 'nativeDriverEnabled': True,
                'initialized': True, 'statusCalled': True, 'returnedOwnRole': True,
                'listedTools': 10, 'managedJobId': 'qd-learning-' + role} for role in roles],
            'fixture': {'noEvidenceSkipped': True, 'modelCalls': 0, 'roleIsolationRejections': 3}}

    def get(self, route, role=smoke.ROLE, *, post=False):
        self.requests.append((route, post))
        if route == '/cron/jobs': return [deepcopy(self.job)]
        if route == '/cron/jobs/' + smoke.JOB: return {'spec': deepcopy(self.job)}
        if route.endswith('/agent-status'): return {'running_task_count': 0}
        if route.startswith('/token-usage/details'): return [deepcopy(self.usage)]
        if post and route == '/cron/jobs/' + smoke.JOB + '/run': return {'started': True}
        raise AssertionError('Unexpected request ' + route)

    def test_default_has_no_experiment_and_writes_all_evidence_levels(self):
        report = smoke.run(self.root, runtime_probe=self.probe, exercise_fn=lambda *a: self.fail('No paid experiment by default'))
        self.assertTrue(report['ok']); self.assertFalse(report['exercise']['requested'])
        self.assertIsNone(report['exercise']['skillProduced'])
        self.assertEqual({r['name'] for r in report['checks']}, set(smoke.CHECKS))
        self.assertEqual(smoke.read(self.root / 'reports/agent-learning-smoke.json'), report)

    def test_stale_sources_or_missing_native_status_prevent_experiment(self):
        for mutation in ('hash', 'status', 'guard', 'tools', 'isolation'):
            def probe(runtime):
                result = self.probe(runtime)
                if runtime == 'game':
                    if mutation == 'hash': result['sourceHashes']['world/ops/cron_guard.py'] = 'old'
                    elif mutation == 'status': result['roles'][0]['statusCalled'] = False
                    elif mutation == 'guard': result['guardVerified'] = False
                    elif mutation == 'tools': result['roles'][0]['listedTools'] = 9
                    else: result['fixture']['roleIsolationRejections'] = 0
                return result
            with self.subTest(mutation=mutation):
                result = smoke.run(self.root, exercise_enabled=True, runtime_probe=probe,
                    exercise_fn=lambda *a: self.fail('Failed prerequisite must stop paid submission'))
                self.assertFalse(result['ok'])
                self.assertEqual(result['exercise']['code'], 'live_prerequisites_failed_no_submission')

    def test_native_call_parser_ignores_text_fences(self):
        self.assertEqual(smoke.trace_tools({'events': [{'event': {'type': 'text',
            'text': '```json {"type":"tool_use","name":"learning_activate"} ```'}}]}), [])
        result = smoke.trace_tools({'events': [{'event': {'content': [
            {'type': 'tool_use', 'name': 'learning_draft'}, {'type': 'plugin_call', 'name': 'qd_learning__learning_validate'},
            {'type': 'function_call', 'name': 'learning_activate'}]}}]})
        self.assertEqual(result, ['learning_draft', 'learning_validate', 'learning_activate'])

    def test_exercise_post_once_preserves_job_and_restart_never_reposts(self):
        original = deepcopy(self.job)
        result = smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertFalse(result['skillProduced']); self.assertFalse(result['ok'])
        self.assertEqual(result['nativeCronPostAttempts'], 1)
        self.assertEqual(self.job, original)
        smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertEqual(sum(post for _, post in self.requests), 1)

    def test_uncertain_post_is_not_retried_and_zero_calls_not_success(self):
        def failed(route, *a, **kwargs):
            if kwargs.get('post'):
                self.requests.append((route, True)); raise TimeoutError('reply lost')
            return self.get(route, *a, **kwargs)
        result = smoke.exercise(self.root, failed, clock=lambda: self.clock, wait_seconds=0)
        self.assertEqual(result['submission'], 'submission_uncertain')
        self.assertEqual(result['usageDelta']['call_count'], 0)
        smoke.exercise(self.root, failed, clock=lambda: self.clock, wait_seconds=0)
        self.assertEqual(sum(post for _, post in self.requests), 1)

    def test_disabled_user_weekly_choice_is_not_overridden(self):
        self.job['enabled'] = False
        with self.assertRaisesRegex(ValueError, 'disabled_preserved'):
            smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertFalse(any(post for _, post in self.requests))
        self.assertFalse((self.root / 'runtime/agent-learning-smoke/exercise.json').exists())

    def test_guard_no_evidence_skip_is_honest_no_skill_result(self):
        result = smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        folder = self.root / smoke.WORK / 'workspaces' / smoke.ROLE / 'learning'
        smoke.save(folder / 'last-cron.json', {'jobId': smoke.JOB, 'checkedAt': self.clock,
            'status': 'skipped', 'code': 'no_new_learning_evidence'})
        result = smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertTrue(result['terminal']); self.assertEqual(result['guardCode'], 'no_new_learning_evidence')
        self.assertFalse(result['skillProduced']); self.assertFalse(result['sharedBudgetReserved'])

    def test_only_trace_budget_and_owned_enabled_artifact_together_prove_new_workflow(self):
        from agent_learning import LearningTools, TOOL_NAMES, write
        from test_agent_learning import Service
        from test_role_learning_profiles import learning_fixture, native_fixture_lock
        import native_role_capabilities
        native = patch.object(native_role_capabilities, 'native_lock', return_value=native_fixture_lock())
        native.start(); self.addCleanup(native.stop)
        smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        state = self.root / smoke.WORK; folder = state / 'workspaces' / smoke.ROLE
        write(state / 'config.json', {'agents': {'profiles': {smoke.ROLE: {'enabled': True}}}})
        write(folder / 'agent.json', {'id': smoke.ROLE, 'mcp': {'clients': {'qd_learning': {'enabled': True, 'tools': list(TOOL_NAMES)}}}})
        learning_fixture(folder, smoke.ROLE, 'operations')
        tools = LearningTools(smoke.ROLE, 'operations', state, Service(folder), api=lambda *a: {'success': True})
        draft = tools.draft('qd-learned-freshness', 'Check available observation freshness before making claims',
            'Read the timestamp and exact observation. Reject expired evidence and distinguish current facts from old reports. Record missing timestamps as unknown and never fabricate a successful result.',
            ['learning_status'], [{'input': 'A new observation with a timestamp', 'expected': 'Report that exact observed fact only', 'kind': 'success'},
                {'input': 'An old observation with no current evidence', 'expected': 'Report unknown and request current evidence', 'kind': 'failure'}])
        tools.validate(draft['name'], draft['revision']); tools.activate(draft['name'], draft['revision'])
        write(folder / 'learning/last-cron.json', {'jobId': smoke.JOB, 'checkedAt': self.clock, 'status': 'finished', 'runId': 'budget-run'})
        write(self.root / 'server/operations-agent-state/operations-budget/delegations.json', [{'runId': 'budget-run',
            'source': 'native-qwen-cron', 'role': smoke.ROLE, 'jobId': smoke.JOB}])
        trace = {'run_id': 'trace-run', 'status': 'success', 'created_at': self.clock, 'meta': {'job_id': smoke.JOB},
            'events': [{'event': {'content': [{'type': 'tool_use', 'name': name} for name in
                ('learning_draft', 'learning_validate', 'learning_activate')]}}]}
        write(state / 'inbox_traces/trace-run.json', trace)
        self.usage['call_count'] += 3
        result = smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertTrue(result['ok']); self.assertTrue(result['skillProduced'])
        self.assertFalse(result['skillArtifacts'][0]['behaviorVerified'])
        trace['events'] = []; write(state / 'inbox_traces/trace-run.json', trace)
        result = smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertFalse(result['ok']); self.assertFalse(result['skillProduced'])
        manifest = smoke.read(folder / 'skill.json')
        manifest['skills']['freshness-review'] = {'source': 'agent', 'enabled': True, 'channels': ['all']}
        write(folder / 'skill.json', manifest)
        native_path = folder / 'skills/freshness-review/SKILL.md'; native_path.parent.mkdir(); native_path.write_text('Explicit native fixture skill content')
        trace['events'] = [{'event': {'content': [{'type': 'tool_use', 'name': 'materialize_skill'}]}}]
        write(state / 'inbox_traces/trace-run.json', trace)
        result = smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertTrue(result['ok']); self.assertTrue(result['skillProduced'])
        manifest['skills']['freshness-review']['source'] = 'customized'; write(folder / 'skill.json', manifest)
        result = smoke.exercise(self.root, self.get, clock=lambda: self.clock, wait_seconds=0)
        self.assertFalse(result['skillProduced'])

    def test_container_probe_only_calls_readonly_learning_status_and_no_live_schedule(self):
        tree = ast.parse(smoke.CONTAINER_PROBE)
        names = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
        calls = [n for n in names if isinstance(n.func, ast.Attribute) and n.func.attr == 'call_tool']
        self.assertEqual(len(calls), 1)
        self.assertEqual(ast.literal_eval(calls[0].args[0]), 'learning_status')
        self.assertNotIn("'/run'", smoke.CONTAINER_PROBE)
        self.assertIn('async with stdio_client', smoke.CONTAINER_PROBE)
        self.assertIn('TemporaryDirectory', smoke.CONTAINER_PROBE)


if __name__ == '__main__': unittest.main()
