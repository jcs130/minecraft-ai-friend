"""Offline registration/sync safety: no provider, history, usage, or other role edits."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from copy import deepcopy

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('world_role_registration', ROOT / 'tools/register_world_agents.py')
registration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registration)


def profile():
    memory = {key: False for key in ('memory_search_enabled', 'dream_cron_enabled', 'daily_paper_cron_enabled',
              'auto_memory_inbox_push_enabled', 'auto_dream_inbox_push_enabled', 'daily_paper_inbox_push_enabled')}
    memory.update(auto_memory_interval=0, auto_memory_search_config={'enabled': False})
    return {'id': 'mc-herald', 'name': 'Herald', 'workspace_dir': '/state/work/workspaces/mc-herald',
            'active_model': {'provider_id': 'user-provider', 'model': 'user-current-model'},
            'running': {'max_iters': 4, 'max_input_length': 32768, 'llm_max_concurrent': 1, 'llm_max_qpm': 6,
                        'loop': {'iteration': {'enabled': True, 'max_iterations': 4}},
                        'light_context_config': {'strategy': 'native', 'visual_compact_config': {'enabled': False}},
                        'auto_title_config': {'enabled': False}, 'reme_light_memory_config': memory},
            'tools': {'builtin_tools': {'execute_shell_command': {'enabled': False}, 'read_file': {'enabled': False}}},
            'acp': {'agents': {'codex': {'enabled': False}}}, 'mcp': {'clients': {}},
            'heartbeat': {'enabled': False}, 'channels': {'console': {'enabled': True}, 'webhook': {'enabled': False}},
            'security': {'allow_no_auth_hosts': [], 'tool_guard': {'denied_tools': ['original-deny']}},
            'fallback_policy': {'enabled': False}, 'fallback_models': []}


class RegisterWorldAgents(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state, self.survivor, self.backups = [self.root / name for name in ('state', 'body', 'backups')]
        self.config = {'agents': {'active_agent': 'mc-god', 'agent_order': ['mc-god', 'mc-herald', 'qd-survivor'],
                      'profiles': {name: {'enabled': True} for name in ('mc-god', 'mc-herald', 'qd-survivor')}}}
        self.put(self.state / 'work/config.json', self.config)
        self.put(self.state / 'work/workspaces/mc-herald/agent.json', profile())
        self.put(self.state / 'work/workspaces/mc-god/agent.json', {'active_model': 'unchanged-god'})
        self.put(self.state / 'work/workspaces/qd-survivor/agent.json', {'active_model': 'unchanged-kirito'})
        self.put(self.state / 'work/token_usage.json', {'history': ['paid-calls-retained']})
        self.put(self.state / 'secret/providers/custom/user-provider.json', {'api_key': 'PRIVATE-FIXTURE-NOT-LIVE'})
        self.put(self.state / 'work/workspaces/mc-herald/sessions/old.json', {'history': 'unmodified'})
        self.put(self.survivor / 'control.json', {'enabled': False})
        self.put(self.survivor / 'controller.json', {'active': None})
        self.calls = []

    def put(self, path, value):
        registration.write(path, registration.encode(value))

    def run_stopped(self, args, **kwargs):
        self.calls.append(args)
        return SimpleNamespace(returncode=0, stdout='false\n')

    def invoke(self, **kwargs):
        return registration.register(self.state, backups=self.backups, survivor=self.survivor,
                                     run=self.run_stopped, **kwargs)

    def files(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_check_is_read_only_and_never_exposes_provider_data(self):
        before = self.files()
        result = self.invoke()
        self.assertEqual(result['createdRoles'], list(registration.WORLD_ROLES))
        self.assertEqual(self.files(), before)
        self.assertEqual(self.calls, [])
        self.assertNotIn('PRIVATE-FIXTURE', json.dumps(result))

    def test_first_apply_copies_only_model_choice_preserves_old_roles_and_usage(self):
        before = self.files()
        result = self.invoke(apply=True)
        after = self.files()
        for path, data in before.items():
            if path != 'state/work/config.json':
                self.assertEqual(after[path], data, path)
        self.assertEqual(len(self.calls), 2)
        for role in registration.WORLD_ROLES:
            folder = self.state / 'work/workspaces' / role
            agent = registration.validate_workspace(folder, role)
            self.assertEqual(agent['active_model'], profile()['active_model'])
            self.assertEqual(agent['running']['max_iters'], 1)
            self.assertEqual(agent['running']['max_input_length'], 12000)
            self.assertIsNone(agent['running']['loop']['iteration']['max_iterations'])
            self.assertFalse(agent['running']['loop']['iteration']['enabled'])
            self.assertEqual(agent['running']['llm_max_qpm'], 0)
            self.assertFalse((folder / 'sessions').exists())
        self.assertTrue(Path(result['backup']).is_dir())
        self.assertEqual(registration.read(self.state / 'work/config.json')['agents']['active_agent'], 'mc-god')

    def test_repeated_sync_preserves_user_model_history_and_is_idempotent(self):
        self.invoke(apply=True)
        folder = self.state / 'work/workspaces' / registration.WORLD_ROLES[0]
        agent = registration.read(folder / 'agent.json')
        agent['active_model'] = {'provider_id': 'later-user-choice', 'model': 'different-model'}
        self.put(folder / 'agent.json', agent)
        self.put(folder / 'sessions/keep.json', {'conversation': 'real-history'})
        before = self.files()
        result = self.invoke(apply=True)
        self.assertEqual(result['changedFiles'], 0)
        self.assertEqual(self.files(), before)

    def test_running_or_active_services_refuse_without_backups(self):
        before = self.files()
        with self.assertRaisesRegex(ValueError, 'must_be_stopped'):
            registration.register(self.state, backups=self.backups, survivor=self.survivor, apply=True,
                                  run=lambda *a, **k: SimpleNamespace(returncode=0, stdout='true'))
        self.assertEqual(self.files(), before)
        self.put(self.survivor / 'controller.json', {'active': {'taskId': 'active-task'}})
        before = self.files()
        with self.assertRaisesRegex(ValueError, 'paused_and_idle'):
            self.invoke(apply=True)
        self.assertEqual(self.files(), before)

    def test_unknown_roles_or_unowned_workspace_refuse_before_mutation(self):
        self.config['agents']['profiles']['unexpected'] = {'enabled': True}
        self.put(self.state / 'work/config.json', self.config)
        before = self.files()
        with self.assertRaisesRegex(ValueError, 'unexpected_game_roles'):
            self.invoke(apply=True)
        self.assertEqual(self.files(), before)
        del self.config['agents']['profiles']['unexpected']
        self.put(self.state / 'work/config.json', self.config)
        self.put(self.state / 'work/workspaces/qd-guild-planner/agent.json', {'id': 'somebody-else'})
        before = self.files()
        with self.assertRaisesRegex(ValueError, 'unowned_world_agent_workspace'):
            self.invoke(apply=True)
        self.assertEqual(self.files(), before)

    def test_sync_does_not_silently_delete_new_jobs_or_drivers(self):
        self.invoke(apply=True)
        folder = self.state / 'work/workspaces/qd-maid-dialogue'
        self.put(folder / 'jobs.json', {'jobs': [{'id': 'user-scheduled'}]})
        before = self.files()
        with self.assertRaisesRegex(ValueError, 'unexpected_driver_or_jobs'):
            self.invoke(apply=True)
        self.assertEqual(self.files(), before)

    def test_prompt_contract_matches_planner_schema_and_no_native_tools(self):
        planner = (ROOT / 'world/ops/qwenpaw-prompts/qd-guild-planner/AGENTS.md').read_text(encoding='utf-8')
        self.assertIn('"villager"', planner)
        self.assertIn('"emerald"', planner)
        self.assertIn('3至24', planner)
        self.assertIn('1至3', planner)
        maid = (ROOT / 'world/ops/qwenpaw-prompts/qd-maid-dialogue/AGENTS.md').read_text(encoding='utf-8')
        self.assertIn('不要执行或输出这些工具调用', maid)

    def test_health_rejects_added_routing_or_background_channel(self):
        from world_agent_profiles import closed_profile, validate_profile
        role = registration.WORLD_ROLES[0]
        original = closed_profile(profile(), role)
        for key, value in (
            ('llm_routing', {'enabled': True}),
            ('channels', {'console': {'enabled': True}, 'webhook': {'enabled': True}}),
            ('thinking_level', 'high'),
        ):
            changed = deepcopy(original)
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                validate_profile(changed, role)


if __name__ == '__main__':
    unittest.main()
