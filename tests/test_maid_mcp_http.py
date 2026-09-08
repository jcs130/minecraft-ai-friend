"""Real loopback HTTP and official MCP client; all Qwen/RCON backends are fixtures."""
import asyncio
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import threading
import unittest

import test_maid_identity_registry as fixtures
from test_maid_identity_registry import RegistryFixtures, actor, MAID_A, MAID_B
from maid_agent_api import MaidAdapter, make_handler
from maid_registry import TOOLS


class MaidMcpHttpTests(RegistryFixtures):
    def setUp(self):
        super().setUp()
        self.a = self.registry.ensure(actor())
        self.b = self.registry.ensure(actor(MAID_B))
        self.native = fixtures.NativeTests.native(self)
        self.adapter = MaidAdapter(self.tasks.root, self.tasks, registry=self.registry, verifier=self.verifier,
                                   native=self.native, sleep=lambda _: None)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.adapter, 'legacy-' + 't' * 48))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.02}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, value, *, who=None, session=None, raw=None, headers=None, path='/mcp'):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        selected = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
                    'Authorization': 'Bearer ' + (who or self.a)['mcpToken']}
        if session:
            selected['Mcp-Session-Id'] = session
        selected.update(headers or {})
        try:
            connection.request('POST', path, body=raw if raw is not None else json.dumps(value).encode(), headers=selected)
            response = connection.getresponse()
            data = response.read()
            return response.status, dict(response.headers), json.loads(data) if data else None
        finally:
            connection.close()

    def initialize(self, who=None):
        status, headers, reply = self.request({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'fixture', 'version': '1'}}}, who=who)
        self.assertEqual(status, 200)
        self.assertEqual(reply['result']['protocolVersion'], '2025-11-25')
        return headers['Mcp-Session-Id']

    def test_protocol_seven_tools_no_foreign_uuid_and_cross_session_denied(self):
        session = self.initialize()
        _, _, reply = self.request({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}, session=session)
        self.assertEqual([t['name'] for t in reply['result']['tools']], TOOLS)
        for schema in reply['result']['tools']:
            self.assertFalse(schema['inputSchema']['additionalProperties'])
            self.assertNotIn('maidUuid', schema['inputSchema']['properties'])
        _, _, reply = self.request({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
            'params': {'name': 'identity', 'arguments': {}}}, who=self.b, session=session)
        self.assertIn('error', reply)
        _, _, reply = self.request({'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call',
            'params': {'name': 'identity', 'arguments': {'maidUuid': MAID_B}}}, session=session)
        self.assertIn('error', reply)
        self.assertEqual(self.native_calls, [])

    def test_optional_preinitialize_discovery_has_standard_fallback_without_tool_access(self):
        probe = {'jsonrpc': '2.0', 'id': 1, 'method': 'server/discover'}
        status, _, reply = self.request(probe)
        self.assertEqual(status, 200)
        self.assertEqual(reply['error']['code'], -32601)
        self.assertEqual(self.request(probe, headers={'Authorization': 'Bearer wrong'})[0], 401)
        _, _, reply = self.request({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                                  'params': {'name': 'sit', 'arguments': {'sit': True}}})
        self.assertEqual(reply['error']['code'], -32602)
        self.assertEqual(self.native_calls, [])
        session = self.initialize()
        _, _, reply = self.request({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/list'}, session=session)
        self.assertEqual({tool['name'] for tool in reply['result']['tools']}, set(TOOLS))

    def test_authentication_and_action_idempotency(self):
        self.assertEqual(self.request({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'},
                                     headers={'Authorization': 'Bearer wrong'})[0], 401)
        session = self.initialize()
        payload = {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/call', 'params': {'name': 'sit', 'arguments': {'sit': True}}}
        _, _, first = self.request(payload, session=session)
        _, _, second = self.request(payload, session=session)
        self.assertTrue(json.loads(second['result']['content'][0]['text'])['historicalReceipt'])
        self.assertEqual(len(self.native_calls), 1)
        self.assertFalse(first['result']['isError'])
        receipt = json.loads(first['result']['content'][0]['text'])
        self.assertFalse(receipt['workCompleted'])
        del payload['id']
        self.assertIn('error', self.request(payload, session=session)[2])
        self.assertEqual(len(self.native_calls), 1)

    def test_signed_endpoint_needs_signature_not_legacy_bearer(self):
        raw, headers = self.signed()
        self.assertEqual(self.request({}, raw=raw, path='/v1/maid/chat/completions')[0], 400)
        status, _, result = self.request({}, raw=raw, headers=headers, path='/v1/maid/chat/completions')
        self.assertEqual(status, 200)
        self.assertEqual(result['model'], self.a['agentId'])
        self.assertNotIn('tool_calls', result['choices'][0]['message'])

    def test_health_exposes_only_configuration_and_public_registry_summary(self):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request('GET', '/healthz')
            response = connection.getresponse()
            value = json.loads(response.read())
        finally:
            connection.close()
        self.assertEqual(response.status, 200)
        self.assertTrue(value['trustedIdentityEnabled'])
        self.assertTrue(value['nativeMcpEnabled'])
        self.assertEqual(value['registry']['registeredCount'], 2)
        self.assertNotIn(self.a['mcpToken'], json.dumps(value))
        self.assertNotIn('persona', json.dumps(value))
        self.assertFalse(any(c[1] == '/console/chat/task' for c in self.api.calls))

    def test_official_mcp_sdk_initializes_lists_and_reads_own_identity(self):
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client
        except ImportError:
            self.skipTest('Run with mcp==1.29.0 for the official protocol integration check')
        async def run():
            url = f'http://127.0.0.1:{self.server.server_port}/mcp'
            async with streamablehttp_client(url, headers={'Authorization': 'Bearer ' + self.a['mcpToken']}, timeout=5) as (read, write, _):
                async with ClientSession(read, write) as client:
                    result = await client.initialize()
                    self.assertEqual(result.serverInfo.name, 'qiandeng-maid-self')
                    tools = await client.list_tools()
                    self.assertEqual([t.name for t in tools.tools], TOOLS)
                    observation = await client.call_tool('identity', {})
                    self.assertFalse(observation.isError)
                    result = json.loads(observation.content[0].text)
                    self.assertEqual(result['identity']['maidUuid'], MAID_A)
        asyncio.run(run())
        self.assertEqual(len(self.native_calls), 1)
        self.assertFalse(any(c[1] == '/console/chat/task' for c in self.api.calls))


if __name__ == '__main__':
    unittest.main()
