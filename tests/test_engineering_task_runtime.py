"""Exact native background handler plus real Linux shared-lock admission, offline."""
import ast
import asyncio
from copy import deepcopy
import importlib.metadata
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import engineering_task_runtime as runtime
import patch_qwenpaw_engineering_tasks as build_patch


class NativeHandlerTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        package = importlib.metadata.distribution('qwenpaw')
        cls.original = package.locate_file('qwenpaw/app/routers/console.py').read_text('utf8')
        cls.patched = build_patch.patch_source(cls.original, package.version)

    def test_rejects_unreviewed_release_source_and_double_patch(self):
        for source, version in ((self.original, '3.0.0'), (self.original + '\n', '2.2.0'),
                                (self.patched, '2.2.0')):
            with self.assertRaises(ValueError):
                build_patch.patch_source(source, version)

    async def scenario(self, admitted, *, release_after=None, parse_error=False, channel_error=False):
        node = next(n for n in ast.parse(self.patched).body
                    if isinstance(n, ast.AsyncFunctionDef) and n.name == 'post_console_chat_task')
        node.decorator_list = []
        gate = asyncio.Event()
        stops, sleeps, chats, requests = [], [], [], []
        stream = io.BytesIO()
        lease = runtime.Admission(stream) if admitted is True else None
        async def none(*args, **kwargs):
            return None
        async def get_chat(*args, **kwargs):
            chats.append(args)
            return SimpleNamespace(id='original-chat-id')
        async def persist(_workspace, chat, _payload):
            return chat
        async def attach(*args, **kwargs):
            return object(), True
        async def output(*args):
            await gate.wait()
            if channel_error:
                raise RuntimeError('synthetic stream idle failure')
            yield '{"status":"completed","output":[]}'
        async def stop(chat):
            stops.append(chat)
        tracker = SimpleNamespace(attach_or_start=attach, stream_from_queue=output,
                                  detach_subscriber=none, request_stop=stop)
        channel = SimpleNamespace(resolve_session_id=lambda **k: 'original-case-session')
        async def get_channel(_):
            return channel
        workspace = SimpleNamespace(agent_id='qd-engineer', task_tracker=tracker,
            channel_manager=SimpleNamespace(get_channel=get_channel),
            chat_manager=SimpleNamespace(get_or_create_chat=get_chat, mark_chat_finished=none))
        async def get_workspace(_):
            return workspace
        async def accelerated_sleep(seconds):
            sleeps.append(seconds)
            # Preserve the exact requested native value while accelerating its
            # timer in this isolated handler namespace, never shared asyncio.
            await asyncio.sleep(0.02)
        def extract(value):
            requests.append(deepcopy(value))
            if parse_error:
                raise ValueError('synthetic envelope rejection')
            return {'sender_id': 'original-user', 'meta': {}, 'content_parts': [], 'channel_id': 'console'}
        class HttpError(Exception):
            def __init__(self, status_code, detail):
                self.status_code, self.detail = status_code, detail
        ns = {'asyncio': SimpleNamespace(create_task=asyncio.create_task, sleep=accelerated_sleep,
                current_task=asyncio.current_task, CancelledError=asyncio.CancelledError, Task=asyncio.Task),
            'HTTPException': HttpError, 'get_agent_for_request': get_workspace,
            '_resolve_effective_stream_task_timeout': lambda value: value,
            '_extract_session_and_payload': extract, '_extract_placeholder_name': lambda _: ('case', None),
            '_chat_registration_fields': lambda _: {}, '_persist_pending_project_dirs': persist,
            '_BackgroundTask': SimpleNamespace, '_parse_sse_payload': json.loads,
            '_mark_background_fork_failed': none,
            '_background_task_cancel_error': lambda **k: {'code': 'timeout' if k['timed_out'] else 'cancelled',
                'message': 'Task timed out after 600s' if k['timed_out'] else 'cancelled'},
            '_bg_lock': asyncio.Lock(), '_bg_tasks': {}, 'time': __import__('time'), 'uuid': __import__('uuid')}
        code = 'from __future__ import annotations\n' + ast.unparse(node)
        exec(compile(code, 'actual-patched-native-task-handler', 'exec'), ns)
        request_data = {'timeout': 600, 'session_id': 'original-case-session',
                        'user_id': 'original-user', 'input': []}
        with patch.object(runtime, 'admit', side_effect=runtime.EngineeringBusy() if admitted == 'busy' else None,
                          return_value=lease):
            try:
                response = await ns['post_console_chat_task'](request_data, object())
            except Exception as error:
                return {'error': error, 'lease': lease, 'stream': stream, 'tasks': ns['_bg_tasks'],
                        'chats': chats, 'requests': requests}
        bg = ns['_bg_tasks'][response['task_id']]
        self.assertEqual(bg.status, 'running')
        if admitted:
            self.assertFalse(stream.closed)
            await asyncio.sleep(0.04)
            self.assertEqual(bg.status, 'running', 'No hidden 600-second guard for admitted engineering')
            if release_after == 'cancel':
                bg.asyncio_task.cancel()
            else:
                gate.set()
        elif release_after == 'cancel':
            bg.asyncio_task.cancel()
        else:
            await asyncio.sleep(0.04)
        await bg.asyncio_task
        await asyncio.sleep(0)
        return {'response': response, 'bg': bg, 'sleeps': sleeps, 'stops': stops,
                'lease': lease, 'stream': stream, 'request': request_data, 'requests': requests}

    async def test_engineering_outlives_native_timer_and_keeps_original_session_payload(self):
        result = await self.scenario(True)
        self.assertIsNone(result['response']['timeout'])
        self.assertEqual(result['sleeps'], [])
        self.assertEqual(result['bg'].result['status'], 'completed')
        self.assertEqual(result['bg'].result['session_id'], 'original-case-session')
        self.assertEqual(result['requests'], [result['request']])
        self.assertTrue(result['stream'].closed)
        self.assertEqual(result['stops'], [])

    async def test_other_native_background_requests_keep_600_timeout_and_cancellation(self):
        result = await self.scenario(False)
        self.assertEqual(result['response']['timeout'], 600)
        self.assertEqual(result['sleeps'], [600])
        self.assertEqual(result['bg'].result['status'], 'failed')
        self.assertEqual(result['bg'].result['error']['code'], 'timeout')
        self.assertEqual(result['stops'], ['original-chat-id'])

    async def test_known_busy_does_not_create_chat_task_or_start_native_stream(self):
        result = await self.scenario('busy')
        self.assertEqual(result['error'].status_code, 409)
        self.assertFalse(result['error'].detail['taskStarted'])
        self.assertEqual(result['error'].detail['modelCalls'], 0)
        self.assertEqual(result['tasks'], {})
        self.assertEqual(result['requests'], [])
        self.assertEqual(result['chats'], [])

    async def test_envelope_failure_releases_lock_before_any_background_task(self):
        result = await self.scenario(True, parse_error=True)
        self.assertIsInstance(result['error'], ValueError)
        self.assertTrue(result['stream'].closed)
        self.assertEqual(result['tasks'], {})

    async def test_stream_failure_is_not_hidden_by_no_deadline_and_releases_lock(self):
        result = await self.scenario(True, channel_error=True)
        self.assertEqual(result['bg'].result['status'], 'failed')
        self.assertIn('synthetic stream idle', result['bg'].result['error']['message'])
        self.assertTrue(result['stream'].closed)

    async def test_native_explicit_cancellation_still_stops_engineering_and_releases_lock(self):
        result = await self.scenario(True, release_after='cancel')
        self.assertEqual(result['bg'].result['error']['code'], 'cancelled')
        self.assertTrue(result['stream'].closed)
        self.assertEqual(result['stops'], ['original-chat-id'])


