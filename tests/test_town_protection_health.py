import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('town_health', ROOT/'tools/town_protection_health.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class TownProtectionHealthTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        (self.root/'tools').mkdir()
        shutil.copyfile(ROOT/'tools/world_interaction_health.py', self.root/'tools/world_interaction_health.py')
        sources = ('tools/build_irons_bridge.py',
                   'world/irons-bridge-src/src/dev/qiandeng/irons/TownProtection.java',
                   'world/irons-bridge-src/src/dev/qiandeng/irons/TownProtectionPolicy.java',
                   'world/irons-bridge-src/src/dev/qiandeng/irons/TownBlockMask.java', probe.MASK)
        self.sha = hashlib.sha256(b'fixture').hexdigest()
        for name in (*sources, probe.JAR, probe.NUMEN, 'world/irons-bridge-src/build/qiandeng-irons-bridge-0.1.0.jar'):
            path = self.root/name; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'fixture')
        self.write(probe.MASK, {'blocks': 123})
        self.mask_sha = hashlib.sha256((self.root/probe.MASK).read_bytes()).hexdigest()
        self.write(probe.BUILD, {'ok': True, 'sha256': self.sha,
                                'dependencies': {Path(probe.NUMEN).name:self.sha},
                                'sources': dict(dict.fromkeys(sources, self.sha), **{probe.MASK: self.mask_sha})})
        self.write('manifests/server-extensions.lock.json', {'schema_version': 1,
                    'files': [{'path': probe.JAR, 'sha256': self.sha}]})
        self.smoke = {'ok': True, 'environment': 'isolated_native_qa',
                      'candidateSha256': self.sha, 'numenSha256':self.sha, 'checks': dict.fromkeys(probe.BEHAVIOR, True)}
        self.write(probe.SMOKE, self.smoke)

    def write(self, name, value):
        path = self.root/name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf8')

    def check(self, reply=None):
        return probe.check(self.root, lambda: dict(probe.EXPECTED, maskSha256=self.mask_sha, protectedBlocks=123) if reply is None else reply)

    def test_current_evidence_is_read_only(self):
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.check()
        self.assertTrue(result['ok'])
        self.assertEqual((result['modelRequests'], result['worldActions']), (0, 0))
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_wrong_boundary_type_bypass_or_malformed_status_is_red(self):
        for wrong in ({'minX': -716}, {'allY': 1}, {'manualOpBypass': True}, {'schema': True}):
            with self.subTest(wrong=wrong):
                self.assertFalse(self.check(dict(probe.EXPECTED, **wrong))['ok'])
        for malformed in ([], 'healthy', False):
            self.assertFalse(self.check(malformed)['ok'])

    def test_other_build_or_missing_real_behavior_cannot_pass(self):
        for changes in ({'candidateSha256': '0'*64}, {'numenSha256':'1'*64}, {'environment': 'offline'},
                        {'checks': dict(self.smoke['checks'], **{'fire-blocked': False})}):
            with self.subTest(changes=changes):
                self.write(probe.SMOKE, dict(self.smoke, **changes))
                self.assertFalse(self.check()['checks']['native_qa_matches_artifact'])

    def test_changed_installed_or_source_bytes_are_red(self):
        (self.root/probe.JAR).write_bytes(b'other')
        self.assertFalse(self.check()['checks']['artifact_and_sources_current'])
        (self.root/probe.JAR).write_bytes(b'fixture')
        (self.root/'tools/build_irons_bridge.py').write_bytes(b'changed source')
        self.assertFalse(self.check()['checks']['artifact_and_sources_current'])


if __name__ == '__main__':
    unittest.main()
