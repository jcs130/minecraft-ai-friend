"""External client contract: actual HTTP failures must never repeat mutations."""
import contextlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import tempfile
import threading
from pathlib import Path
import unittest
from unittest.mock import patch
import maw_numen_client as sdk


class ClientContract(unittest.TestCase):
    def setUp(self):
        self.requests = []; self.destination_auth = []; self.mode = 'ok'; outer = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                value = json.loads(self.rfile.read(int(self.headers['Content-Length']))); outer.requests.append(value)
                if outer.mode == 'redirect':
                    self.send_response(307); self.send_header('Location', 'http://127.0.0.1:'+str(outer.server.server_port)+'/stolen/mcp'); self.end_headers(); return
                if self.path == '/stolen/mcp': outer.destination_auth.append(self.headers.get('Authorization'))
                if outer.mode == '503':
                    self.send_response(503); self.end_headers(); return
                result = {'structuredContent': {'ok': True, 'phase': outer.mode if outer.mode in ('unknown', 'accepted') else 'terminal'}}
                data = json.dumps({'jsonrpc': '2.0', 'id': 'wrong' if outer.mode == 'wrong-id' else value['id'], 'result': result}).encode()
                self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.client = sdk.Client('http://127.0.0.1:'+str(self.server.server_port)+'/mcp', 'a'*64)
        self.addCleanup(self.server.server_close); self.addCleanup(self.server.shutdown)

    def test_real_utf8_http_call_once(self):
        result = self.client.call('mod_action', {'action_id': 'stable-id', 'arguments': {'name': '中文法术'}})
        self.assertTrue(result['ok']); self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0]['params']['arguments']['arguments']['name'], '中文法术')

    def test_upstream_failure_is_unconfirmed_and_never_retried(self):
        self.mode = '503'
        with self.assertRaises(sdk.ClientError) as error: self.client.call('mod_action', {'action_id': 'stable-id'})
        self.assertTrue(error.exception.unconfirmed); self.assertEqual(len(self.requests), 1)
        self.assertNotIn('a'*64, str(error.exception))

    def test_redirect_does_not_forward_bearer_or_replay_action(self):
        self.mode = 'redirect'
        with self.assertRaises(sdk.ClientError) as error: self.client.call('mod_action', {'action_id': 'stable-id'})
        self.assertEqual(error.exception.code, 'redirect_refused_credentials_not_forwarded')
        self.assertEqual(len(self.requests), 1); self.assertEqual(self.destination_auth, [])

    def test_receipt_id_must_match_submitted_request(self):
        self.mode = 'wrong-id'
        with self.assertRaises(sdk.ClientError) as error: self.client.call('mod_action', {})
        self.assertTrue(error.exception.unconfirmed); self.assertEqual(len(self.requests), 1)

    def test_unknown_is_returned_without_repeat_or_cancel(self):
        self.mode = 'unknown'
        result = self.client.wait('body', 'original-id')
        self.assertEqual(result['phase'], 'unknown'); self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0]['params']['name'], 'action_status')

    def test_expired_wait_does_not_cancel_original_action(self):
        self.mode = 'accepted'
        with patch.object(sdk.time, 'monotonic', side_effect=[0, 2]):
            with self.assertRaises(sdk.ClientError) as error: self.client.wait('body', 'original-id', timeout=1)
        self.assertTrue(error.exception.unconfirmed); self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0]['params']['arguments']['action_id'], 'original-id')

    def test_public_plaintext_and_ambiguous_endpoints_rejected_before_send(self):
        for endpoint in ('http://8.8.8.8/mcp', 'http://example.com/mcp', 'http://203.0.113.1/mcp', 'https://user:pass@example.com/mcp',
                         'https://example.com/mcp?key=token', 'https://example.com/mcp#token', 'file:///mcp', 'http://0.0.0.0/mcp'):
            with self.subTest(endpoint=endpoint), self.assertRaises(sdk.ClientError): sdk.Client(endpoint, 'a'*64)
        self.assertEqual(sdk.validate_endpoint('https://example.com/numen/mcp'), 'https://example.com/numen/mcp')
        self.assertEqual(sdk.validate_endpoint('http://192.168.3.163:28984/numen/mcp'), 'http://192.168.3.163:28984/numen/mcp')

    def test_private_config_never_printed_and_standalone_file_suffices(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'credentials.json'; path.write_text(json.dumps({'endpoint': self.client.endpoint, 'token': 'a'*64}), encoding='utf-8')
            capture = io.StringIO()
            with contextlib.redirect_stdout(capture): client = sdk.Client.from_credentials(path)
            self.assertEqual(capture.getvalue(), ''); self.assertEqual(client.endpoint, self.client.endpoint)


if __name__ == '__main__': unittest.main()
