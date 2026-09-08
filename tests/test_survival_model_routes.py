"""Central QwenPaw routing fixtures; no model, services, or live state access."""
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from controller import QwenBackend


class SurvivorModelRoutesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'routes.json'
        self.catalog = json.loads((ROOT / 'config/model-task-routes.json').read_text(encoding='utf8'))
        self.catalog['routes']['survivor.autonomy']['apiUrl'] = 'http://qwen.fixture.invalid:8088/api'
        self.env = {'MODEL_TASK_ROUTES_FILE': str(self.path),
                    'QWENPAW_API_URL': 'https://must-not-use.fixture.invalid/v1'}
        self.write(self.catalog)

    def write(self, value):
        self.path.write_text(json.dumps(value), encoding='utf8')

    def test_production_uses_directory_and_preserves_agent_identity(self):
        backend = QwenBackend(self.env)
        self.assertEqual(backend.base_url, 'http://qwen.fixture.invalid:8088/api')
        self.assertEqual(backend.agent_id, 'qd-survivor')
        reply = Mock(content=b'{}')
        reply.json.return_value = {'status': 'running'}
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.request.return_value = reply
        with patch('httpx.Client', return_value=client) as ctor:
            self.assertEqual(backend.poll('task-fixture'), {'status': 'running'})
        self.assertEqual(ctor.call_args.kwargs['base_url'], backend.base_url)
        self.assertEqual(ctor.call_args.kwargs['headers'], {'X-Agent-Id': 'qd-survivor'})
        self.assertIs(ctor.call_args.kwargs['trust_env'], False)
        client.request.assert_called_once_with('GET', '/console/chat/task/task-fixture', json=None)

    def test_missing_invalid_or_wrong_role_never_falls_back(self):
        with self.assertRaisesRegex(ValueError, 'path_invalid'):
            QwenBackend({**self.env, 'MODEL_TASK_ROUTES_FILE': ''})
        mutations = [
            lambda c: c['routes']['survivor.autonomy'].update(agentId='mc-god'),
            lambda c: c['routes']['survivor.autonomy'].update(runtime='operations'),
            lambda c: c['routes']['survivor.autonomy'].update(apiUrl='https://vendor.fixture.invalid/v1/chat/completions'),
            lambda c: c['routes']['survivor.autonomy'].update(apiUrl='http://secret@qwen.fixture.invalid/api'),
            lambda c: c['routes']['survivor.autonomy'].update(apiUrl='http://qwen.fixture.invalid/api?key=secret'),
            lambda c: c['routes']['survivor.autonomy'].update(apiUrl='http://qwen.fixture.invalid:99999/api'),
            lambda c: c['policy'].update(automaticProviderFallback=True),
            lambda c: c['policy'].update(unknownSubmissionRetry=True),
            lambda c: c['routes'].pop('survivor.autonomy'),
        ]
        for mutate in mutations:
            value = copy.deepcopy(self.catalog)
            mutate(value); self.write(value)
            with self.assertRaises(ValueError):
                QwenBackend(self.env)
        self.path.write_text(' ' * 65_537, encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'too_large'):
            QwenBackend(self.env)
        self.path.unlink()
        with self.assertRaises(FileNotFoundError):
            QwenBackend(self.env)

    def test_development_without_directory_keeps_legacy_api_setting(self):
        self.assertEqual(QwenBackend({}).base_url, 'http://127.0.0.1:8088/api')
        self.assertEqual(QwenBackend({'QWENPAW_API_URL': 'http://dev.fixture.invalid/api/'}).base_url,
                         'http://dev.fixture.invalid/api')

    def test_submission_uses_official_builder_and_seconds_exactly_once(self):
        backend = QwenBackend(self.env)
        builder = Mock(return_value=('agent', {'session_id': 'life-fixed'}, None))
        backend.api = Mock(return_value={'task_id': 'task-one'})
        with patch.dict(sys.modules, {'qwenpaw.agents.tools.agent_management':
                                      SimpleNamespace(build_agent_chat_request=builder)}):
            self.assertEqual(backend.submit('turn', 'fixture objective', 570,
                session={'primarySessionId': 'life-fixed', 'userId': 'survival-controller', 'channel': 'console'}), 'task-one')
        builder.assert_called_once_with('qd-survivor', 'fixture objective', session_id='life-fixed', from_agent='survival-controller')
        backend.api.assert_called_once_with('POST', '/console/chat/task', {'session_id': 'life-fixed', 'channel': 'console', 'timeout': 570})


if __name__ == '__main__':
    unittest.main()