@unittest.skipIf(os.name == 'nt', 'Shared native Cron/A2A flock verified in Linux image')
class AdmissionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name); self.root = self.base / 'team'; self.state = self.base / 'state'
        (self.root / 'native-help').mkdir(parents=True)
        workspace = self.state / 'work/workspaces/qd-engineer'; workspace.mkdir(parents=True)
        self.workspace = SimpleNamespace(agent_id='qd-engineer', workspace_dir=str(workspace))
        (self.state / 'work/learning-runtime.json').write_text(json.dumps({'runtime': 'game', 'engineeringTaskRuntimeVersion': 1}))
        self.case = 'case-' + 'a' * 20; self.actor = 'game:mc-god'
        self.help_id = 'help-' + runtime.fingerprint([self.actor, self.case, 1, runtime.ACTOR])[:24]
        self.payload = {'session_id': 'world-case:' + self.case + ':qd-engineer', 'user_id': 'world-team:' + self.actor,
            'request_context': {'root_agent_id': 'qd-engineer', runtime.CONTEXT_KEY: {'version': 1, 'helpId': self.help_id}},
            'input': [], 'timeout': 600}
        self.record = {'helpId': self.help_id, 'caseId': self.case, 'caseVersion': 1, 'actor': self.actor,
            'recipient': runtime.ACTOR, 'nativeHost': {'runtime': 'game', 'agentId': 'qd-engineer'},
            'sessionId': self.payload['session_id'], 'status': 'unknown',
            'engineeringExecution': runtime.POLICY, 'requestSha256': runtime.fingerprint(self.payload)}
        self.path = self.root / 'native-help' / (self.help_id + '.json'); self.save()
        with sqlite3.connect(self.root / 'team.sqlite3') as db:
            db.execute('CREATE TABLE cycles(actor,status)')
            db.execute('INSERT INTO cycles VALUES (?,?)', (runtime.ACTOR, 'completed'))

    def save(self):
        self.path.write_text(json.dumps(self.record))

    def admit(self, **kwargs):
        return runtime.admit(kwargs.get('payload', self.payload), kwargs.get('workspace', self.workspace),
                             root=self.root, state=self.state, require_host=lambda *args: None)

    def test_exact_admitted_a2a_and_cron_use_same_kernel_lock_in_both_directions(self):
        import fcntl
        path = self.root / 'cycle-operations-mc-god.lock'
        with path.open('a+b') as cron:
            fcntl.flock(cron, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(runtime.EngineeringBusy): self.admit()
        admission = self.admit()
        try:
            with path.open('a+b') as cron:
                with self.assertRaises(BlockingIOError): fcntl.flock(cron, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(runtime.EngineeringBusy): self.admit()
        finally: admission.release_unattached()
        self.admit().release_unattached()

    def test_wrong_role_workspace_session_intent_and_already_submitted_never_admit(self):
        changed = deepcopy(self.payload); changed['session_id'] = 'another-session'
        with self.assertRaises(ValueError): self.admit(payload=changed)
        with self.assertRaises(ValueError): self.admit(workspace=SimpleNamespace(agent_id='mc-god',workspace_dir=self.workspace.workspace_dir))
        for change in ({'nativeHost': {'runtime':'operations','agentId':'mc-god'}},
                       {'status':'submitted','taskId':'task-old'}, {'requestSha256':'forged'}, {'caseVersion':2}):
            original = deepcopy(self.record); self.record.update(change); self.save()
            with self.assertRaises(ValueError): self.admit()
            self.record=original;self.save()

    def test_stale_unknown_cycle_cannot_be_bypassed_with_free_lock(self):
        with sqlite3.connect(self.root / 'team.sqlite3') as db:
            db.execute('UPDATE cycles SET status=?', ('unknown',))
        with self.assertRaises(runtime.EngineeringBusy) as error: self.admit()
        self.assertEqual(error.exception.detail['code'], 'engineering_cycle_unresolved')
        self.assertFalse(error.exception.detail['taskStarted'])

    def test_missing_policy_keeps_native_timeout_and_does_not_take_lock(self):
        payload = deepcopy(self.payload); payload['request_context'].pop(runtime.CONTEXT_KEY)
        self.assertIsNone(self.admit(payload=payload))


if __name__ == '__main__':
    unittest.main()
