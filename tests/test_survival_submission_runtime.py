import asyncio
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/survival')]
from survival_submission_runtime import CHAT_BUSY_DETAIL, identity, submit_once
from controller import NATIVE_CHAT_BUSY_DETAIL, NativeChatBusy, QwenBackend


class SubmissionReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.workspace = SimpleNamespace(agent_id='qd-survivor', workspace_dir=str(self.root))
        self.ref = {'version': 1, 'turn_id': 'survival-' + 'a' * 32, 'session_id': 'life-' + 'b' * 32}
        self.payload = {'session_id': self.ref['session_id'], 'user_id': 'survival-controller', 'channel': 'console',
                        'request_context': {'qiandeng_survival_turn': self.ref}, 'input': 'private speech'}

    def test_ack_persisted_before_return_and_duplicate_never_reposts(self):
        calls = []
        async def original(*args):
            calls.append(args)
            return {'task_id': 'task-000000000001'}
        result = asyncio.run(submit_once(original, self.payload, None, self.workspace))
        path = self.root / 'native-submissions' / (self.ref['turn_id'] + '.json')
        row = json.loads(path.read_text())
        self.assertEqual(row['taskId'], result['task_id'])
        self.assertEqual(row['phase'], 'submitted')
        self.assertNotIn('private speech', path.read_text())
        from fastapi import HTTPException
        with self.assertRaises(HTTPException):
            asyncio.run(submit_once(original, self.payload, None, self.workspace))
        self.assertEqual(len(calls), 1)
        backend = QwenBackend({})
        backend.api = lambda *a: row
        active = {k: row[k] for k in ('turnId','sessionId','userId','channel')}
        self.assertEqual(backend.lookup_submission(active), result['task_id'])
        row['sessionId'] = 'life-' + 'c' * 32
        with self.assertRaisesRegex(ValueError, 'binding_mismatch'):
            backend.lookup_submission(active)

    def test_native_exception_preserves_unknown_and_does_not_infer_failure(self):
        async def original(*args):
            raise TimeoutError('uncertain acceptance')
        with self.assertRaises(TimeoutError):
            asyncio.run(submit_once(original, self.payload, None, self.workspace))
        row = json.loads(next((self.root / 'native-submissions').glob('*.json')).read_text())
        self.assertEqual(row['phase'], 'unknown')
        self.assertNotIn('taskId', row)

    def test_exact_native_chat_busy_is_durable_rejection_without_task(self):
        from fastapi import HTTPException
        self.assertEqual(CHAT_BUSY_DETAIL, NATIVE_CHAT_BUSY_DETAIL)
        calls = []
        async def original(*args):
            calls.append(args)
            raise HTTPException(status_code=409, detail=CHAT_BUSY_DETAIL)
        with self.assertRaises(HTTPException):
            asyncio.run(submit_once(original, self.payload, None, self.workspace))
        path = self.root / 'native-submissions' / (self.ref['turn_id'] + '.json')
        row = json.loads(path.read_text())
        self.assertEqual((row['phase'], row['reason']), ('rejected', 'chat_busy'))
        self.assertNotIn('taskId', row)
        with self.assertRaises(HTTPException):
            asyncio.run(submit_once(original, self.payload, None, self.workspace))
        self.assertEqual(len(calls), 1)

    def test_other_409_remains_unknown(self):
        from fastapi import HTTPException
        async def original(*args):
            raise HTTPException(status_code=409, detail='survival_submission_already_recorded')
        with self.assertRaises(HTTPException):
            asyncio.run(submit_once(original, self.payload, None, self.workspace))
        row = json.loads(next((self.root / 'native-submissions').glob('*.json')).read_text())
        self.assertEqual(row['phase'], 'unknown')

    def test_backend_accepts_busy_only_with_exact_http_and_bound_durable_receipt(self):
        import httpx
        session = {'primarySessionId': self.ref['session_id'], 'userId': 'survival-controller',
                   'channel': 'console'}
        row = {'schema': 1, 'turnId': self.ref['turn_id'], 'sessionId': self.ref['session_id'],
               'userId': 'survival-controller', 'agentId': 'qd-survivor', 'channel': 'console',
               'phase': 'rejected', 'reason': 'chat_busy'}
        request = httpx.Request('POST', 'http://localhost/api/console/chat/task')
        response = httpx.Response(409, json={'detail': CHAT_BUSY_DETAIL}, request=request)
        backend = QwenBackend({})
        calls = []
        def api(method, route, payload=None):
            calls.append((method, route))
            if method == 'POST':
                raise httpx.HTTPStatusError('busy', request=request, response=response)
            return row
        backend.api = api
        with self.assertRaises(NativeChatBusy):
            backend.submit(self.ref['turn_id'], 'one prompt', 60, session=session)
        self.assertEqual(calls, [('POST', '/console/chat/task'),
            ('GET', '/console/survival-submission/' + self.ref['turn_id'])])
        row['phase'] = 'unknown'
        with self.assertRaises(httpx.HTTPStatusError):
            backend.submit(self.ref['turn_id'], 'one prompt', 60, session=session)

    def test_other_roles_pass_through_and_invalid_owned_binding_fails(self):
        self.assertIsNone(identity(self.payload, 'another-role'))
        bad = copy.deepcopy(self.payload)
        bad['session_id'] = 'wrong'
        with self.assertRaisesRegex(ValueError, 'invalid_survival'):
            identity(bad, 'qd-survivor')


class NativeRouteTests(unittest.TestCase):
    def test_installed_wrapper_preserves_fastapi_schema_and_registers_get(self):
        import survival_submission_runtime as runtime
        from qwenpaw.app.routers import console
        from fastapi import FastAPI
        original = console.post_console_chat_task
        routes = list(console.router.routes)
        try:
            self.assertEqual(runtime.install(), 1)
            app = FastAPI()
            app.include_router(console.router)
            schema = app.openapi()
            self.assertIn('post', schema['paths']['/console/chat/task'])
            self.assertIn('get', schema['paths']['/console/survival-submission/{turn_id}'])
        finally:
            console.post_console_chat_task = original
            console.router.routes[:] = routes
            for route in routes:
                if route.path == '/console/chat/task' and 'POST' in route.methods:
                    route.endpoint = original
                    route.dependant.call = original
            if hasattr(console, '_qd_survival_submission_version'):
                del console._qd_survival_submission_version
