"""Offline migration: preserve current IDs/models/enablement/history, never live Docker/MC."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('configure_maid_bridge_test', ROOT / 'tools/configure_maid_bridge.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MaidBridgeMigrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.target = self.root / 'server/mc/config/touhou_little_maid/sites/llm.json'
        self.target.parent.mkdir(parents=True)
        self.old = {name: {'id': name, 'api_type': 'openai', 'enabled': index == 1,
            'icon': migration.ICON, 'url': 'http://old.invalid/private', 'secret_key': 'fixture-private-old-token',
            'headers': {'X-Old': 'fixture-private-header'}, 'models': ['existing-model', {'name': 'reasoning-label', 'reasoning': True}],
            'unknown_previous_field': 'preserve-only-in-backup'}
            for index, name in enumerate(['legacy-a', 'codingplan', *['legacy-' + str(n) for n in range(12)]])}
        self.write()
        self.key = self.root / 'server/mc/config/qiandeng_maid_bridge/identity.key'
        self.history = self.root / 'server/mc/shadow/entities/r.0.0.mca'
        self.history.parent.mkdir(parents=True)
        self.history.write_bytes(b'fixture-old-maid-uuid-owner-persona-history-unchanged')

    def write(self):
        self.target.write_text(json.dumps(self.old), encoding='utf8')

    def apply(self, ensure_stopped=lambda: None):
        return migration.configure(self.root, True, ensure_stopped)

    def test_check_is_read_only_and_does_not_need_docker(self):
        before = self.target.read_bytes()
        result = migration.configure(self.root)
        self.assertTrue(result['identityKeyNeeded'])
        self.assertEqual(before, self.target.read_bytes())
        self.assertFalse(self.key.exists())
        self.assertFalse((self.root / 'runtime').exists())

    def test_preserves_fourteen_ids_enabled_models_and_world_bytes(self):
        before = self.target.read_bytes(), self.history.read_bytes()
        result = self.apply()
        current = json.loads(self.target.read_text('utf8'))
        self.assertEqual(set(current), set(self.old))
        self.assertEqual(len(current), 14)
        for name, row in current.items():
            self.assertEqual(row['models'], self.old[name]['models'])
            self.assertEqual(row['enabled'], self.old[name]['enabled'])
            self.assertEqual(row['api_type'], migration.TYPE)
            self.assertEqual(row['url'], migration.URL)
            self.assertEqual(row['headers'], {})
            self.assertEqual(row['secret_key'], '')
        self.assertEqual((Path(result['backup']) / 'maid-llm.json').read_bytes(), before[0])
        self.assertEqual(self.history.read_bytes(), before[1])
        self.assertEqual(len(self.key.read_text('ascii')), 64)
        self.assertNotIn('fixture-private', json.dumps(result))
        self.assertNotIn(self.key.read_text('ascii'), json.dumps(result))

    def test_idempotent_sync_keeps_key_and_user_model_edits(self):
        self.apply()
        self.old = json.loads(self.target.read_text('utf8'))
        self.old['codingplan']['models'] = ['user-changed-label']
        self.write()
        before = self.target.read_bytes(), self.key.read_bytes(), self.history.read_bytes()
        result = self.apply()
        self.assertFalse(result['changed'])
        self.assertEqual(before, (self.target.read_bytes(), self.key.read_bytes(), self.history.read_bytes()))

    def test_running_server_guard_prevents_all_writes(self):
        before = self.target.read_bytes()
        def running():
            raise ValueError('stop_qiandengji_mc_before_site_migration')
        with self.assertRaisesRegex(ValueError, 'stop_qiandengji'):
            self.apply(running)
        self.assertEqual(before, self.target.read_bytes())
        self.assertFalse(self.key.exists())
        self.assertFalse((self.root / 'runtime').exists())

    def test_existing_key_preserved_and_invalid_key_fails_closed(self):
        self.key.parent.mkdir(parents=True)
        self.key.write_text('existing-fixture-key-' * 3, encoding='ascii')
        before = self.key.read_bytes()
        self.apply()
        self.assertEqual(before, self.key.read_bytes())
        self.key.write_text('short', encoding='ascii')
        with self.assertRaisesRegex(ValueError, 'invalid_existing_identity_key'):
            self.apply()

    def test_unknown_protocol_missing_icon_or_wrong_enabled_are_rejected(self):
        for key, value in [('api_type', 'unreviewed-service'), ('icon', None), ('enabled', 'true')]:
            with self.subTest(key=key):
                saved = self.old['codingplan'][key]
                self.old['codingplan'][key] = value
                self.write()
                before = self.target.read_bytes()
                with self.assertRaises(ValueError):
                    self.apply()
                self.assertEqual(before, self.target.read_bytes())
                self.old['codingplan'][key] = saved

    def test_native_codec_invalid_model_object_and_duplicates_are_rejected(self):
        for models in ([{'name': 'x', 'reasoning': 'true'}], ['same', 'same'], []):
            with self.subTest(models=models):
                self.old['codingplan']['models'] = models
                self.write()
                with self.assertRaises(ValueError):
                    self.apply()

    def test_concurrent_config_change_is_not_overwritten(self):
        edited = b'{"editor":"wins"}'
        def changed():
            self.target.write_bytes(edited)
        with self.assertRaisesRegex(ValueError, 'site_config_changed'):
            self.apply(changed)
        self.assertEqual(self.target.read_bytes(), edited)
        self.assertFalse(self.key.exists())


if __name__ == '__main__':
    unittest.main()
