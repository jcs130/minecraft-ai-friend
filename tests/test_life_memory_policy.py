from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'world/ops'))
import life_memory_policy as life
from native_role_capabilities import NATIVE_TOOLS, configure_native, validate_native
from qwenpaw_health import check_role_memory


def profile(role='qd-survivor'):
    return {'id': role, 'name': 'Original character', 'workspace_dir': '/state/work/workspaces/' + role,
        'active_model': {'provider_id': 'unchanged-provider', 'model': 'unchanged-model'},
        'system_prompt_files': ['AGENTS.md', 'SOUL.md', 'PROFILE.md'], 'heartbeat': {'enabled': False},
        'identityExtension': {'generation': 7, 'bodyUuid': 'unchanged-body'},
        'running': {'memory_manager_backend': 'remelight', 'max_iters': 12, 'llm_max_qpm': 0,
            'llm_max_concurrent': 1, 'loop': {'iteration': {'enabled': False, 'max_iterations': None}},
            'light_context_config': {'strategy': 'native', 'visual_compact_config': {'enabled': False}},
            'auto_title_config': {'enabled': False},
            'reme_light_memory_config': {'auto_memory_interval': 0, 'memory_search_enabled': False,
                'dream_cron_enabled': False, 'dream_cron': '0 23 * * *',
                'daily_paper_cron_enabled': False, 'auto_memory_inbox_push_enabled': False,
                'auto_dream_inbox_push_enabled': False, 'daily_paper_inbox_push_enabled': False,
                'inbox_push_enabled': None, 'auto_memory_search_config': {'enabled': False, 'max_results': 2,
                    'futureNativeOption': 'preserved'},
                'embedding_model_config': {'model': 'existing-embedding', 'api_key': 'fixture-not-a-secret'},
                'reranker_config': {'enabled': False, 'model': 'existing-reranker'},
                'daily_dir': 'memory', 'digest_dir': 'digest', 'needs_reindex': False}},
        'security': {'tool_guard': {'denied_tools': ['MemorySearch', 'memory_search', 'Browser', 'OtherDenied']}}}


