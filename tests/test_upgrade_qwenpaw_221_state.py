"""Narrow migration refuses unknown edits and preserves unrelated state bytes."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'world/ops'))
spec = importlib.util.spec_from_file_location('upgrade221', ROOT/'tools/upgrade_qwenpaw_221_state.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class Upgrade221Tests(unittest.TestCase):
    def test_exact_prompt_replacement_retains_persona_unknown_text_and_crlf(self):
        marker = '用户补充的人设、记忆和职责不得重建。'.encode()
        raw = marker + b'\r\n' + b'\r\n'.join(old.encode() for old, _ in migration.PROMPT_REPLACEMENTS) + b'\r\n'
        actual = migration.prompt_bytes(raw)
        self.assertEqual(actual, marker + b'\r\n' + b'\r\n'.join(new.encode() for _, new in migration.PROMPT_REPLACEMENTS) + b'\r\n')
        self.assertEqual(migration.prompt_bytes(actual), actual)
        for altered in (raw.replace(migration.PROMPT_REPLACEMENTS[0][0].encode(), b'custom edited sentence'),
                        raw + migration.PROMPT_REPLACEMENTS[0][0].encode(),
                        raw + migration.PROMPT_REPLACEMENTS[0][1].encode()):
            with self.assertRaisesRegex(ValueError, 'prompt_shape'):
                migration.prompt_bytes(altered)

    def test_profile_never_changes_model_learning_running_or_unknown_fields(self):
        import native_role_capabilities as native
        before = {'id': 'qd-survivor', 'workspace_dir': '/state/work/workspaces/qd-survivor',
                  'active_model': {'provider_id': 'original', 'model': 'original-model'},
                  'running': {'reme_light_memory_config': {'auto_memory_interval': 5}},
                  'futureUnknown': {'keep': [1, 2]}, 'tools': {}, 'security': {}, 'approval_level': 'AUTO'}
        proposed = deepcopy(before); proposed['tools'] = {'new-native-tool': True}
        old_sha = migration.sha(migration.canonical({key: before.get(key) for key in migration.NATIVE_FIELDS}))
        with patch.dict(migration.OLD_NATIVE_SHA, {'qd-survivor': old_sha}), \
                patch.object(native, 'configure_native', return_value=proposed), \
                patch.object(native, 'validate_native'):
            self.assertEqual(migration.propose_profile(before, 'qd-survivor'), proposed)
            for field in ('active_model', 'running', 'futureUnknown'):
                changed = deepcopy(proposed); changed[field] = {}
                with patch.object(native, 'configure_native', return_value=changed), self.assertRaisesRegex(ValueError, 'unrelated_profile'):
                    migration.propose_profile(before, 'qd-survivor')
            edited = deepcopy(before); edited['security'] = {'userChanged': True}
            with self.assertRaisesRegex(ValueError, 'unreviewed_native_role'):
                migration.propose_profile(edited, 'qd-survivor')

    def test_manifest_user_settings_and_unknown_fields_survive_native_metadata_refresh(self):
        original_entry = {'enabled': False, 'channels': ['console'], 'config': {'favorite': 'crafting'},
                          'source': 'customized', 'installed_from': 'original', 'tags': ['user'],
                          'unknownPreference': {'doNotDrop': True}, 'updated_at': 'old', 'metadata': {'old': True}}
        before = {'schema_version': 'unchanged', 'skills': {'evolution': original_entry, 'learned': {'keep': True}}}
        after = deepcopy(before)
        after['skills']['evolution'] = {'enabled': True, 'channels': ['all'], 'config': {},
                                       'preload': False, 'source': 'customized', 'updated_at': 'new',
                                       'metadata': {'new': True}, 'requirements': {'require_bins': []}}
        result = migration.preserve_manifest_settings(before, after, ['evolution'])
        expected = deepcopy(original_entry)
        expected.update(updated_at='new', metadata={'new': True}, requirements={'require_bins': []})
        self.assertEqual(result['skills']['evolution'], expected)
        self.assertEqual(result['skills']['learned'], before['skills']['learned'])
        after['skills']['learned'] = {'keep': False}
        with self.assertRaisesRegex(ValueError, 'unrelated_skill_manifest'):
            migration.preserve_manifest_settings(before, after, ['evolution'])

    def test_file_allowlist_does_not_cover_history_jobs_persona_or_other_skills(self):
        for relative in ('config.json', 'workspaces/qd-survivor/agent.json',
                         'workspaces/5swvhK/skills/make-skill/scripts/create_plan.py',
                         'skill_pool/make-skill/SKILL.md'):
            self.assertTrue(migration.allowed_path(relative))
        for relative in ('workspaces/qd-survivor/jobs.json', 'workspaces/5swvhK/SOUL.md',
                         'workspaces/qd-survivor/sessions/life.json', 'workspaces/qd-survivor/memory/day.md',
                         'workspaces/qd-survivor/skills/qd-skill-evolution/references/notes.md',
                         'workspaces/qd-survivor/skills/custom-skill/SKILL.md', 'providers.json',
                         'workspaces/default/agent.json'):
            self.assertFalse(migration.allowed_path(relative), relative)

    def test_native_manifest_version_and_official_origin_are_precisely_scoped(self):
        before = {'schema_version': 'workspace-skill-manifest.v1', 'version': 100,
                  'unknownRoot': {'keep': True}, 'skills': {'make-skill': {'enabled': False,
                    'installed_from': 'qwenpaw:2.2.0:make-skill-zh', 'customPreference': 7}}}
        after = deepcopy(before); after['version'] = 200
        result = migration.preserve_manifest_settings(before, after, ['make-skill'],
            native_origins={'make-skill': 'qwenpaw:2.2.1:make-skill-zh'})
        self.assertEqual(result['version'], 200)
        self.assertEqual(result['skills']['make-skill'], {'enabled': False, 'customPreference': 7,
            'installed_from': 'qwenpaw:2.2.1:make-skill-zh'})
        for key, value in (('version', 99), ('version', True), ('schema_version', 'other'),
                           ('unknownRoot', {'keep': False}), ('newUnknownRoot', 'unreviewed')):
            changed = deepcopy(after); changed[key] = value
            with self.assertRaisesRegex(ValueError, 'manifest_root_changed'):
                migration.preserve_manifest_settings(before, changed, ['make-skill'])

    def test_byte_inventory_detects_new_deleted_and_modified_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder/'first').write_bytes(b'original\r\n')
            (folder/'deleted').write_bytes(b'do not drop')
            before = migration.inventory(folder)
            (folder/'first').write_bytes(b'changed\n')
            (folder/'deleted').unlink()
            (folder/'extra').write_bytes(b'new')
            self.assertEqual(migration.changed_files(before, migration.inventory(folder)), ['deleted', 'extra', 'first'])


if __name__ == '__main__':
    unittest.main()
