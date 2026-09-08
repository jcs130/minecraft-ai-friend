"""Quota-off proof against the installed native framework; zero model calls."""
import asyncio
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import llm_runtime_policy as policy


class PolicyContract(unittest.TestCase):
    def test_only_qpm_and_iteration_gate_change_and_roundtrip_without_infinity(self):
        before = {'max_iters': 12, 'llm_max_qpm': 8, 'llm_max_concurrent': 1,
                  'loop': {'iteration': {'enabled': True, 'max_iterations': 12}, 'other': 'keep'},
                  'llm_retry_enabled': False, 'current_user_choice': {'keep': True}}
        snapshot = deepcopy(before)
        after = policy.unrestricted_running(before)
        policy.validate_running(after)
        expected = deepcopy(snapshot)
        expected['llm_max_qpm'] = 0
        expected['loop']['iteration'] = {'enabled': False, 'max_iterations': None}
        self.assertEqual(after, expected)
        self.assertEqual(before, snapshot)
        self.assertEqual(json.loads(json.dumps(after, allow_nan=False)), after)
        self.assertEqual(policy.unrestricted_running(after), after)
        legacy = deepcopy(before); legacy['llm_max_concurrent'] = 10
        self.assertEqual(policy.unrestricted_running(legacy), after)
        for key, value in [('llm_max_qpm', 4), ('llm_max_concurrent', 2), ('max_iters', None)]:
            changed = deepcopy(after); changed[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError): policy.validate_running(changed)

    def test_temporary_internal_limit_is_restored_even_on_exception(self):
        class Config:
            max_iters = 12
            def model_copy(self, update): return NS(**update)
        obj = NS(react_config=Config(), _agent_config=NS(running=NS(loop=NS(iteration=NS(enabled=False)))))
        original = obj.react_config
        def fail(agent, final):
            self.assertEqual(agent.react_config.max_iters, float('inf'))
            raise RuntimeError('fixture')
        with self.assertRaises(RuntimeError): policy.wrap_next_action(fail)(obj)
        self.assertIs(obj.react_config, original)


@unittest.skipUnless(importlib.util.find_spec('qwenpaw'), 'native Qwen image/venv required')
class NativePolicy(unittest.IsolatedAsyncioTestCase):
    def fixture(self, *, enabled=False, iteration=1000000, awaiting=False, structured=False):
        from agentscope.agent import Agent, ReActConfig
        state = NS(cur_iter=iteration, session_id='qa-session', reply_id='qa-reply',
                   reply_context=NS(structured_schema={} if structured else None, structured_output=None),
                   get_awaiting_tool_calls=lambda _: ['pending'] if awaiting else [])
        obj = NS(name='isolated-native-fixture', state=state, react_config=ReActConfig(max_iters=12),
                 _get_last_msg=lambda: None,
                 _agent_config=NS(running=NS(loop=NS(iteration=NS(enabled=enabled)))))
        return obj, Agent._next_action

    async def test_real_native_disabled_exceeds_legacy_max_and_keeps_final_and_hitl(self):
        from agentscope.message import Msg, TextBlock
        obj, native = self.fixture()
        # Native base alone still caps even though Qwen's own gate is disabled.
        self.assertEqual(type(native(obj)).__name__, 'Exit')
        original = obj.react_config
        result = policy.wrap_next_action(native)(obj)
        self.assertEqual(type(result).__name__, 'Reasoning')
        self.assertIsNone(result.tool_choice)
        self.assertIs(obj.react_config, original)
        self.assertEqual(obj.state.cur_iter, 1000000)
        final = Msg(name=obj.name, role='assistant', content=[TextBlock(text='Done')])
        result = policy.wrap_next_action(native)(obj, final)
        self.assertEqual(type(result).__name__, 'Exit')
        self.assertIs(result.exit_msg, final)
        self.assertEqual(result.exit_events[-1].finished_reason, 'completed')
        waiting, native = self.fixture(awaiting=True)
        result = policy.wrap_next_action(native)(waiting)
        self.assertEqual(type(result).__name__, 'Exit')
        self.assertIsNone(result.exit_events)  # permission wait is not bypassed
        limited, native = self.fixture(enabled=True)
        self.assertEqual(type(policy.wrap_next_action(native)(limited)).__name__, 'Exit')
        structured, native = self.fixture(structured=True)
        self.assertEqual(type(policy.wrap_next_action(native)(structured)).__name__, 'Reasoning')

    async def test_native_qpm_zero_keeps_concurrency_and_provider_pause(self):
        from qwenpaw.providers.rate_limiter import LLMRateLimiter
        limiter = LLMRateLimiter(max_concurrent=1, max_qpm=0, jitter_range=0)
        limiter._acquire_qpm_slot = AsyncMock(side_effect=AssertionError('QPM should be off'))
        await limiter.acquire()
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(limiter.acquire(), .01)
        limiter.release()
        await limiter.acquire(); limiter.release()
        limiter._pause_until = __import__('time').monotonic() + 1
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(limiter.acquire(), .01)
        self.assertEqual(limiter._acquire_qpm_slot.await_count, 0)

    async def test_installed_schema_switch_and_process_hook_are_exact_and_idempotent(self):
        from qwenpaw.config.config import AgentsRunningConfig
        from qwenpaw.agents.react_agent import QwenPawAgent
        from agentscope.agent import Agent
        running = AgentsRunningConfig(llm_max_concurrent=1)
        policy.disable_limits(running); policy.validate_running(running)
        encoded = running.model_dump_json()
        self.assertNotIn('Infinity', encoded)
        self.assertIsNone(AgentsRunningConfig.model_validate_json(encoded).loop.iteration.max_iterations)
        original = QwenPawAgent._next_action
        marker = getattr(QwenPawAgent, '_qiandeng_llm_policy', None)
        try:
            self.assertEqual(policy.install('game'), 1)
            wrapped = QwenPawAgent._next_action
            self.assertEqual(policy.install('game'), 1)
            self.assertIs(QwenPawAgent._next_action, wrapped)
            self.assertIs(wrapped.__wrapped__, Agent._next_action)
        finally:
            QwenPawAgent._next_action = original
            if marker is None: delattr(QwenPawAgent, '_qiandeng_llm_policy')
            else: QwenPawAgent._qiandeng_llm_policy = marker


if __name__ == '__main__': unittest.main()
