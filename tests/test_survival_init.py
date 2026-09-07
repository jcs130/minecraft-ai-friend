"""Private-state preparation boundaries, exercised without Docker or inference."""
import base64
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_survival', ROOT / 'tools/prepare_survival_agent.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class SurvivalPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'operations'
        self.target = self.base / 'survival'
        self.settings = self.base / 'settings.json'
        prepare.write_private(self.settings, {'bodyName': 'Kirito'})
        self.old_master = 'a1' * 32
        self.source_key = 'fixture-not-a-real-key'
        self.provider_id = 'aliyun-codingplan'
        self.source_cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(self.old_master)))
        self.profile = {'id': 'default', 'active_model': {'provider_id': self.provider_id, 'model': 'qwen3.6-plus'},
                        'tools': {'builtin_tools': {'shell': {'enabled': True}}}}
        self.provider = {'id': self.provider_id, 'base_url': 'https://coding-plan.example.test/v1',
                         'chat_model': 'OpenAIChatModel',
                         'api_key': 'ENC:' + self.source_cipher.encrypt(self.source_key.encode()).decode(),
                         'generate_kwargs': {'max_tokens': 999999, 'extra_headers': {'secret': 'do-not-copy'}}}
        self.write_source()
        self.run_calls = []

    def write_source(self):
        prepare.write_private(self.source / 'work/workspaces/default/agent.json', self.profile)
        prepare.write_private(self.source / 'secret/providers/custom' / (self.provider_id + '.json'), self.provider)
        (self.source / 'secret/.master_key').write_text(self.old_master)

    def runner(self, command, **kwargs):
        self.run_calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps({'project': prepare.PROJECT, 'ok': True}))

    def call_prepare(self, source=None, target=None, **kwargs):
        return prepare.prepare(source or self.source, target or self.target, settings=self.settings, **kwargs)

    def test_check_has_no_writes_no_subprocess_and_no_credentials_in_output(self):
        result = self.call_prepare(run=self.runner)
        self.assertFalse(self.target.exists())
        self.assertEqual(self.run_calls, [])
        self.assertEqual(result['model']['model'], 'qwen3.6-plus')
        self.assertNotIn(self.source_key, json.dumps(result))
        self.assertNotIn(self.provider['api_key'], json.dumps(result))

    def test_execution_rekeys_only_selected_provider_and_strips_source_tools_and_history(self):
        prepare.write_private(self.source / 'work/workspaces/default/sessions/private.json', {'never': 'copy'})
        prepare.write_private(self.source / 'work/workspaces/mc-god/agent.json', {'broken': 'not selected'})
        before = {p.relative_to(self.source): p.read_bytes() for p in self.source.rglob('*') if p.is_file()}
        result = self.call_prepare(execute=True, run=self.runner)
        new_master = (self.target / 'secret/.master_key').read_text()
        self.assertNotEqual(new_master, self.old_master)
        saved = json.loads((self.target / 'secret/providers/custom/aliyun-codingplan.json').read_text())
        cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(new_master)))
        self.assertEqual(cipher.decrypt(saved['api_key'][4:].encode()).decode(), self.source_key)
        self.assertNotEqual(saved['api_key'], self.provider['api_key'])
        self.assertEqual(saved['generate_kwargs'], {'max_tokens': 2048})
        self.assertEqual(saved['extra_models'], [{'id': 'qwen3.6-plus', 'name': 'qwen3.6-plus'}])
        self.assertFalse((self.target / 'work').exists())  # Fake runner never initializes Qwen.
        self.assertTrue(result['offlineInitializationVerified'])
        self.assertEqual(before, {p.relative_to(self.source): p.read_bytes()
                                 for p in self.source.rglob('*') if p.is_file()})
        self.assertEqual(len(self.run_calls), 1)
        serialized = json.dumps(self.run_calls)
        self.assertNotIn(self.source_key, serialized)
        self.assertNotIn(self.old_master, serialized)

    def test_current_model_is_selected_instead_of_historical_default(self):
        self.profile['active_model']['model'] = 'current-user-selection'
        self.write_source()
        value = self.call_prepare()
        self.assertEqual(value['model']['model'], 'current-user-selection')

    def test_changed_provider_requires_review_without_source_or_target_mutation(self):
        self.profile['active_model']['provider_id'] = 'different-provider'
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'coordinator_provider_changed'):
            self.call_prepare(execute=True, run=self.runner)
        self.assertFalse(self.target.exists())
        self.assertEqual(self.run_calls, [])

    def test_nonempty_target_refuses_before_reading_source(self):
        self.target.mkdir()
        marker = self.target / 'existing-session.json'
        marker.write_text('keep')
        with self.assertRaisesRegex(ValueError, 'target_not_empty'):
            self.call_prepare(source=self.base / 'missing-source', execute=True, run=self.runner)
        self.assertEqual(marker.read_text(), 'keep')
        self.assertEqual(self.run_calls, [])

    def test_duplicate_provider_fails_closed(self):
        prepare.write_private(self.source / 'secret/providers/builtin/aliyun-codingplan.json', self.provider)
        with self.assertRaisesRegex(ValueError, 'ambiguous_provider'):
            self.call_prepare(execute=True, run=self.runner)
        self.assertFalse(self.target.exists())

    def test_invalid_credentials_leave_no_target(self):
        (self.source / 'secret/.master_key').write_text('b2' * 32)
        with self.assertRaises(Exception):
            self.call_prepare(execute=True, run=self.runner)
        self.assertFalse(self.target.exists())

    def test_unreviewed_endpoint_and_adapter_leave_no_target(self):
        for changes in ({'base_url': 'http://127.0.0.1:8088'},
                        {'base_url': 'https://user:pass@example.test/v1'},
                        {'base_url': 'https://example.test/v1?key=private'},
                        {'chat_model': 'ArbitraryAdapter'}):
            with self.subTest(changes=changes):
                provider = {**self.provider, **changes}
                prepare.write_private(self.source / 'secret/providers/custom/aliyun-codingplan.json', provider)
                with self.assertRaises(ValueError):
                    self.call_prepare(execute=True, run=self.runner)
                self.assertFalse(self.target.exists())

    def test_failed_initialization_preserves_staging_and_never_retries(self):
        calls = []
        def failure(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(returncode=1, stdout='private upstream failure')
        with self.assertRaisesRegex(RuntimeError, 'private_staging_retained'):
            self.call_prepare(execute=True, run=failure)
        self.assertEqual(len(calls), 1)
        self.assertTrue((self.target / 'secret/.master_key').is_file())
        with self.assertRaisesRegex(ValueError, 'target_not_empty'):
            self.call_prepare(execute=True, run=failure)
        self.assertEqual(len(calls), 1)

    def test_initializer_command_is_offline_and_has_only_dedicated_mounts(self):
        command = prepare.initialize_command(self.target)
        self.assertEqual(command[command.index('--network') + 1], 'none')
        mounts = [command[i + 1] for i, value in enumerate(command) if value == '-v']
        self.assertEqual(mounts, [self.target.as_posix() + ':/state',
                         (ROOT / 'world/survival').as_posix() + ':/survival:ro'])
        self.assertEqual(command[-2:], [prepare.IMAGE, '/survival/init_runtime.py'])
        self.assertNotIn('-p', command)

    def test_body_binding_is_read_from_validated_settings(self):
        self.assertEqual(self.call_prepare()['bodyName'], 'Kirito')
        for name in ('../Kirito', 'Kirito execute', '桐人', '', 'x' * 17, None):
            with self.subTest(name=name):
                prepare.write_private(self.settings, {'bodyName': name})
                with self.assertRaisesRegex(ValueError, 'invalid_body_name'):
                    self.call_prepare(execute=True, run=self.runner)
                self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
