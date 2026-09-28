"""Status serialization is compact without changing its native MCP data contract."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from mcp_server import make_server


class StatusEncodingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.gateway = SimpleNamespace(state=Path(temp.name), clock=lambda: 1800000000)
        self.server = make_server(self.gateway)
        self.body = {
            'ok': True, 'bodyUuid': 'body-exact-id', 'position': {'x': -554.5, 'y': 64, 'z': 866.5},
            'counts': {'minecraft:bread': 2}, 'statusDetail': 'brief', 'omittedFields': ['inventory'],
            'actionExecution': {'ok': False, 'inFlight': True, 'receipt': {
                'actionId': 'action-exact-id', 'nativeTaskId': 'native-exact-id', 'status': 'unknown',
                'executionConfirmed': False, 'completionConfirmed': False,
                'code': 'native_unconfirmed', 'retryAutomatically': False,
                'futureEvidence': {'零副作用未确认': None, 'counter': 9007199254740993}}},
            'motorQueue': {'active': {'requestId': 'request-exact-id', 'status': 'unknown'},
                           'recent': [{'requestId': 'completed-id', 'status': 'completed',
                                       'completionConfirmed': True,
                                       'nextRepeat': {'previousRequestId': 'completed-id'}}]},
            'futureStatusField': {'unchanged': [False, None, '中文 \"引号\"\n换行']}}

    async def call_status(self, arguments, body):
        expected = copy.deepcopy(body)
        with patch('mcp_server.read_status', return_value=body) as read:
            result = await self.server.call_tool('status', arguments)
        read.assert_called_once_with(self.gateway, arguments.get('wait_seconds', 0),
                                     detail=arguments.get('detail', 'brief'))
        self.assertEqual(body, expected)
        # Normalize the SDK's old content list so the red case tests actual
        # serialization, not merely the new return object's Python type.
        if isinstance(result, list):
            content, structured = result, None
        else:
            content, structured = result.content, result.structuredContent
            self.assertFalse(result.isError)
        self.assertEqual([block.type for block in content], ['text'])
        self.assertIsNone(structured)
        self.assertEqual(json.loads(content[0].text), expected)
        self.assertEqual(content[0].text, json.dumps(expected, ensure_ascii=False, separators=(',', ':')))
        return result

    async def test_default_brief_keeps_unknown_identity_repeat_and_future_fields(self):
        await self.call_status({}, self.body)

    async def test_explicit_full_preserves_inventory_and_unprojected_receipt(self):
        full = dict(self.body, statusDetail='full', inventory=[{
            'slot': 7, 'id': 'minecraft:written_book', 'components': {'text': '空格  保留\n第二行'}}])
        full['actionExecution']['receipt']['rawNative'] = {'opaque': [1, 2, 3]}
        await self.call_status({'detail': 'full', 'wait_seconds': 2}, full)

    async def test_acquisition_error_remains_data_not_transport_failure(self):
        await self.call_status({}, {'ok': False, 'code': 'body_offline', 'online': False,
                                   'futureError': {'retryAutomatically': False}})

    async def test_status_input_and_unstructured_output_schema_are_preserved(self):
        tool = next(t for t in await self.server.list_tools() if t.name == 'status')
        self.assertEqual(set(tool.inputSchema['properties']), {'wait_seconds', 'detail'})
        self.assertEqual(tool.inputSchema['properties']['detail']['default'], 'brief')
        self.assertEqual(tool.inputSchema['properties']['wait_seconds']['default'], 0)
        self.assertIsNone(tool.outputSchema)

    @unittest.skipUnless(importlib.util.find_spec('qwenpaw'), 'requires installed native Qwen adapter')
    async def test_installed_qwen_adapter_keeps_one_compact_payload(self):
        from qwenpaw.drivers.adapters.agentscope_tool import _tool_chunk_from_driver_result
        from qwenpaw.drivers.capabilities import DriverInvocationResult
        result = await self.call_status({}, self.body)
        chunk = _tool_chunk_from_driver_result(DriverInvocationResult(ok=True, value=result))
        self.assertEqual(len(chunk.content), 1)
        self.assertEqual(chunk.content[0].type, 'text')
        self.assertEqual(chunk.content[0].text,
                         json.dumps(self.body, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    unittest.main()
