"""One-field native configuration and queue wait tests; no model or world I/O."""
import asyncio
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import configure_survivor_queue_wait as config


class QueueWaitConfiguration(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = self.root / 'server/survival-agent-state/survival'
        self.state.mkdir(parents=True)
        self.save('control.json', {'enabled': False})
        self.save('controller.json', {'active': None})
        self.save('lease.json', {'status': 'closed'})
        self.profile = {'id': config.ROLE, 'name': '桐人',
            'running': {'llm_acquire_timeout': 30.0, 'llm_max_qpm': 0, 'llm_max_concurrent': 1,
                        'loop': {'iteration': {'enabled': False}}, 'other': {'keep': True}},
            'active_model': {'provider_id': 'unchanged', 'model': 'unchanged'},
            'mcp': {'clients': {'keep': {'token': 'masked-value-must-not-be-written'}}},
            'unknown_native_field': ['retain']}
        self.original = deepcopy(self.profile)
        self.jobs = [{'id': config.JOB_ID, 'enabled': False, 'original': 'keep'},
                     {'id': 'original-memory-job', 'enabled': False}]
        self.original_jobs = deepcopy(self.jobs)
        self.count = 0
        self.calls = []

    def save(self, name, value):
        (self.state / name).write_text(json.dumps(value), encoding='utf8')

    def api(self, method, route, role, body=None):
        self.assertEqual(role, config.ROLE)
        self.calls.append((method, route, deepcopy(body)))
        if route == config.ROUTE:
            if method == 'PUT':
                self.assertEqual(set(body), {'id', 'name', 'running'})
                self.assertEqual((body['id'], body['name']), (config.ROLE, self.original['name']))
                self.profile.update(deepcopy(body))
            else:
                self.assertEqual(method, 'GET')
            return deepcopy(self.profile)
        self.assertEqual(method, 'GET')
        if route == config.ROUTE + '/agent-status':
            return {'running_task_count': self.count}
        self.assertEqual(route, '/cron/jobs')
        return deepcopy(self.jobs)

    def run_config(self, **kwargs):
        return config.configure(root=self.root, call=self.api, **kwargs)

    def test_default_preview_does_not_write_or_require_pausing(self):
        self.count = 1
        self.save('control.json', {'enabled': True})
        result = self.run_config()
        self.assertEqual((result['mode'], result['before'], result['after']), ('preview', 30, 120))
        self.assertTrue(result['changed'])
        self.assertFalse(result['applied'])
        self.assertEqual(self.calls, [('GET', config.ROUTE, None)])
        self.assertFalse((self.root / 'runtime').exists())
        self.assertEqual(self.profile, self.original)

    def test_plan_only_changes_wait_deeply_and_rejects_foreign_or_unexpected_values(self):
        expected = deepcopy(self.original)
        expected['running']['llm_acquire_timeout'] = 120
        self.assertEqual(config.planned_profile(self.profile), expected)
        self.assertEqual(self.profile, self.original)
        self.assertEqual(config.planned_profile(expected), expected)
        for value in (None, True, '30', 0, 60, 300, float('nan')):
            bad = deepcopy(self.profile); bad['running']['llm_acquire_timeout'] = value
            with self.subTest(value=value), self.assertRaises(ValueError): config.planned_profile(bad)
        bad = deepcopy(self.profile); bad['id'] = '5swvhK'
        with self.assertRaises(ValueError): config.planned_profile(bad)

    def test_apply_verifies_full_profile_and_original_cron_and_repeat_is_no_write(self):
        result = self.run_config(apply=True)
        expected = config.planned_profile(self.original)
        self.assertEqual(self.profile, expected)
        self.assertEqual(self.jobs, self.original_jobs)
        self.assertTrue(result['applied'])
        backup = Path(result['backup'])
        self.assertTrue(backup.is_relative_to(self.root / 'runtime/survivor-queue-wait'))
        self.assertEqual(json.loads((backup / 'profile-before.json').read_text(encoding='utf8')), self.original)
        self.assertEqual(json.loads((backup / 'profile-after.json').read_text(encoding='utf8')), expected)
        self.assertEqual(json.loads((backup / 'journal.json').read_text())['stage'], 'verified')
        self.assertEqual(sum(method != 'GET' for method, _, _ in self.calls), 1)
        prior = sorted(p.relative_to(self.root) for p in self.root.rglob('*'))
        self.calls.clear()
        repeat = self.run_config(apply=True)
        self.assertFalse(repeat['changed'])
        self.assertEqual(self.calls, [('GET', config.ROUTE, None)])
        self.assertEqual(sorted(p.relative_to(self.root) for p in self.root.rglob('*')), prior)

    def test_apply_rejects_non_idle_or_unpaused_without_writes(self):
        cases = [('control.json', {'enabled': True}), ('controller.json', {'active': {'taskId': 'old'}}),
                 ('lease.json', {'status': 'active'}), ('inflight-action.json', {'turnId': 'old'})]
        for name, value in cases:
            path = self.state / name
            old = path.read_bytes() if path.exists() else None
            self.save(name, value)
            with self.subTest(name=name), self.assertRaises(ValueError): self.run_config(apply=True)
            if old is None: path.unlink()
            else: path.write_bytes(old)
        self.count = 1
        with self.assertRaises(ValueError): self.run_config(apply=True)
        self.count = 0
        self.jobs[0]['enabled'] = True
        with self.assertRaises(ValueError): self.run_config(apply=True)
        self.jobs = []
        with self.assertRaises(ValueError): self.run_config(apply=True)
        self.assertFalse((self.root / 'runtime').exists())
        self.assertTrue(all(method == 'GET' for method, _, _ in self.calls))

    def test_concurrent_change_is_not_overwritten(self):
        original_api = self.api
        reads = 0
        def concurrent(method, route, role, body=None):
            nonlocal reads
            if method == 'GET' and route == config.ROUTE:
                reads += 1
                if reads == 2: self.profile['active_model']['model'] = 'user-changed'
            return original_api(method, route, role, body)
        with self.assertRaisesRegex(ValueError, 'concurrent_'):
            config.configure(apply=True, call=concurrent, root=self.root)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.calls))
        self.assertEqual(self.profile['active_model']['model'], 'user-changed')

    def test_uncertain_put_is_not_retried_or_rolled_back(self):
        original_api = self.api
        def uncertain(method, route, role, body=None):
            result = original_api(method, route, role, body)
            if method == 'PUT': raise TimeoutError('response lost after the one write')
            return result
        with self.assertRaises(TimeoutError):
            config.configure(apply=True, call=uncertain, root=self.root)
        self.assertEqual(sum(method == 'PUT' for method, _, _ in self.calls), 1)
        self.assertEqual(self.profile, config.planned_profile(self.original))
        journal = json.loads(next((self.root / 'runtime').rglob('journal.json')).read_text())
        self.assertEqual((journal['stage'], journal['failedAt']), ('failed_or_uncertain', 'native_put_started'))
        self.assertFalse(journal['retryAutomatically'])

    def test_unrelated_readback_change_is_not_reported_as_success(self):
        original_api = self.api
        def changed(method, route, role, body=None):
            result = original_api(method, route, role, body)
            if method == 'PUT': self.profile['unknown_native_field'] = ['changed']
            return result
        with self.assertRaisesRegex(ValueError, 'readback_mismatch'):
            config.configure(apply=True, call=changed, root=self.root)
        self.assertEqual(sum(method == 'PUT' for method, _, _ in self.calls), 1)
        self.assertFalse(list((self.root / 'runtime').rglob('receipt.json')))


