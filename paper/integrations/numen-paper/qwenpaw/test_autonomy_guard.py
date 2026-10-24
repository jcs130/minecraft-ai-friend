"""Synthetic scheduling/receipt regressions; no live model or game actions."""
import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
import unittest
import test_daily as daily
import test_native_game as native

game = native.game
TASK = '【当前公会委托】蛛患 0/4\n下一步：持剑近战'


class Guard(unittest.IsolatedAsyncioTestCase):
    setUp = native.NativeGame.setUp
    tearDown = native.NativeGame.tearDown
    context = native.NativeGame.context

    def guard(self):
        self.clock = 1000
        return game.AutonomyGuard(self.workspace, native.BODY, now=lambda: self.clock)

    def test_same_objective_gets_two_turns_then_replan_and_bounded_backoff(self):
        guard = self.guard()
        self.assertEqual([guard.plan(TASK) for _ in range(3)], ['continue','continue','replan'])
        self.assertEqual(guard.plan(TASK), 'wait_progress')
        self.clock += 300
        self.assertEqual(guard.plan(TASK), 'replan')
        self.assertEqual(guard.state['next_at']-self.clock, 600)
        for _ in range(10):
            self.clock = guard.state['next_at']
            guard.plan(TASK)
        self.assertEqual(guard.state['next_at']-self.clock, 1800)

    def test_real_task_progress_wakes_immediately_during_progress_backoff(self):
        guard = self.guard()
        for _ in range(3):guard.plan(TASK)
        self.assertEqual(guard.plan(TASK.replace('0/4','1/4')), 'continue')
        self.assertEqual(guard.state['unchanged'], 1)

    def test_session_time_and_sequence_changes_do_not_fake_json_progress(self):
        a='MC_TASK '+json.dumps(dict(task='spider',progress=0,observedAt=1,sessionId='a',sequence=3))
        b='MC_TASK '+json.dumps(dict(task='spider',progress=0,observedAt=99,sessionId='b',sequence=4))
        self.assertEqual(game.AutonomyGuard.fingerprint(a),game.AutonomyGuard.fingerprint(b))
        self.assertNotEqual(game.AutonomyGuard.fingerprint(a),game.AutonomyGuard.fingerprint(b.replace('"progress": 0','"progress": 1')))

    def test_backoff_survives_plugin_reload_and_critical_survival_can_interrupt(self):
        guard = self.guard()
        for _ in range(3):guard.plan(TASK)
        restored = game.AutonomyGuard(self.workspace,native.BODY,now=lambda:self.clock)
        self.assertEqual(restored.plan(TASK),'wait_progress')
        self.assertEqual(restored.plan(TASK,critical=True),'replan')

    def test_quota_is_a_model_failure_and_never_progress_or_an_action_retry(self):
        guard = self.guard()
        guard.model_failed('Error: MODEL_QUOTA_EXCEEDED quota exceeded')
        self.assertFalse(guard.model_ready())
        self.assertEqual(guard.plan(TASK),'wait_model')
        self.assertEqual(guard.state['unchanged'],0)
        self.clock += 1800
        self.assertTrue(guard.model_ready())
        guard.model_failed('network error')
        self.assertEqual(guard.state['model_until']-self.clock,300)
        guard.model_succeeded()
        self.assertTrue(guard.model_ready())

    def test_corrupt_state_waits_instead_of_starting_an_unbounded_new_loop(self):
        (self.workspace/'game-autonomy-state.json').write_text('{broken')
        guard=self.guard()
        self.assertEqual(guard.plan(TASK),'wait_model')

    async def test_native_budget_caps_only_the_existing_game_agent_instance(self):
        ctx=self.context();ctx.extras['qiandengji_lane']=self.lane
        ctx.agent=NS(model=NS(context_size=1000000),react_config=NS(max_iters=12))
        other=NS(context_size=1000000)
        self.lane.autonomous_turn=True
        await game.ReviewBudget().run(ctx)
        self.assertEqual(ctx.agent.model.context_size,64000)
        self.assertEqual(ctx.agent.react_config.max_iters,6)
        self.assertEqual(other.context_size,1000000)

    async def test_repeated_paid_spell_is_not_executed_a_third_time_in_daily_turn(self):
        self.lane.autonomous_turn=True
        middleware=game.PublicTools(self.lane)
        call={'name':'kirito-world__command','input':json.dumps({'line':'/mycli cast sense'})}
        seen=[]
        async def handler():
            seen.append('executed')
            yield game.tool_result({'serverReceipt':'no target'})
        rows=[]
        for _ in range(3):
            rows=[item async for item in middleware.on_acting(None,{'tool_call':call},handler)]
        self.assertEqual(len(seen),2)
        self.assertIn('not_executed',game.texts(rows[0]))
        self.lane.autonomous_turn=False
        _=[item async for item in middleware.on_acting(None,{'tool_call':call},handler)]
        self.assertEqual(len(seen),3)

    async def test_real_native_usage_wrapper_keeps_the_same_effective_context_cap(self):
        from qwenpaw.token_usage.model_wrapper import TokenRecordingModelWrapper
        from qwenpaw.providers.retry_chat_model import RetryChatModel
        # No model calls: the real wrappers accept the same per-instance model
        # attributes as a provider, and must not retain the old million limit.
        inner=NS(context_size=1000000,model='isolated',stream=True)
        recorded=TokenRecordingModelWrapper('isolated',inner)
        wrapped=RetryChatModel(recorded)
        ctx=self.context();ctx.extras['qiandengji_lane']=self.lane
        ctx.agent=NS(model=wrapped,react_config=NS(max_iters=12))
        await game.ReviewBudget().run(ctx)
        self.assertEqual([m.context_size for m in [wrapped,recorded,inner]],[64000]*3)
        self.assertEqual(ctx.agent.react_config.max_iters,12)


class Channel(unittest.IsolatedAsyncioTestCase):
    setUp = native.NativeGame.setUp
    tearDown = native.NativeGame.tearDown
    channel = native.NativeGame.channel
    configure = daily.Daily.configure
    healthy = daily.Daily.healthy
    async def test_progress_backoff_keeps_reading_two_cheap_receipts_without_waking_model(self):
        self.configure();channel=self.healthy()
        for _ in range(3):
            self.assertTrue(await channel.heartbeat_once());channel._queued=0
        self.assertIn('无进展改计划',channel._enqueue.call_args.args[0]['text'])
        self.assertFalse(await channel.heartbeat_once())
        self.assertEqual(channel._enqueue.call_count,3)
        self.assertEqual(channel.invoke.await_count,8)

    async def test_model_failure_waits_without_preflight_or_model_and_operator_stays_available(self):
        self.configure();channel=self.healthy()
        await channel._on_consume_error(None,None,'MODEL_QUOTA_EXCEEDED')
        self.assertFalse(await channel.heartbeat_once())
        channel.invoke.assert_not_awaited()
        self.assertTrue(channel.enqueue_operator('服主明确要求重新检查'))


if __name__=='__main__':unittest.main()
