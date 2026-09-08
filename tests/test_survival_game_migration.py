"""Offline migration preserves identity/accounting and never changes other roles."""
import base64
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('survivor_migration', ROOT / 'tools/migrate_survivor_to_game.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class SharedGameMigrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source, self.target, self.backups = [self.root / name for name in ('source', 'target', 'backups')]
        self.master_source, self.master_target = 'a1' * 32, 'b2' * 32
        self.key = 'fixture-key-not-live'
        cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(self.master_source)))
        self.provider = {'id': 'aliyun-codingplan', 'api_key': 'ENC:' + cipher.encrypt(self.key.encode()).decode(),
            'generate_kwargs': {'max_tokens': 2048}, 'extra_models': [{'id': 'qwen3.6-plus'}]}
        self.write(self.source / 'secret/providers/builtin/aliyun-codingplan.json', self.provider)
        (self.source / 'secret/.master_key').write_text(self.master_source)
        self.write(self.target / 'secret/providers/builtin/aliyun-codingplan.json',
                   {'api_key': 'UNCHANGED-CIPHERTEXT', 'generate_kwargs': {'max_tokens': 8192}})
        (self.target / 'secret/.master_key').write_text(self.master_target)
        self.source_role = self.source / 'work/workspaces/qd-survivor'
        self.write(self.source_role / 'agent.json', {'id': migration.ROLE, 'name': '桐人',
            'workspace_dir': '/state/work/workspaces/qd-survivor',
            'active_model': {'provider_id': 'aliyun-codingplan', 'model': 'qwen3.6-plus'}})
        self.write(self.source_role / 'sessions/console/keep.json', {'session': 'retain-tool-history'})
        self.write(self.source_role / 'chats.json', {'chats': ['retain-chat-index']})
        self.write(self.source_role / 'jobs.json', {'jobs': []})
        self.write(self.source / 'work/config.json', {'agents': {'profiles': {
            migration.ROLE: {'enabled': True}, 'default': {'enabled': False}}}})
        self.write(self.source / 'survival/control.json', {'schema': 1, 'enabled': False})
        self.write(self.source / 'survival/controller.json', {'schema': 1, 'active': None, 'decisions': [1, 2, 3]})
        self.write(self.source / 'survival/skills/craft/versions/v1.json', {'source': 'model-authored'})
        self.usage_key = 'qd-survivor\x1faliyun-codingplan\x1fqwen3.6-plus'
        self.source_usage = {'2026-09-08': {self.usage_key: {'agent_id': migration.ROLE,
            'provider_id': 'aliyun-codingplan', 'model_name': 'qwen3.6-plus', 'call_count': 51,
            'prompt_tokens': 544168, 'completion_tokens': 49537}}}
        self.target_usage = {'2026-09-08': {'old-game': {'call_count': 17, 'prompt_tokens': 200}}}
        self.write(self.source / 'work/token_usage.json', self.source_usage)
        self.write(self.target / 'work/token_usage.json', self.target_usage)
        self.target_config = {'agents': {'active_agent': 'mc-god', 'agent_order': ['mc-god', 'mc-herald'],
            'profiles': {'mc-god': {'enabled': True}, 'mc-herald': {'enabled': True}, 'default': {'enabled': False}}}}
        self.write(self.target / 'work/config.json', self.target_config)
        for aid, model in [('mc-god', 'glm-5.3-flash'), ('mc-herald', 'qwen3.5-plus')]:
            self.write(self.target / 'work/workspaces' / aid / 'agent.json', {'id': aid, 'active_model': model})
        self.calls = []

    def write(self, path, value):
        migration.write(path, value)

    def runner(self, args, **kwargs):
        self.calls.append(args)
        return SimpleNamespace(returncode=0, stdout='false\n')

    def migrate(self, **kwargs):
        return migration.migrate(self.source, self.target, self.backups, run=self.runner, **kwargs)

    def files(self, root):
        return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file()}

    def test_check_does_not_write_or_call_docker_or_expose_keys(self):
        before = self.files(self.root)
        result = self.migrate()
        self.assertEqual(result['preservedModelRequests'], 51)
        self.assertEqual(self.files(self.root), before)
        self.assertEqual(self.calls, [])
        self.assertNotIn(self.key, json.dumps(result))
        self.assertNotIn(self.provider['api_key'], json.dumps(result))

    def test_execute_preserves_sessions_learning_accounting_and_other_roles(self):
        before = self.files(self.target)
        body_before = self.files(self.source / 'survival')
        result = self.migrate(execute=True)
        after = self.files(self.target)
        for path, data in before.items():
            if path not in ('work/config.json', 'work/token_usage.json'):
                self.assertEqual(after[path], data, path)
        self.assertEqual(self.files(self.source / 'survival'), body_before)
        self.assertEqual(migration.read(self.target / 'work/workspaces/qd-survivor/chats.json'),
                         {'chats': ['retain-chat-index']})
        self.assertEqual(migration.read(self.target / 'work/token_usage.json')['2026-09-08'][self.usage_key],
                         self.source_usage['2026-09-08'][self.usage_key])
        provider = migration.read(self.target / 'secret/providers/custom/qd-survivor-codingplan.json')
        cipher = Fernet(base64.urlsafe_b64encode(bytes.fromhex(self.master_target)))
        self.assertEqual(cipher.decrypt(provider['api_key'][4:].encode()).decode(), self.key)
        self.assertNotEqual(provider['api_key'], self.provider['api_key'])
        config = migration.read(self.target / 'work/config.json')
        self.assertEqual(config['agents']['active_agent'], 'mc-god')
        self.assertEqual(config['agents']['agent_order'], ['mc-god', 'mc-herald', migration.ROLE])
        self.assertFalse(migration.read(self.source / 'work/config.json')['agents']['profiles'][migration.ROLE]['enabled'])
        backup = Path(result['backup'])
        self.assertEqual((backup / 'target/work/config.json').read_bytes(), before['work/config.json'])
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[0][-1], 'qiandengji-survivor-1')
        self.assertEqual(self.calls[1][-1], 'qiandengji-qwenpaw-1')
        self.assertNotIn(self.key, json.dumps(result))

    def test_second_execute_refuses_without_duplicate_usage_or_other_writes(self):
        self.migrate(execute=True)
        before = self.files(self.root)
        with self.assertRaisesRegex(ValueError, 'migration_already_recorded'):
            self.migrate(execute=True)
        self.assertEqual(self.files(self.root), before)

    def test_running_runtime_refuses_before_any_backup_or_change(self):
        before = self.files(self.root)
        def running(*args, **kwargs):
            return SimpleNamespace(returncode=0, stdout='true\n')
        with self.assertRaisesRegex(ValueError, 'runtime_must_be_stopped'):
            migration.migrate(self.source, self.target, self.backups, execute=True, run=running)
        self.assertEqual(self.files(self.root), before)

    def test_active_model_or_unknown_effect_prevents_migration(self):
        for path, value in [('controller.json', {'active': {'turnId': 'old'}}),
                            ('control.json', {'enabled': True}),
                            ('skill-job.json', {'status': 'dispatching'}),
                            ('unknown.json', {'actionId': 'unresolved'})]:
            with self.subTest(path=path):
                file = self.source / 'survival' / path
                original = file.read_bytes() if file.exists() else None
                self.write(file, value)
                before = self.files(self.root)
                with self.assertRaises(ValueError):
                    self.migrate(execute=True)
                self.assertEqual(self.files(self.root), before)
                if original is None:
                    file.unlink()
                else:
                    file.write_bytes(original)

    def test_collision_and_unscoped_usage_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'already_present'):
            migration.merge_usage(self.source_usage, self.source_usage)
        with self.assertRaisesRegex(ValueError, 'unscoped_source_usage'):
            migration.merge_usage({}, self.target_usage)

    def test_http_card_has_no_stdio_or_plain_credentials_and_exact_tool_policy(self):
        card = migration.http_card(migration.TOOL_NAMES)
        self.assertNotIn('command', card['endpoint'])
        self.assertEqual(card['policy']['default_effect'], 'deny')
        self.assertEqual([r['target']['name'] for r in card['policy']['rules']], list(migration.TOOL_NAMES))
        binding = card['endpoint']['headers']['Authorization']
        self.assertEqual(card['credentials'][binding['credential']]['ref'], 'env:SURVIVOR_MCP_TOKEN')
        self.assertNotIn(self.key, json.dumps(card))

    def test_sync_updates_only_prompt_and_tool_contract_preserving_user_model_choice(self):
        self.migrate(execute=True)
        folder = self.target / 'work/workspaces' / migration.ROLE
        agent = migration.read(folder / 'agent.json')
        agent['active_model'] = {'provider_id': 'user-changed', 'model': 'current-choice'}
        agent['mcp']['clients'][migration.DRIVER]['tools'] = ['status']
        self.write(folder / 'agent.json', agent)
        (folder / 'AGENTS.md').write_text('previous-prompt')
        before = self.files(self.root)
        result = migration.sync_role(self.source, self.target, self.backups, run=self.runner)
        after = self.files(self.root)
        changed = {name for name, content in before.items() if after[name] != content}
        self.assertEqual(changed, {'target/work/workspaces/qd-survivor/agent.json',
                                  'target/work/workspaces/qd-survivor/AGENTS.md'})
        saved = migration.read(folder / 'agent.json')
        self.assertEqual(saved['active_model'], agent['active_model'])
        self.assertEqual(saved['mcp']['clients'][migration.DRIVER]['tools'], list(migration.TOOL_NAMES))
        self.assertEqual((Path(result['backup']) / 'AGENTS.md').read_text(), 'previous-prompt')
        self.assertTrue(result['usagePreserved'])

    def test_sync_refuses_active_runtime_and_does_not_modify_any_file(self):
        self.migrate(execute=True)
        self.write(self.source / 'survival/control.json', {'enabled': True})
        before = self.files(self.root)
        with self.assertRaisesRegex(ValueError, 'paused_and_idle'):
            migration.sync_role(self.source, self.target, self.backups, run=self.runner)
        self.assertEqual(self.files(self.root), before)


if __name__ == '__main__':
    unittest.main()