@unittest.skipUnless(importlib.util.find_spec('qwenpaw'), 'native Qwen image required')
class NativeQueueWait(unittest.IsolatedAsyncioTestCase):
    async def test_native_schema_and_real_wrapper_wait_before_one_provider_call(self):
        from qwenpaw.config.config import AgentsRunningConfig
        from qwenpaw.providers.rate_limiter import LLMRateLimiter
        from qwenpaw.providers.retry_chat_model import RetryChatModel, RateLimitConfig, RetryConfig
        running = AgentsRunningConfig(llm_acquire_timeout=120, llm_max_qpm=0, llm_max_concurrent=1)
        roundtrip = AgentsRunningConfig.model_validate_json(running.model_dump_json())
        self.assertEqual((roundtrip.llm_acquire_timeout, roundtrip.llm_max_qpm), (120, 0))
        inner = AsyncMock(model='isolated-fixture', stream=False, parameters=None,
                          credential=None, context_size=32768, formatter=None)
        inner.return_value = {'fixture': 'accepted-once'}
        model = RetryChatModel(inner, RetryConfig(enabled=False), RateLimitConfig(
            max_concurrent=1, max_qpm=0, acquire_timeout=roundtrip.llm_acquire_timeout))
        limiter = LLMRateLimiter(max_concurrent=1, max_qpm=0)
        limiter._acquire_qpm_slot = AsyncMock(side_effect=AssertionError('QPM must remain off'))
        await limiter.acquire()
        started = asyncio.Event()
        real_wait_for = asyncio.wait_for
        async def short_wait(awaitable, timeout):
            self.assertEqual(timeout, 120)
            started.set()
            return await real_wait_for(awaitable, timeout=.5)
        with patch('qwenpaw.providers.retry_chat_model.get_rate_limiter', AsyncMock(return_value=limiter)), \
             patch('qwenpaw.providers.retry_chat_model.asyncio.wait_for', short_wait):
            task = asyncio.create_task(model('fixture'))
            await started.wait()
            inner.assert_not_awaited()
            limiter.release()
            self.assertEqual(await task, {'fixture': 'accepted-once'})
        inner.assert_awaited_once()
        self.assertEqual(limiter.stats()['current_in_flight'], 0)
        limiter._acquire_qpm_slot.assert_not_awaited()


if __name__ == '__main__': unittest.main()
