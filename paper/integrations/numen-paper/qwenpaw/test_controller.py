import asyncio
import tempfile
import json
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from mcp import types
from numen_controller import Controller, Journal, ProcessLease, bound_arguments, has_events, local_url, should_wake, command_script, command_result


class ControllerTests(unittest.TestCase):
    def test_only_loopback_http(self):
        self.assertEqual(local_url("http://127.0.0.1:8765/mcp"), "http://127.0.0.1:8765/mcp")
        for url in ["http://example.com/mcp", "https://127.0.0.1", "http://key@localhost/x", "file:///tmp/token"]:
            with self.assertRaises(ValueError): local_url(url)

    def test_binds_body_and_cannot_change_input_object(self):
        args = {"code": "return 1"}
        self.assertEqual(bound_arguments(args, "one")["companion"], "one")
        self.assertNotIn("companion", args)
        with self.assertRaises(ValueError): bound_arguments({"companion": "other"}, "one")

    def test_empty_poll_does_not_trigger_a_model_turn(self):
        self.assertFalse(has_events("(no new events — call get_events again)"))
        self.assertFalse(has_events(""))
        self.assertTrue(has_events("收到私聊：你好"))

    def test_only_relevant_events_wake_model(self):
        self.assertFalse(should_wake('<events><event kind="server_message">查询完成</event></events>'))
        self.assertFalse(should_wake('<events><event kind="talk">[NEKO] 小麦成熟了</event></events>'))
        self.assertTrue(should_wake('<query>往前走两格</query>'))
        self.assertTrue(should_wake('<events><event kind="talk">[NEKO → ag_Kirito] 你好</event></events>'))
        self.assertTrue(should_wake('<events><event kind="death">倒下了</event></events>'))

    def test_deduplication_survives_restart(self):
        with tempfile.TemporaryDirectory() as d:
            first = Journal(Path(d))
            self.assertIsNotNone(first.accept("event-id-12: go"))
            self.assertIsNone(first.accept("event-id-12: go"))
            self.assertIsNone(Journal(Path(d)).accept("event-id-12: go"))

    def test_background_job_end_wakes_without_replaying_it(self):
        for status in ("done", "failed", "timeout", "interrupted"):
            self.assertTrue(should_wake(f'<events><event kind="task_finished" id="job-1" status="{status}">result</event></events>'))
        self.assertFalse(should_wake('<event kind="task_finished" status="stopped">owner stopped</event>'))
        self.assertFalse(should_wake('<event kind="server_message">task_finished status="done"</event>'))

    def test_full_inventory_and_dimension_change_require_replanning(self):
        self.assertTrue(should_wake('<event kind="inventory_full">item left on ground</event>'))
        self.assertTrue(should_wake('<event kind="dimension_change">minecraft:the_nether</event>'))

    def test_later_identical_user_message_is_a_new_event(self):
        with tempfile.TemporaryDirectory() as d:
            now=[100.0]
            journal=Journal(Path(d),clock=lambda:now[0])
            first=journal.accept('<query>跟我来</query>')
            now[0]=103.0
            second=journal.accept('<query>跟我来</query>')
            self.assertIsNotNone(second)
            self.assertNotEqual(first,second)

    def test_journal_rotation_is_bounded(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d));journal.LIMIT=100
            for index in range(20):journal.write('sample',text='x'*120,index=index)
            self.assertLessEqual(len(list(Path(d).glob('controller.jsonl*'))),4)

    def test_lease_is_exclusive_and_released(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "brain.lock"
            lease = ProcessLease(path)
            with self.assertRaises(OSError): ProcessLease(path)
            lease.close()
            again = ProcessLease(path)
            again.close()

    def test_unknown_tool_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            c = Controller(dict(upstream_url="http://localhost:8765/mcp", qwenpaw_url="http://localhost:8088", companion_uuid="one", journal_dir=d))
            with self.assertRaises(ValueError): asyncio.run(c.call("delete_companion", {}))

    def test_cached_tools_cannot_add_admin_capabilities(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'upstream-tools.json').write_text(json.dumps({'v':1,'tools':[{'name':'delete_companion','inputSchema':{'type':'object'}}]}),encoding='utf-8')
            c=Controller(dict(upstream_url='http://localhost:8765/mcp',qwenpaw_url='http://localhost:8088',companion_uuid='one',journal_dir=d))
            self.assertFalse(c.ready.is_set())
            self.assertEqual(c.tools,[])

    def test_command_preserves_complete_text_and_quotes_input(self):
        code=command_script('/minecraft:msg NEKO "你好"')
        self.assertIn('print(line)', code)
        self.assertIn('\\"你好\\"', code)
        for value in ['', '/mycli status\n/op me', 'a'*513, None]:
            with self.assertRaises(ValueError): command_script(value)

    def test_interrupted_action_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as d:
            c = Controller(dict(upstream_url="http://localhost:8765/mcp", qwenpaw_url="http://localhost:8088", companion_uuid="one", journal_dir=d))
            c.session = AsyncMock()
            c.session.call_tool.side_effect = TimeoutError()
            result = asyncio.run(c.call("lua", {"code": "move()"}))
            self.assertTrue(result.isError)
            self.assertIn("结果未知", result.content[0].text)
            self.assertEqual(c.session.call_tool.await_count, 1)

    def test_full_command_data_replaces_cut_display_and_keeps_later_events(self):
        line='MC_SKILL '+json.dumps({'description':'技能'*16000},ensure_ascii=False)
        raw={'command':'/mycli skills mine','output':[line],'result':1}
        value=types.CallToolResult(content=[types.TextContent(type='text',text='[stdout cut at 6000 characters]'),
            types.TextContent(type='text',text='<event kind="timer">ready</event>')],structuredContent={'commandReceipt':raw})
        actual=command_result(value)
        self.assertFalse(actual.isError)
        self.assertEqual(json.loads(actual.content[0].text.partition(' ')[2])['description'],'技能'*16000)
        self.assertIn('timer',actual.content[1].text)
        self.assertTrue(actual.structuredContent['complete'])
        self.assertEqual(actual.structuredContent['outputLines'],1)
        self.assertNotIn('output',actual.structuredContent)

    def test_cut_legacy_receipt_is_unknown_and_never_claimed_complete(self):
        value=types.CallToolResult(content=[types.TextContent(type='text',text='MC_SKILL {"id":"x\n[stdout cut at 6000 characters; 12000 more were not shown]')])
        actual=command_result(value)
        self.assertTrue(actual.isError)
        self.assertIn('不要重放',actual.content[0].text)


if __name__ == "__main__": unittest.main()
