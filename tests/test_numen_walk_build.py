"""Artifact identity and preservation tests for the native walking patch builder."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('walk_builder', ROOT/'tools/build_numen_walk_only.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class WalkBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_overlay_preserves_other_mod_features_and_removes_obsolete_family_classes(self):
        baseline, target, classes = self.root/'old.jar', self.root/'new.jar', self.root/'classes'
        (classes/'owned').mkdir(parents=True)
        (classes/'owned/Move.class').write_bytes(b'new class')
        with zipfile.ZipFile(baseline, 'w') as archive:
            archive.writestr('owned/Move.class', b'old class')
            archive.writestr('owned/Move$Old.class', b'old inner class')
            archive.writestr('foreign/SkillBridge.class', b'existing skills')
            archive.writestr('META-INF/jarjar/numen_api.jar', b'original native API')
            archive.writestr('assets/ysm.png', b'original model')
        result = builder.overlay_jar(baseline, classes, target, {'owned/Move'})
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(archive.read('owned/Move.class'), b'new class')
            self.assertNotIn('owned/Move$Old.class', archive.namelist())
            self.assertEqual(archive.read('foreign/SkillBridge.class'), b'existing skills')
            self.assertEqual(archive.read('META-INF/jarjar/numen_api.jar'), b'original native API')
            self.assertEqual(archive.read('assets/ysm.png'), b'original model')
        self.assertEqual(result['preservedEntries'], 3)

    def test_unexpected_class_cannot_enter_overlay(self):
        classes = self.root/'classes'
        classes.mkdir()
        (classes/'Unrelated.class').write_bytes(b'x')
        with self.assertRaisesRegex(ValueError, 'unexpected_compiled_class'):
            builder.overlay_jar(self.root/'old.jar', classes, self.root/'new.jar', {'Expected'})

    def test_wrong_source_and_existing_new_file_are_rejected(self):
        (self.root/'Existing.java').write_text('known\n', encoding='utf8')
        manifest = {'preimages': {'Existing.java': builder.sha(b'known\n'), 'New.java': None}}
        builder.verify_sources(self.root, manifest)
        (self.root/'Existing.java').write_text('another fork\n', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'source_baseline_mismatch'):
            builder.verify_sources(self.root, manifest)
        (self.root/'Existing.java').write_text('known\n', encoding='utf8')
        (self.root/'New.java').write_text('unrelated\n', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'new_source_already_exists'):
            builder.verify_sources(self.root, manifest)

    def test_source_traversal_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'source_path_invalid'):
            builder.verify_sources(self.root, {'preimages': {'../outside': None}})

    def test_published_patch_and_source_manifest_are_consistent(self):
        directory = ROOT/'world/numen-patches'
        manifest = json.loads((directory/'walk-only-v1.json').read_text(encoding='utf8'))
        self.assertEqual(builder.sha((directory/'walk-only-v1.patch').read_bytes()), manifest['patchSha256'])
        self.assertEqual(set(manifest['preimages']), set(manifest['postimages']))
        self.assertEqual(manifest['baselineJarSha256'], '3a9af5420a5d40dcd6a24dd906d43fe4f67f25eea8ab6a082153bdcde7fae7af')

    def test_existing_restore_overlay_is_scoped_to_core_entry_and_command(self):
        directory = ROOT/'world/numen-patches'
        manifest = json.loads((directory/'restore-existing-v1.json').read_text(encoding='utf8'))
        source = directory/'restore-src/com/dwinovo/numen/core/entity/ExistingBodyRestore.java'
        self.assertEqual(builder.sha(builder.normalized(source)), manifest['restoreSourceSha256'])
        self.assertEqual(set(manifest['classFamilies']), {'com/dwinovo/numen/core/NumenCoreNeoForge',
                                                        'com/dwinovo/numen/core/entity/ExistingBodyRestore'})
        self.assertEqual(manifest['baselineJarSha256'], 'c86f8e26593624e0071d9e0fe95d5b09ca9c03811ea57a9c4881efd2e829c7ba')
        self.assertNotIn('Companions.summon(', source.read_text(encoding='utf8'))
        self.assertNotIn('UUID.randomUUID(', source.read_text(encoding='utf8'))


if __name__ == '__main__':
    unittest.main()
