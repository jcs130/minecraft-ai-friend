"""Exercise the real pinned manager method offline with fake agent startups."""
import ast
import asyncio
import importlib.util
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('readiness_patch', ROOT/'world/ops/patch_qwenpaw_game.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
IMAGE = 'qiandengji-qwenpaw-game:2.2.0'


class ReadinessPatch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('docker'):
            raise unittest.SkipTest('Requires the local pinned game image')
        exists = subprocess.run(['docker', 'image', 'inspect', IMAGE], capture_output=True, timeout=10)
        if exists.returncode:
            raise unittest.SkipTest('Requires the local unpatched QwenPaw 2.2.0 image')
        probe = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python', IMAGE,
            '-c', "from pathlib import Path; import qwenpaw; print((Path(qwenpaw.__file__).parent/'app/multi_agent_manager.py').read_text(), end='')"],
            capture_output=True, text=True, encoding='utf-8', timeout=30)
        if probe.returncode:
            raise RuntimeError('Could not read the pinned public package source')
        cls.original = probe.stdout
        cls.patched = patch.patch_source(cls.original, '2.2.0')

    def run_startup(self, enabled, failures=(), callback_error=False, patched=True):
        # Compile only the actual method: no server/workspace/model is created.
        tree = ast.parse(self.patched if patched else self.original)
        manager = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'MultiAgentManager')
        method = next(n for n in manager.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'start_all_configured_agents')
        code = 'from __future__ import annotations\n' + ast.unparse(method)
        profiles = {aid: SimpleNamespace(enabled=active) for aid, active in enabled.items()}
        calls, warnings, started = [], [], []
        namespace = {'asyncio': asyncio,
            'load_config': lambda: SimpleNamespace(agents=SimpleNamespace(profiles=profiles)),
            'BUILTIN_QA_AGENT_ID': 'QwenPaw_QA_Agent_0.2',
            'AgentStartupStatus': SimpleNamespace(DISABLED='disabled', RUNNING='running', STARTING='starting', PENDING='pending'),
            'logger': SimpleNamespace(debug=lambda *a, **k: None, info=lambda *a, **k: None,
                                     error=lambda *a, **k: None, warning=lambda *a, **k: warnings.append(True))}
        exec(compile(code, 'actual-qwenpaw-startup-method', 'exec'), namespace)

        async def scenario():
            owner = SimpleNamespace(_lock=asyncio.Lock(), agents={}, _pending_starts={}, _agent_startup_statuses={})
            async def get_agent(aid):
                started.append(aid)
                if aid in failures:
                    raise RuntimeError('synthetic startup failure')
                owner.agents[aid] = object()
            async def schedule(aid):
                started.append(aid)
                if aid in failures:
                    return False
                owner.agents[aid] = object()
                return True
            owner.get_agent, owner.schedule_agent_startup = get_agent, schedule
            def ready(results):
                calls.append(dict(results))
                if callback_error:
                    raise RuntimeError('synthetic callback failure')
            results = await namespace['start_all_configured_agents'](owner, on_core_ready=ready)
            return results, calls, started, warnings
        return asyncio.run(scenario())

    def test_disabled_default_waits_for_both_real_game_roles(self):
        enabled = {'default': False, 'QwenPaw_QA_Agent_0.2': False, 'mc-god': True, 'mc-herald': True}
        original = self.run_startup(enabled, patched=False)
        self.assertEqual(original[1], [], 'Reproduce the upstream missing-ready callback')
        results, calls, started, _ = self.run_startup(enabled)
        self.assertEqual(results, {'mc-god': True, 'mc-herald': True})
        self.assertEqual(calls, [results])
        self.assertCountEqual(started, ['mc-god', 'mc-herald'])

    def test_one_failed_custom_agent_never_reports_ready(self):
        results, calls, _, _ = self.run_startup({'default': False, 'mc-god': True, 'mc-herald': True}, failures={'mc-herald'})
        self.assertFalse(results['mc-herald'])
        self.assertEqual(calls, [])

    def test_no_enabled_agents_never_reports_ready(self):
        results, calls, started, _ = self.run_startup({'default': False, 'mc-god': False})
        self.assertEqual((results, calls, started), ({}, [], []))

    def test_enabled_default_preserves_upstream_behavior_and_calls_only_once(self):
        for failures in ((), ('mc-herald',), ('default',)):
            with self.subTest(failures=failures):
                enabled = {'default': True, 'mc-god': True, 'mc-herald': True}
                before = self.run_startup(enabled, failures=failures, patched=False)
                after = self.run_startup(enabled, failures=failures)
                self.assertEqual(after, before)
                self.assertLessEqual(len(after[1]), 1)

    def test_callback_exception_is_contained_without_retry(self):
        results, calls, _, warnings = self.run_startup({'default': False, 'mc-god': True}, callback_error=True)
        self.assertEqual(calls, [results])
        self.assertEqual(len(warnings), 1)

    def test_patch_refuses_other_versions_changed_source_and_double_application(self):
        for source, version in ((self.original, '2.1.0'), (self.original + '\n', '2.2.0'), (self.patched, '2.2.0')):
            with self.subTest(version=version, length=len(source)), self.assertRaises(ValueError):
                patch.patch_source(source, version)


if __name__ == '__main__':
    unittest.main()