class LifeMemoryPolicyTests(unittest.TestCase):
    def setUp(self):
        self.scope = patch.object(life, 'party_roles', return_value={'qd-survivor', '5swvhK'})
        self.scope.start(); self.addCleanup(self.scope.stop)

    def test_exact_targets_receive_native_query_cadence_and_hourly_dream(self):
        for role in ('qd-survivor', '5swvhK'):
            original = profile(role); before = deepcopy(original)
            actual = life.apply_profile(original, role)
            self.assertEqual(original, before)
            self.assertTrue(life.validate_profile(actual, role))
            memory = actual['running']['reme_light_memory_config']
            self.assertEqual(memory['auto_memory_interval'], 5)
            self.assertEqual(memory['dream_cron'], '0 * * * *')
            self.assertEqual(memory['auto_memory_search_config']['max_results'], 3)
            self.assertEqual(memory['auto_memory_search_config']['futureNativeOption'], 'preserved')

    def test_model_embedding_reranker_identity_and_history_options_preserved(self):
        original = profile(); actual = life.apply_profile(original, 'qd-survivor')
        for field in ('id', 'name', 'workspace_dir', 'active_model', 'system_prompt_files', 'heartbeat', 'identityExtension'):
            self.assertEqual(actual[field], original[field])
        old = original['running']['reme_light_memory_config']; new = actual['running']['reme_light_memory_config']
        for field in old.keys() - set(life.MEMORY_VALUES) - {'auto_memory_search_config'}:
            self.assertEqual(old[field], new[field], field)

    def test_exact_permission_aliases_only(self):
        actual = life.apply_profile(profile(), 'qd-survivor')
        self.assertEqual(actual['security']['tool_guard']['denied_tools'], ['Browser', 'OtherDenied'])
        self.assertNotIn('tools', actual)

    def test_idempotent(self):
        actual = life.apply_profile(profile(), 'qd-survivor')
        self.assertEqual(life.apply_profile(actual, 'qd-survivor'), actual)

    def test_other_roles_and_operations_remain_identical(self):
        for role, runtime in (('mc-god', 'game'), ('qd-maid-dialogue', 'game'), ('2PZ2gA', 'game'),
                              ('qd-survivor', 'operations'), ('5swvhK', 'operations')):
            original = profile(role)
            self.assertEqual(life.apply_profile(original, role, runtime), original)
            self.assertFalse(life.validate_profile(original, role, runtime))

    def test_missing_binding_does_not_enable_by_familiar_name(self):
        with patch.object(life, 'party_roles', return_value=set()):
            original = profile()
            self.assertEqual(life.apply_profile(original, 'qd-survivor'), original)

    def test_mismatched_identity_or_workspace_rejected(self):
        for key, value in (('id', 'another-role'), ('workspace_dir', '/state/work/workspaces/default')):
            original = profile(); original[key] = value
            with self.assertRaisesRegex(ValueError, 'identity_mismatch'): life.apply_profile(original, 'qd-survivor')

    def test_non_remelight_backend_never_changed_to_new_backend(self):
        original = profile(); original['running']['memory_manager_backend'] = 'adbpg'
        with self.assertRaisesRegex(ValueError, 'backend_required'): life.apply_profile(original, 'qd-survivor')

    def test_all_enabled_policy_fields_are_strictly_validated(self):
        original = life.apply_profile(profile(), 'qd-survivor')
        mutations = {'auto_memory_interval': 6, 'memory_search_enabled': False,
            'dream_cron_enabled': False, 'dream_cron': '*/5 * * * *'}
        for field, value in mutations.items():
            changed = deepcopy(original); changed['running']['reme_light_memory_config'][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError): life.validate_profile(changed, 'qd-survivor')
        for field, value in (('max_results', True), ('max_results', 2), ('enabled', False)):
            changed = deepcopy(original)
            changed['running']['reme_light_memory_config']['auto_memory_search_config'][field] = value
            with self.assertRaises(AssertionError): life.validate_profile(changed, 'qd-survivor')

    def test_reintroduced_native_deny_fails_validation(self):
        for name in life.MEMORY_TOOLS:
            changed = life.apply_profile(profile(), 'qd-survivor')
            changed['security']['tool_guard']['denied_tools'].append(name)
            with self.assertRaisesRegex(AssertionError, 'tool_denied'): life.validate_profile(changed, 'qd-survivor')

    def test_learning_sync_keeps_dynamic_permission_without_inventing_builtin(self):
        actual = configure_native(life.apply_profile(profile(), 'qd-survivor'), 'qd-survivor')
        validate_native(actual, 'qd-survivor')
        self.assertTrue(life.validate_profile(actual, 'qd-survivor'))
        enabled = {name for name, row in actual['tools']['builtin_tools'].items() if row['enabled']}
        self.assertEqual(enabled, set(NATIVE_TOOLS))
        self.assertFalse(set(actual['tools']['builtin_tools']) & life.MEMORY_TOOLS)
        self.assertEqual(configure_native(actual, 'qd-survivor'), actual)

    def test_disabled_memory_and_operations_dont_open_aliases(self):
        original = configure_native(profile(), 'qd-survivor')
        self.assertTrue(life.MEMORY_TOOLS <= set(original['security']['tool_guard']['denied_tools']))
        existing = profile(); existing['running']['reme_light_memory_config']['memory_search_enabled'] = True
        actual = configure_native(existing, 'qd-survivor', runtime='operations')
        self.assertTrue(life.MEMORY_TOOLS <= set(actual['security']['tool_guard']['denied_tools']))

    def test_selected_health_accepts_policy_and_rejects_unrelated_features(self):
        actual = life.apply_profile(profile(), 'qd-survivor')
        check_role_memory(actual, 'qd-survivor')
        actual['running']['reme_light_memory_config']['daily_paper_cron_enabled'] = True
        with self.assertRaises(AssertionError): check_role_memory(actual, 'qd-survivor')

    def test_non_selected_health_retains_quiet_assertions(self):
        actual = profile('2PZ2gA'); check_role_memory(actual, '2PZ2gA')
        actual['running']['reme_light_memory_config']['dream_cron_enabled'] = True
        with self.assertRaises(AssertionError): check_role_memory(actual, '2PZ2gA')


if __name__ == '__main__': unittest.main()
