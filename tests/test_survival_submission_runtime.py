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
from survival_submission_runtime import identity, submit_once
from controller import QwenBackend


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
