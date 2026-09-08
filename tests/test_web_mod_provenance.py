import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('web_provenance', ROOT/'tools/refresh_web_mod_provenance.py')
tool = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(tool)


class WebProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.now = 10000
        (self.root/'client/mods').mkdir(parents=True)
        self.jar = 'server/mc/mods/demo.jar'; self.old = 'runtime/old.jar'
        self.archive(self.old, 'old'); self.archive(self.jar, 'new')
        self.registry = {'minecraftVersion': '1.21.1', 'generatedAt': (self.now-20)*1000,
            'blocks': [{'name': 'minecraft:stone'}], 'blockStates': [{'stateId': 1, 'block': 'minecraft:stone'}]}
        self.write(tool.MIRROR, self.registry)
        self.write(tool.EXPORT, {**self.registry, 'generatedAt': self.now*1000})
        h = tool.file_hash(self.root/tool.MIRROR)
        canonical = 'world/node_modules/minecraft-data/minecraft-data/data/pc/1.21.1/blocks.json'
        self.write(canonical, [{'name': 'stone'}])
        for name in tool.VISUALS: self.write(name, {'untouched': True})
        self.write(tool.VISUALS[2], {'registrySha256': h, 'canonicalBlocksSha256': tool.file_hash(self.root/canonical)})
        self.write(tool.REPORT, {'schema': 1, 'generatedAt': 123, 'actualBrowserRenderTested': False,
            'registry': {'sha256': h, 'mirrorSha256': h, 'path': tool.EXPORT, 'generatedAt': self.registry['generatedAt']},
            'jars': [{'sha256': tool.file_hash(self.root/self.old), 'paths': [self.jar], 'sides': ['server'],
                'mods': [{'id': 'demo'}], 'assetCounts': {'models': 1}, 'zipVerified': True}],
            'jarCounts': {'server': 1, 'client': 0}})

    def write(self, name, value):
        p = self.root/name; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(value), encoding='utf8')

    def archive(self, name, code, resource='{"parent":"stone"}', nested=b'nested jar unchanged'):
        p = self.root/name; p.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('demo/Entry.class', code)
            z.writestr('assets/demo/models/block/a.json', resource)
            z.writestr('META-INF/jarjar/api.jar', nested)

    def prepare(self): return tool.prepare(self.root, [self.old], self.now)

    def test_class_only_patch_refreshes_provenance_without_visual_writes(self):
        updated, audit, guards = self.prepare()
        visuals = {name: (self.root/name).read_bytes() for name in tool.VISUALS}
        self.assertEqual(audit['changedUniqueJars'], 1)
        self.assertEqual(audit['resourceProofs'][0]['nonClassResourceCount'], 2)
        self.assertEqual(updated['generatedAt'], 123)
        self.assertFalse(updated['actualBrowserRenderTested'])
        backup = tool.apply(self.root, updated, audit, guards)
        self.assertTrue((self.root/backup/'compatibility-report.json').exists())
        self.assertEqual(visuals, {name: (self.root/name).read_bytes() for name in tool.VISUALS})
        self.assertEqual(tool.read(self.root, tool.REPORT)['jars'][0]['sha256'], tool.file_hash(self.root/self.jar))

    def test_render_resource_change_requires_full_build(self):
        self.archive(self.jar, 'new', resource='{"parent":"different"}')
        with self.assertRaisesRegex(ValueError, 'resources_changed'): self.prepare()

    def test_nested_jar_change_is_never_skipped(self):
        self.archive(self.jar, 'new', nested=b'changed embedded resources')
        with self.assertRaisesRegex(ValueError, 'resources_changed'): self.prepare()

    def test_state_change_even_with_same_counts_is_rejected(self):
        changed = dict(self.registry, generatedAt=self.now*1000,
            blockStates=[{'stateId': 1, 'block': 'minecraft:dirt'}])
        self.write(tool.EXPORT, changed)
        with self.assertRaisesRegex(ValueError, 'registry_changed'): self.prepare()

    def test_stale_export_is_rejected(self):
        self.write(tool.EXPORT, dict(self.registry, generatedAt=(self.now-601)*1000))
        with self.assertRaisesRegex(ValueError, 'fresh_native_registry'): self.prepare()

    def test_missing_exact_baseline_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'exact_old_jar_backup'):
            tool.prepare(self.root, [], self.now)

    def test_changed_mod_set_is_not_incremental(self):
        self.archive('client/mods/new.jar', 'new')
        with self.assertRaisesRegex(ValueError, 'mod_set_changed'): self.prepare()

    def test_concurrent_jar_change_blocks_write(self):
        updated, audit, guards = self.prepare()
        original = (self.root/tool.REPORT).read_bytes()
        self.archive(self.jar, 'changed again')
        with self.assertRaisesRegex(ValueError, 'input_changed'): tool.apply(self.root, updated, audit, guards)
        self.assertEqual((self.root/tool.REPORT).read_bytes(), original)

    def test_mapping_drift_is_rejected(self):
        mapping = tool.read(self.root, tool.VISUALS[2]); mapping['registrySha256'] = '0'*64
        self.write(tool.VISUALS[2], mapping)
        with self.assertRaisesRegex(ValueError, 'mapping_changed'): self.prepare()


if __name__ == '__main__': unittest.main()
