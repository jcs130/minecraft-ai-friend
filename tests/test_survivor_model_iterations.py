"""Old migration cannot restore an artificial cap; fresh config is quota-off."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import set_survivor_model_iterations as retired


class ModelIterations(unittest.TestCase):
    def test_old_preview_and_execute_are_retired_without_io(self):
        for execute in (False, True):
            with self.subTest(execute=execute), self.assertRaisesRegex(ValueError, 'migration_retired'):
                retired.apply(execute=execute, call=lambda *_: self.fail('must not call an API'))

    def test_fresh_runtime_tune_and_verifier_agree_with_quota_off_policy(self):
        with patch.dict(sys.modules, {'mcp_server': SimpleNamespace(TOOL_NAMES=())}):
            spec = importlib.util.spec_from_file_location('init_runtime', ROOT / 'world/survival/init_runtime.py')
            init = importlib.util.module_from_spec(spec); spec.loader.exec_module(init)
        with patch.dict(sys.modules, {'init_runtime': init}):
            spec = importlib.util.spec_from_file_location('verify_iterations_fixture', ROOT / 'world/survival/verify_runtime.py')
            verify = importlib.util.module_from_spec(spec); spec.loader.exec_module(verify)
        value = SimpleNamespace(loop=SimpleNamespace(iteration=SimpleNamespace()),
            light_context_config=SimpleNamespace(visual_compact_config=SimpleNamespace()),
            auto_title_config=SimpleNamespace(),
            reme_light_memory_config=SimpleNamespace(auto_memory_search_config=SimpleNamespace()))
        init.tune(value); verify.verify_running(value)
        self.assertEqual(value.max_iters, 12)  # inactive legacy schema value
        self.assertEqual(value.llm_max_qpm, 0)
        self.assertIs(value.loop.iteration.enabled, False)
        self.assertIsNone(value.loop.iteration.max_iterations)
        value.loop.iteration.max_iterations = 6
        with self.assertRaises(AssertionError): verify.verify_running(value)


if __name__ == '__main__': unittest.main()
