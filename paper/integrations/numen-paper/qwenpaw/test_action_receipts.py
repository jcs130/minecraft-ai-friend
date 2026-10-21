"""Unattended consent and interrupted game actions must produce usable receipts."""
import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock

from mcp import types
from numen_controller import Controller, ACTION_TIMEOUT_SECONDS, action_key, lua_tokens


def text_result(text="done", error=False, **kwargs):
    return types.CallToolResult(content=[types.TextContent(type="text", text=text)], isError=error, **kwargs)


class ActionReceipts(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cfg = dict(upstream_url="http://localhost:8765/mcp", qwenpaw_url="http://localhost:8088",
                        companion_uuid="original-body", journal_dir=self.temp.name)
        self.c = Controller(self.cfg)
        self.c.session = NS(call_tool=AsyncMock(return_value=text_result()))
        self.ask = NS(message="ag_Kirito asks for your permission (#7): drop 1 bamboo",
                      requestedSchema={"properties": {"decision": {"enum": ["allow", "allow_and_remember", "deny"]}}})

    async def test_native_consent_is_denied_with_an_alternative_not_self_approved(self):
        answer = await self.c.unattended_consent(None, self.ask)
        self.assertEqual(answer.action, "accept")
        self.assertEqual(answer.content["decision"], "deny")
        self.assertIn("不要重复", answer.content["note"])
        self.assertIn("大背包", answer.content["note"])
        self.assertEqual(self.c.consent_denials, 1)

    async def test_unrecognised_consent_schema_is_declined(self):
        answer = await self.c.unattended_consent(None, NS(message="new form", requestedSchema={}))
        self.assertEqual(answer.action, "decline")
        self.assertIsNone(answer.content)

    async def test_url_elicitation_never_opens_an_approval_or_grants_access(self):
        answer = await self.c.unattended_consent(None, NS(message="visit", url="http://example.invalid/approve"))
        self.assertEqual(answer.action, "decline")

    async def test_permission_result_reaches_caller_and_repeat_does_not_reach_server(self):
        async def native(*args, **kwargs):
            answer = await self.c.unattended_consent(None, self.ask)
            return text_result("REFUSED: " + answer.content["note"], error=True)
        self.c.session.call_tool.side_effect = native
        first = await asyncio.wait_for(self.c.call("lua", {"code": "numen.inv.drop('bamboo')"}), 1)
        self.assertTrue(first.isError)
        self.assertIn("REFUSED", first.content[0].text)
        self.assertNotIn("结果未知", first.content[0].text)
        again = await self.c.call("lua", {"code": "numen.inv.drop('bamboo')"})
        self.assertFalse(again.structuredContent["thisCallDispatched"])
        self.assertEqual(again.structuredContent["reason"], "approval_required")
        self.assertEqual(self.c.session.call_tool.await_count, 1)

    async def test_unknown_transfer_is_not_replayed_after_a_status_read_or_reconnect(self):
        stock = [40]
        async def transfer_then_lost_receipt(*args, **kwargs):
            stock[0] -= 20
            raise TimeoutError()
        self.c.session.call_tool.side_effect = transfer_then_lost_receipt
        first = await self.c.call("lua", {"code": "transfer_twenty()"})
        self.assertIn("结果未知", first.content[0].text)
        self.assertIn("print(numen.task.status())", first.content[0].text)
        self.c.session.call_tool.side_effect = None
        await self.c.call("command", {"line": "/mycli inventory status"})
        again = await self.c.call("lua", {"code": "transfer_twenty()"})
        self.assertEqual(again.structuredContent["reason"], "unknown")
        self.assertIn("print(numen.task.status())", again.content[0].text)
        restarted = Controller(self.cfg)
        restarted.session = NS(call_tool=AsyncMock(return_value=text_result()))
        after_restart = await restarted.call("lua", {"code": "transfer_twenty()"})
        self.assertFalse(after_restart.structuredContent["thisCallDispatched"])
        self.assertEqual(restarted.session.call_tool.await_count, 0)
        self.assertEqual(stock[0], 20)

    async def test_cancellation_leaves_pending_receipt_so_restart_cannot_replay(self):
        reached_server = asyncio.Event()
        async def unfinished(*args, **kwargs):
            reached_server.set()
            await asyncio.Event().wait()
        self.c.session.call_tool.side_effect = unfinished
        call = asyncio.create_task(self.c.call("say", {"text": "hello"}))
        await reached_server.wait()
        call.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await call
        restarted = Controller(self.cfg)
        restarted.session = NS(call_tool=AsyncMock())
        result = await restarted.call("say", {"text": "hello"})
        self.assertEqual(result.structuredContent["reason"], "pending")
        self.assertEqual(restarted.session.call_tool.await_count, 0)

    async def test_heartbeat_read_can_recover_from_a_transient_disconnect(self):
        self.c.session.call_tool.side_effect = TimeoutError()
        await self.c.call("command", {"line": "/mycli status"})
        self.c.session.call_tool.side_effect = None
        result = await self.c.call("command", {"line": "/mycli status"})
        self.assertFalse(result.isError)
        self.assertEqual(self.c.session.call_tool.await_count, 2)

    async def test_confirmed_success_does_not_block_legitimate_later_actions(self):
        for _ in range(2):
            result = await self.c.call("lua", {"code": "walk_one_step()"})
            self.assertFalse(result.isError)
        self.assertEqual(self.c.session.call_tool.await_count, 2)
        self.assertEqual(Controller(self.cfg).action_receipts, {})

    async def test_actual_permission_denial_is_kept_without_a_callback(self):
        self.c.session.call_tool.return_value = text_result("failed(REFUSED): refused by the owner", error=True)
        await self.c.call("lua", {"code": "drop()"})
        again = await self.c.call("lua", {"code": "drop()"})
        self.assertEqual(again.structuredContent["reason"], "approval_required")
        self.assertEqual(self.c.session.call_tool.await_count, 1)

    async def test_incomplete_consumptive_command_receipt_stays_unknown(self):
        self.c.session.call_tool.return_value = text_result("[stdout cut at 6000 characters]")
        await self.c.call("command", {"line": "/mycli tasks claim"})
        again = await self.c.call("command", {"line": "/mycli tasks claim"})
        self.assertEqual(again.structuredContent["reason"], "unknown")
        self.assertEqual(self.c.session.call_tool.await_count, 1)

    async def test_a_different_permitted_action_can_continue_after_refusal(self):
        self.c.session.call_tool.return_value = text_result("REFUSED", error=True)
        await self.c.call("lua", {"code": "drop()"})
        self.c.session.call_tool.return_value = text_result("stored")
        result = await self.c.call("lua", {"code": "store()"})
        self.assertFalse(result.isError)
        self.assertEqual(self.c.session.call_tool.await_count, 2)

    async def test_transport_waits_long_enough_for_native_permission_result(self):
        await self.c.call("lua", {"code": "return 1"})
        duration = self.c.session.call_tool.call_args.kwargs["read_timeout_seconds"]
        self.assertEqual(duration.total_seconds(), ACTION_TIMEOUT_SECONDS)
        self.assertGreater(duration.total_seconds(), 120)

    async def test_replay_state_is_bound_to_the_original_body(self):
        self.c.session.call_tool.side_effect = TimeoutError()
        await self.c.call("lua", {"code": "drop()"})
        with self.assertRaises(ValueError):
            Controller({**self.cfg, "companion_uuid": "other-body"})

    async def test_full_receipt_store_does_not_discard_unknown_actions_to_execute_more(self):
        for i in range(128):
            self.c.action_receipts[f"{i:064x}"] = {"outcome": "unknown", "at": 1}
        result = await self.c.call("lua", {"code": "another_transfer()"})
        self.assertFalse(result.structuredContent["thisCallDispatched"])
        self.assertEqual(self.c.session.call_tool.await_count, 0)

    async def test_changing_comments_and_spacing_does_not_replay_a_timed_out_move(self):
        self.c.session.call_tool.side_effect = TimeoutError()
        await self.c.call("lua", {"code": '-- nearby\nlocal target={x=-473,y=67,z=-495}\nnumen.move.to(target)'})
        again = await self.c.call("lua", {"code": '-- at the chest\nlocal target = { x = -473, y = 67, z = -495 }\nnumen.move.to ( target )'})
        self.assertFalse(again.structuredContent["thisCallDispatched"])
        self.assertEqual(self.c.session.call_tool.await_count, 1)

    async def test_block_comments_do_not_hide_a_repeat(self):
        self.c.session.call_tool.side_effect = TimeoutError()
        await self.c.call("lua", {"code": 'drop(20)'})
        again = await self.c.call("lua", {"code": '--[=[ explain\n-- quoted ]=]\ndrop ( 20 )'})
        self.assertEqual(again.structuredContent["reason"], "unknown")
        self.assertEqual(self.c.session.call_tool.await_count, 1)

    async def test_legacy_pending_receipt_is_migrated_using_its_actual_arguments(self):
        args={"code": '-- old\nmove(20)', "companion": self.cfg['companion_uuid']}
        self.c.journal.write('tool_started',tool='lua',arguments=args)
        Path(self.temp.name,'action-receipts.json').write_text(json.dumps({'v':1,'companion':self.cfg['companion_uuid'],
            'actions':{action_key('lua',args,legacy=True):{'outcome':'pending','at':1}}}),encoding='utf8')
        restarted=Controller(self.cfg);restarted.session=NS(call_tool=AsyncMock())
        again=await restarted.call('lua',{'code':'-- changed\nmove ( 20 )'})
        self.assertEqual(again.structuredContent['reason'],'pending')
        self.assertEqual(restarted.session.call_tool.await_count,0)

    async def test_different_target_does_not_inherit_another_moves_block(self):
        self.c.session.call_tool.side_effect=TimeoutError()
        await self.c.call('lua',{'code':'move({x=20})'})
        self.c.session.call_tool.side_effect=None
        reply=await self.c.call('lua',{'code':'move({x=21})'})
        self.assertFalse(reply.isError)
        self.assertEqual(self.c.session.call_tool.await_count,2)

    def test_string_contents_and_token_boundaries_are_not_rewritten(self):
        self.assertNotEqual(lua_tokens('say("a -- b")'),lua_tokens('say("a")'))
        self.assertNotEqual(lua_tokens('say([=[a -- b]=])'),lua_tokens('say([=[a]=])'))
        self.assertNotEqual(lua_tokens('a - - b'),lua_tokens('a -- b'))
        self.assertNotEqual(lua_tokens('a b'),lua_tokens('ab'))
        self.assertEqual(lua_tokens('say("a\\\"--b") -- ignored'),['say','(','"a\\\"--b"',')'])

    async def test_actual_program_is_sent_unchanged(self):
        code='-- keep this exact script\nreturn "-- not a comment"'
        await self.c.call('lua',{'code':code})
        self.assertEqual(self.c.session.call_tool.call_args.args[1]['code'],code)


if __name__ == "__main__":
    unittest.main()
