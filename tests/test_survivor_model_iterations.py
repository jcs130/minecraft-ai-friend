"""No network/model calls: native update payload and durable preservation checks."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import set_survivor_model_iterations as change


def running():
    return {'max_iters': 6, 'loop': {'iteration': {'enabled': True, 'max_iterations': 6}, 'other': 'keep'},
            'llm_max_qpm': 8, 'llm_max_concurrent': 1, 'llm_retry_enabled': False,
            'approval_level': 'AUTO', 'extra_current_setting': 240}


class ModelIterations(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        folder = self.root / 'server/survival-agent-state/survival'; folder.mkdir(parents=True)
        (folder / 'control.json').write_text(json.dumps({'enabled': False, 'dailyDecisionLimit': 96}))
        (folder / 'controller.json').write_text(json.dumps({'active': None, 'decisions': [{'historical': True}]}))
        self.running = running()
        self.profile = {'id': change.ROLE, 'name': 'Current name', 'active_model': {'model': 'current-choice'},
                        'running': deepcopy(self.running), 'untouched': 'keep'}
        self.calls = []

    def api(self, route, payload=None):
        self.calls.append((route, deepcopy(payload)))
        if route.endswith('/agent-status'): return {'running_task_count': 0}
        if route.startswith('/agents/'): return deepcopy(self.profile)
        self.assertEqual(route, change.ROUTE)
        if payload is not None:
            markers = list((self.root / 'runtime').glob('*.json'))
            self.assertEqual(len(markers), 1)
            self.assertEqual(json.loads(markers[0].read_text())['state'], 'unknown')
            self.running = deepcopy(payload); self.profile['running'] = deepcopy(payload)
        return deepcopy(self.running)

    def test_default_preview_and_exact_two_field_update_preserve_profile(self):
        self.assertFalse(change.apply(root=self.root, call=self.api)['executed'])
        self.assertFalse(any(payload is not None for _, payload in self.calls))
        result = change.apply(execute=True, root=self.root, call=self.api)
        self.assertTrue(result['executed'])
        expected = running(); expected['max_iters'] = expected['loop']['iteration']['max_iterations'] = 12
        self.assertEqual(self.running, expected)
        self.assertEqual(sum(payload is not None for _, payload in self.calls), 1)
        self.assertEqual(json.loads(Path(result['receipt']).read_text())['state'], 'verified')
        self.assertTrue(change.apply(execute=True, root=self.root, call=self.api)['alreadyConfigured'])
        self.assertEqual(sum(payload is not None for _, payload in self.calls), 1)

    def test_unknown_put_is_not_retried_and_keeps_receipt(self):
        writes = []
        def timeout(route, payload=None):
            if payload is not None:
                writes.append(payload); raise TimeoutError('fixture')
            return self.api(route)
        with self.assertRaises(TimeoutError): change.apply(execute=True, root=self.root, call=timeout)
        self.assertEqual(len(writes), 1)
        marker = next((self.root / 'runtime').glob('*.json'))
        self.assertEqual(json.loads(marker.read_text())['state'], 'unknown')
        with self.assertRaises(ValueError): change.apply(execute=True, root=self.root, call=timeout)
        self.assertEqual(len(writes), 1)

    def test_wrong_limits_or_active_controller_refuse_before_put(self):
        for key, value in (('max_iters', 4), ('llm_max_qpm', 4), ('llm_max_concurrent', 2)):
            data = running(); data[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): change.candidate(data)
        control = self.root / 'server/survival-agent-state/survival/control.json'
        control.write_text(json.dumps({'enabled': True}))
        with self.assertRaises(ValueError): change.apply(execute=True, root=self.root, call=self.api)
        self.assertEqual(self.calls, [])

    def test_fresh_runtime_tune_and_verifier_agree_with_shared_contract(self):
        # The legacy initializer is standalone /survival; load it without live MCP imports.
        from unittest.mock import patch
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
        self.assertEqual(value.max_iters, change.SURVIVOR_MAX_ITERS)
        self.assertEqual(value.llm_max_qpm, change.SURVIVOR_QPM)
        value.loop.iteration.max_iterations = 6
        with self.assertRaises(AssertionError): verify.verify_running(value)


if __name__ == '__main__': unittest.main()
