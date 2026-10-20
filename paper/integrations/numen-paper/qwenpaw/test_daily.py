import asyncio
import json
import unittest
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

from qwenpaw.runtime.hooks import HookAction
from daily_profile import daily_profile
import test_native_game as native

game, CFG = native.game, native.CFG


class Daily(unittest.IsolatedAsyncioTestCase):
    setUp = native.NativeGame.setUp
    tearDown = native.NativeGame.tearDown
    context = native.NativeGame.context
    channel = native.NativeGame.channel

    def configure(self, enabled=True):
        cfg = dict(CFG, autonomy={"enabled": enabled})
        (self.workspace / "qiandengji.json").write_text(json.dumps(cfg), encoding="utf-8")
        return cfg

    def healthy(self):
        channel = self.channel()
        channel.invoke = AsyncMock(return_value={"content": [{"type": "text", "text":
            'MC_STATUS {"food":20,"health":20,"maxHealth":20}'}]})
        return channel

    async def test_healthy_opted_in_body_runs_one_native_daily_turn(self):
        self.configure()
        channel = self.healthy()
        self.assertTrue(await channel.heartbeat_once())
        channel.invoke.assert_awaited_once_with("command", {"line": "/mycli status"})
        payload = channel._enqueue.call_args.args[0]
        self.assertTrue(payload["meta"]["autonomous_daily"])
        self.assertIn("自行选择附近", payload["text"])
        self.assertIn("可以正常接单", payload["text"])
        self.assertFalse(await channel.heartbeat_once())
        channel._enqueue.assert_called_once()

    async def test_strings_and_numbers_do_not_grant_daily_permission(self):
        for value in (False, "true", 1, None):
            self.configure(value)
            channel = self.healthy()
            self.assertFalse(await channel.heartbeat_once())
            channel._enqueue.assert_not_called()

    async def test_live_config_pause_is_observed_without_reload(self):
        self.lane.cfg = self.configure()
        channel = self.healthy()
        self.configure(False)
        self.assertFalse(await channel.heartbeat_once())
        channel._enqueue.assert_not_called()

    async def test_disabled_or_rebound_identity_does_not_read_or_act(self):
        for change in ({"enabled": False}, {"session_id": "other-session"}):
            cfg = {**self.configure(), **change}
            (self.workspace / "qiandengji.json").write_text(json.dumps(cfg), encoding="utf-8")
            channel = self.healthy()
            self.assertFalse(await channel.heartbeat_once())
            channel.invoke.assert_not_awaited()
            channel._enqueue.assert_not_called()

    async def test_daily_does_not_overlap_busy_body_or_offline_connection(self):
        self.configure()
        channel = self.healthy()
        await self.lane.lock.acquire()
        self.assertFalse(await channel.heartbeat_once())
        self.lane.lock.release()
        channel._connected = False
        self.assertFalse(await channel.heartbeat_once())
        channel.invoke.assert_not_awaited()
        channel._enqueue.assert_not_called()

    async def test_paused_queued_daily_turn_never_enters_body(self):
        for change in ({}, {"enabled": False}):
            cfg = {**self.configure(False), **change}
            (self.workspace / "qiandengji.json").write_text(json.dumps(cfg), encoding="utf-8")
            ctx = self.context()
            ctx.request.channel_meta = {"heartbeat": True, "autonomous_daily": True}
            result = await game.GameEnter().run(ctx)
            self.assertEqual(result.action, HookAction.SHORT_CIRCUIT)
            self.assertFalse(self.lane.lock.locked())

    async def test_unknown_state_does_not_start_autonomous_actions(self):
        self.configure()
        channel = self.healthy()
        channel.invoke.return_value = {"content": [{"type": "text", "text": "unknown"}]}
        self.assertFalse(await channel.heartbeat_once())
        channel._enqueue.assert_not_called()

    async def test_profile_is_opt_in_and_preserves_model_tools_memory_and_limits(self):
        source = {"active_model": {"model": "unchanged"}, "running": {"llm_max_qpm": 12},
                  "tools": {"builtin_tools": {"shell": {"enabled": False}}},
                  "heartbeat": {"every": "10m", "timeoutSeconds": 300}}
        profile, binding = daily_profile(source, CFG)
        self.assertEqual(source["heartbeat"]["every"], "10m")
        self.assertNotIn("autonomy", CFG)
        self.assertEqual(profile["heartbeat"]["every"], "2m")
        self.assertEqual(profile["heartbeat"]["timeoutSeconds"], 300)
        self.assertEqual(profile["running"], source["running"])
        self.assertEqual(profile["tools"], source["tools"])
        self.assertEqual(profile["active_model"], source["active_model"])
        self.assertIs(binding["autonomy"]["enabled"], True)
        self.assertEqual(binding["companion_uuid"], CFG["companion_uuid"])

    async def test_profile_requires_explicit_boolean_and_enabled_existing_binding(self):
        for binding, enabled in ((CFG, "true"), ({**CFG, "enabled": False}, True)):
            with self.assertRaises(ValueError):daily_profile({}, binding, enabled=enabled)


if __name__ == "__main__":
    unittest.main()
