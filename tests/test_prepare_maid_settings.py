import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_maid_settings_tests', ROOT / 'tools/prepare_maid_settings.py')
prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)


class NativeSettingsPreparation(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.maids = [{'modelId': 'fixture:existing', 'ownerUuid': None}, {'modelId': 'fixture:missing', 'ownerUuid': 'owned'}]
        self.settings = self.root / 'server/mc/config/touhou_little_maid/settings'; self.settings.mkdir(parents=True)
        self.existing = self.settings / 'owner-persona.yml'
        self.existing.write_text('meta:\n  model_id: ["fixture:existing"]\nsetting: private-original-persona\n', 'utf8')

    def build(self):
        with patch.object(prepare, 'saved_maids', return_value=(self.maids, [])):
            plan, _ = prepare.candidate(self.root)
        path = self.root / 'runtime/plan.json'; path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(plan), 'utf8')
        return plan, path

    def test_only_used_missing_models_are_proposed_and_persona_body_not_exported(self):
        plan, _ = self.build()
        self.assertEqual(plan['missingModels'], ['fixture:missing'])
        self.assertNotIn('private-original-persona', json.dumps(plan))
        self.assertEqual(len(list(self.settings.glob('*.yml'))), 1)

    def test_apply_requires_stopped_and_preserves_existing_bytes(self):
        original = self.existing.read_bytes(); plan, path = self.build()
        with patch.object(prepare, 'saved_maids', return_value=(self.maids, [])):
            with self.assertRaisesRegex(ValueError, 'still_running'):
                prepare.apply_plan(self.root, path, lambda: (_ for _ in ()).throw(ValueError('still_running')))
            result = prepare.apply_plan(self.root, path, lambda: None)
        self.assertEqual(result['settingsCreated'], 1)
        self.assertEqual(self.existing.read_bytes(), original)
        models, _ = prepare.native_models(self.root)
        self.assertEqual(models, {'fixture:existing', 'fixture:missing'})

    def test_concurrent_existing_target_is_never_overwritten(self):
        plan, path = self.build(); target = self.root / plan['entries'][0]['target']
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('meta:\n  model_id: ["fixture:unrelated"]\nsetting: concurrent-owner-content\n', 'utf8')
        original = target.read_bytes()
        with patch.object(prepare, 'saved_maids', return_value=(self.maids, [])):
            with self.assertRaisesRegex(ValueError, 'existing_setting_target'):
                prepare.apply_plan(self.root, path, lambda: None)
        self.assertEqual(target.read_bytes(), original)

    def test_modified_candidate_payload_is_rejected(self):
        plan, path = self.build(); plan['entries'][0]['content'] = 'unexpected override'
        path.write_text(json.dumps(plan), 'utf8')
        with patch.object(prepare, 'saved_maids', return_value=(self.maids, [])):
            with self.assertRaisesRegex(ValueError, 'candidate_changed'):
                prepare.apply_plan(self.root, path, lambda: None)
        self.assertEqual(len(list(self.settings.glob('*.yml'))), 1)

    def test_loaded_owned_identity_cannot_be_exported_as_unloaded(self):
        from types import SimpleNamespace
        row = {'maidUuid': '12345678-1234-1234-1234-123456789abc', 'dimension': 'minecraft:overworld'}
        with patch.object(prepare.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='actual entity UUID data')):
            with self.assertRaisesRegex(ValueError, 'unloaded_status_not_confirmed'):
                prepare.confirm_owned_unloaded(row)
        with patch.object(prepare.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='No entity was found')):
            prepare.confirm_owned_unloaded(row)

    def legacy_plan(self):
        plan, path = self.build()
        for entry in plan['entries']:
            name = Path(entry['target']).name
            entry['target'] = (prepare.LEGACY_SETTINGS / name).as_posix()
            (self.root / entry['target']).write_bytes(entry['content'].encode('utf8'))
        path.write_text(json.dumps(plan), 'utf8')
        return plan, path

    def test_native_pack_persistence_survives_config_exclusion_without_overwrites(self):
        plan, path = self.legacy_plan()
        source = self.root / plan['entries'][0]['target']; before = source.read_bytes()
        original_persona = self.existing.read_bytes()
        result = prepare.persist_generated(self.root, path)
        self.assertEqual(result['settingsCreated'], 1)
        self.assertEqual(result['nativeReloadCommand'], 'tlm pack reload')
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(self.existing.read_bytes(), original_persona)
        target = self.root / prepare.PACK_SETTINGS / source.name
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(prepare.persist_generated(self.root, path)['settingsCreated'], 0)

    def test_modified_legacy_personality_is_not_copied_or_overwritten(self):
        plan, path = self.legacy_plan()
        source = self.root / plan['entries'][0]['target']
        source.write_text('User edited personality', 'utf8')
        with self.assertRaisesRegex(ValueError, 'changed_preserve_owner_content'):
            prepare.persist_generated(self.root, path)
        self.assertFalse((self.root / prepare.PACK_SETTINGS).exists())
        self.assertEqual(source.read_text('utf8'), 'User edited personality')

    def test_existing_pack_personality_cannot_be_replaced_by_generic(self):
        plan, path = self.legacy_plan()
        target = self.root / prepare.PACK_SETTINGS / Path(plan['entries'][0]['target']).name
        target.parent.mkdir(parents=True)
        target.write_text('Existing pack personality', 'utf8')
        with self.assertRaisesRegex(ValueError, 'existing_pack_setting_requires_review'):
            prepare.persist_generated(self.root, path)
        self.assertEqual(target.read_text('utf8'), 'Existing pack personality')

    def test_new_candidates_use_native_pack_reader_location(self):
        plan, _ = self.build()
        self.assertTrue(all(row['target'].startswith(prepare.PACK_SETTINGS.as_posix() + '/') for row in plan['entries']))


if __name__ == '__main__': unittest.main()
