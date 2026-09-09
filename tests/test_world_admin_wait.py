"""A real native MCP session stays responsive while a receipt read waits."""
import asyncio
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'world/ops')]
from world_admin_tools import register_admin_tools, TOOL_NAMES


class ReceiptWaitProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_mcp_tools_list_during_blocked_receipt_wait(self):
        from mcp.server.fastmcp import FastMCP
        from mcp.shared.memory import create_connected_server_and_client_session
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        calls = []
        def blocked_receipt(request_id, wait_seconds=0):
            calls.append((request_id, wait_seconds))
            entered.set()
            try:
                release.wait(5)
                return {'ok': True, 'status': 'completed', 'requestId': request_id, 'executionConfirmed': False}
            finally:
                finished.set()

        with tempfile.TemporaryDirectory() as directory:
            app = FastMCP('isolated-receipt-wait')
            service = register_admin_tools(app, 'game:mc-god', Path(directory))
            with patch.object(service, 'receipt', side_effect=blocked_receipt):
                async with create_connected_server_and_client_session(app) as session:
                    waiting = asyncio.create_task(session.call_tool('world_admin_receipt',
                        {'request_id': 'fixture-request', 'wait_seconds': 50}))
                    try:
                        self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                        self.assertFalse(finished.is_set(), 'The MCP event loop was blocked until the wait ended')
                        listed = await asyncio.wait_for(session.list_tools(), timeout=1)
                        self.assertEqual({tool.name for tool in listed.tools}, set(TOOL_NAMES))
                        receipt = next(tool for tool in listed.tools if tool.name == 'world_admin_receipt')
                        self.assertEqual(receipt.inputSchema['properties']['wait_seconds']['default'], 0)
                        self.assertFalse(finished.is_set(), 'Tools/list must finish while the receipt is still waiting')
                    finally:
                        release.set()
                        answer = await asyncio.wait_for(waiting, timeout=2)
                    self.assertFalse(answer.isError)
                    self.assertEqual(calls, [('fixture-request', 50)])


if __name__ == '__main__': unittest.main()
