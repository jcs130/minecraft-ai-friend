"""Native channel preflight consumes real protocol families without starting a model."""
import json
import unittest
from unittest.mock import AsyncMock
import test_native_game as native
import test_daily as daily

game = native.game


class StatusParser(unittest.TestCase):
    def test_both_protocol_families_keep_real_vitals(self):
        for prefix in ("MC_STATUS", "MC_RPG"):
            data = {"health": 16.5, "maxHealth": 35, "food": 18, "mana": 12}
            self.assertEqual(game.heartbeat_status(prefix + " " + json.dumps(data)), data)

    def test_action_receipt_is_not_a_status(self):
        self.assertIsNone(game.heartbeat_status('MC_RPG {"success":true,"saved":true}'))
        self.assertIsNone(game.heartbeat_status('MC_AUTH_DENIED {"authorized":false}'))
        self.assertIsNone(game.heartbeat_status('[RPG] 生命20，魔力未知'))

    def test_unknown_and_invalid_vitals_never_wake_a_body(self):
        for change in ({"health": None}, {"food": True}, {"health": float("nan")}, {"maxHealth": 0},
                       {"health": 21}, {"food": -1}, {"food": 21}, {"success": False}):
            self.assertIsNone(game.heartbeat_status("MC_RPG " + json.dumps({"health": 20, "maxHealth": 20, "food": 20, **change})))

    def test_selects_status_after_an_unrelated_receipt(self):
        data = {"health": 0, "maxHealth": 30, "food": 6, "downed": True}
        self.assertEqual(game.heartbeat_status('MC_RPG {"success":true}\nMC_STATUS ' + json.dumps(data)), data)


class RpgHeartbeat(unittest.IsolatedAsyncioTestCase):
    setUp = native.NativeGame.setUp
    tearDown = native.NativeGame.tearDown
    channel = native.NativeGame.channel
    configure = daily.Daily.configure

    async def test_native_rpg_daily_reads_explicit_json_then_queues_one_existing_turn(self):
        self.configure()
        channel = self.channel()
        async def invoke(name, args):
            raw = ('MC_RPG {"class":"knight","food":20,"health":35,"maxHealth":35,"mana":28}'
                   if args["line"] == "/mycli status --json" else '[任务] 林道警戒：实际击杀蜘蛛0/3。')
            return {"content": [{"type": "text", "text": raw}]}
        channel.invoke = AsyncMock(side_effect=invoke)
        self.assertTrue(await channel.heartbeat_once())
        self.assertEqual(channel.invoke.await_args_list[0].args[1]["line"], "/mycli status --json")
        channel._enqueue.assert_called_once()
        self.assertIn("35/35", channel._enqueue.call_args.args[0]["text"])
        self.assertNotIn("MC_RPG", channel._enqueue.call_args.args[0]["text"])

    async def test_legacy_native_supports_the_same_owned_channel(self):
        self.configure()
        channel = self.channel()
        channel.invoke = AsyncMock(return_value={"content": [{"type": "text", "text": 'MC_STATUS {"food":20,"health":20,"maxHealth":20}'}]})
        self.assertFalse(await channel.heartbeat_once())  # invalid task receipt does not wake a model
        channel._enqueue.assert_not_called()

    async def test_old_native_schema_without_vitals_waits_instead_of_guessing(self):
        self.configure()
        channel = self.channel()
        channel.invoke = AsyncMock(return_value={"content": [{"type": "text", "text": 'MC_RPG {"class":"knight","level":5}'}]})
        self.assertFalse(await channel.heartbeat_once())
        channel._enqueue.assert_not_called()
        self.assertEqual(channel.invoke.await_count, 1)
