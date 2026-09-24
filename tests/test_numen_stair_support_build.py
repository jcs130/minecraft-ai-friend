"""Parent identity guards for the one-class stair overlay (no game or Java needed)."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location(
    'stair_builder', ROOT / 'tools/build_numen_stair_support.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class StairBuildIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.jar = Path(temporary.name) / 'parent.jar'
        self.class_name = 'owned/CellClass.class'
        with zipfile.ZipFile(self.jar, 'w') as archive:
            archive.writestr(self.class_name, b'original class')
            archive.writestr('other/BodyRestore.class', b'keep body restoration')
        self.manifest = {
            'baselineJarSha256': builder.common.sha(self.jar.read_bytes()),
            'baselineClassHashes': {
                self.class_name: builder.common.sha(b'original class')},
        }

    def test_verified_bytes_are_the_exact_parent(self):
        self.assertEqual(builder.verified_parent_bytes(self.jar, self.manifest),
                         self.jar.read_bytes())

    def test_other_fork_is_rejected_before_build(self):
        with zipfile.ZipFile(self.jar, 'a') as archive:
            archive.writestr('other/Autonomy.class', b'a different installed fork')
        with self.assertRaisesRegex(ValueError, 'exact_deployed_parent_required'):
            builder.verified_parent_bytes(self.jar, self.manifest)

    def test_duplicate_class_is_rejected_even_when_whole_jar_hash_matches(self):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.jar, 'a') as archive:
                archive.writestr(self.class_name, b'shadowed class')
        self.manifest['baselineJarSha256'] = builder.common.sha(self.jar.read_bytes())
        with self.assertRaisesRegex(ValueError, 'invalid_parent_jar'):
            builder.verified_parent_bytes(self.jar, self.manifest)

    def test_class_preimage_must_match_as_well_as_jar(self):
        self.manifest['baselineClassHashes'][self.class_name] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'deployed_class_mismatch'):
            builder.verified_parent_bytes(self.jar, self.manifest)

    def test_published_patch_is_pinned_to_one_source_and_class(self):
        manifest = json.loads(builder.MANIFEST.read_bytes())
        self.assertEqual(builder.common.sha(builder.PATCH.read_bytes()),
                         manifest['patchSha256'])
        self.assertEqual(builder.common.sha(builder.common.normalized(
            ROOT / manifest['sourceFile'])), manifest['sourceSha256'])
        self.assertEqual(manifest['classFamilies'],
                         ['com/dwinovo/numen/core/pathing/spec/CellClass'])
        self.assertEqual(set(manifest['baselineClassHashes']),
                         {manifest['classFamilies'][0] + '.class'})


if __name__ == '__main__':
    unittest.main()
