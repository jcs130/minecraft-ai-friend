"""Version migration keeps user model budgets while disabling new background work."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1]/'world/ops/upgrade_qwenpaw_runtime.py'
spec = importlib.util.spec_from_file_location('game_upgrade', SOURCE)
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class GameUpgrade(unittest.TestCase):
    def running(self):
        return {'max_iters': 4, 'max_input_length': 32768, 'llm_retry_enabled': True,
            'llm_max_retries': 3, 'llm_max_concurrent': 10, 'llm_max_qpm': 600,
            'llm_acquire_timeout': 300, 'loop': {'iteration': {'enabled': True}},
            'light_context_config': {'strategy': 'scroll', 'visual_compact_config': {'enabled': True}},
            'auto_title_config': {'enabled': True}, 'reme_light_memory_config': {
                'memory_search_enabled': True, 'dream_cron_enabled': True, 'daily_paper_cron_enabled': True,
                'auto_memory_inbox_push_enabled': True, 'auto_dream_inbox_push_enabled': True,
                'daily_paper_inbox_push_enabled': True, 'auto_memory_interval': 5,
                'auto_memory_search_config': {'enabled': True}}}

    def test_new_schema_defaults_never_replace_user_models_limits_or_unknown_fields(self):
        original = {'active_model': {'provider_id': 'user-provider', 'model': 'user-model'},
                    'running': {'max_iters': 4, 'llm_max_qpm': 12, 'future_option': [1, 2]},
                    'identity_extension': {'personal': True}}
        saved = deepcopy(original)
        merged = upgrade.defaults_under(original, {'active_model': {'model': 'default-model'},
            'running': {'max_iters': 100, 'llm_max_qpm': 600, 'loop': {'iteration': {'enabled': True}}}})
        self.assertEqual(merged['active_model'], original['active_model'])
        self.assertEqual(merged['running']['llm_max_qpm'], 12)
        self.assertEqual(merged['identity_extension'], {'personal': True})
        self.assertEqual(merged['running']['future_option'], [1, 2])
        merged['running']['future_option'].append(3)
        self.assertEqual(original, saved)

    def test_new_helpers_are_closed_without_tightening_or_loosening_existing_generation_limits(self):
        running = self.running()
        original = deepcopy(running)
        upgrade.pause_background(running)
        upgrade.assert_quiet(running)
        for key in original:
            if key.startswith('llm_') or key in ('max_iters', 'max_input_length'):
                self.assertEqual(running[key], original[key], key)
        self.assertEqual(running['loop']['iteration']['max_iterations'], 4)
        upgraded = deepcopy(running)
        upgrade.pause_background(running)
        self.assertEqual(running, upgraded)

    def test_quiet_probe_rejects_regressed_background_or_iteration_behavior(self):
        for key in ('dream_cron_enabled', 'daily_paper_cron_enabled', 'memory_search_enabled'):
            running = self.running(); upgrade.pause_background(running)
            running['reme_light_memory_config'][key] = True
            with self.assertRaises(AssertionError):
                upgrade.assert_quiet(running)
        running = self.running(); upgrade.pause_background(running)
        running['loop']['iteration']['max_iterations'] = 100
        with self.assertRaises(AssertionError):
            upgrade.assert_quiet(running)

    def test_closed_surface_denies_new_builtin_and_acp_but_rejects_existing_mcp(self):
        value = {'mcp': {'clients': {}}, 'tools': {'builtin_tools': {
            'old_tool': {'enabled': False}, 'new_tool': {'enabled': True}}},
            'acp': {'agents': {'new_agent': {'enabled': True}}},
            'security': {'tool_guard': {'denied_tools': ['old_rule']}, 'allow_no_auth_hosts': []}}
        upgrade.closed_surface(value, {'old_tool', 'new_tool'})
        self.assertFalse(value['tools']['builtin_tools']['new_tool']['enabled'])
        self.assertFalse(value['acp']['agents']['new_agent']['enabled'])
        self.assertEqual(set(value['security']['tool_guard']['denied_tools']), {'old_rule', 'old_tool', 'new_tool'})
        value['mcp']['clients'] = {'user_tool': {'enabled': True}}
        before = deepcopy(value)
        with self.assertRaises(AssertionError):
            upgrade.closed_surface(value, {'new_tool'})
        self.assertEqual(value, before)


if __name__ == '__main__':
    unittest.main()
