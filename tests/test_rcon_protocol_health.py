import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('rcon_protocol_health', ROOT / 'tools/rcon_protocol_health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class RconProtocolHealthTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        names = ['server/mc/mods/botgate.jar', 'world/botgate-src/tests/RconReplyQa.java',
                 'world/botgate-src/tests/RconConcurrentClient.java', 'tools/smoke_rcon_transaction.py',
                 *('world/botgate-src/' + name for name in health.SOURCES)]
        for name in names:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(name, 'utf-8')
        self.sha = lambda name: health.digest(self.root / name)
        jar = self.sha('server/mc/mods/botgate.jar')
        self.frames = {'ok': True, 'project': 'qiandengji', 'jarSha256': jar,
            'checks': [{'name': name, 'ok': True} for name in health.FRAME_CHECKS],
            'cleanup': {'uniqueStorageKeyRemoved': True}}
        self.transaction = {'ok': True, 'candidateSha256': jar,
            'checks': {name: True for name in health.TRANSACTION_CHECKS},
            'productionActions': 0, 'modelCalls': 0,
            'details': {'old': {'exact': 3}, 'new': {'exact': 96, 'total': 96}},
            'fixtureSha256': self.sha('world/botgate-src/tests/RconReplyQa.java'),
            'driverSha256': self.sha('world/botgate-src/tests/RconConcurrentClient.java'),
            'toolSha256': self.sha('tools/smoke_rcon_transaction.py')}
        self.build = {'sha256': jar, 'sources': {name: self.sha('world/botgate-src/' + name) for name in health.SOURCES}}
        self.write()

    def write(self):
        for name, value in [('reports/rcon-live-smoke.json', self.frames),
                            ('reports/rcon-transaction-smoke.json', self.transaction),
                            ('world/botgate-src/build-record.json', self.build)]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(value), 'utf-8')

    def test_exact_deployed_evidence(self):
        self.assertTrue(health.check(self.root)['ok'])

    def test_old_framing_success_cannot_cover_missing_transaction(self):
        (self.root / 'reports/rcon-transaction-smoke.json').unlink()
        report = health.check(self.root)
        self.assertTrue(report['checks']['framing_behavior_verified'])
        self.assertFalse(report['checks']['transaction_behavior_verified'])
        self.assertFalse(report['ok'])

    def test_failed_native_check_never_hidden_by_top_level_ok(self):
        for name in health.TRANSACTION_CHECKS:
            with self.subTest(name=name):
                self.transaction['checks'][name] = False
                self.write()
                self.assertFalse(health.check(self.root)['checks']['transaction_behavior_verified'])
                self.transaction['checks'][name] = True

    def test_new_jar_cannot_reuse_prior_report(self):
        (self.root / 'server/mc/mods/botgate.jar').write_bytes(b'newer-unverified')
        self.assertFalse(health.check(self.root)['checks']['deployed_jar_matches_both_behaviors'])

    def test_source_drift_rejected_without_editing_report(self):
        (self.root / 'world/botgate-src' / health.SOURCES[0]).write_bytes(b'changed')
        (self.root / 'world/botgate-src/tests/RconConcurrentClient.java').write_bytes(b'changed')
        report = health.check(self.root)
        self.assertFalse(report['checks']['transaction_implementation_sources_current'])
        self.assertFalse(report['checks']['transaction_fixture_sources_current'])

    def test_partial_concurrency_or_missing_cleanup_rejected(self):
        self.transaction['details']['new']['exact'] = 95
        self.frames['cleanup']['uniqueStorageKeyRemoved'] = False
        self.write()
        report = health.check(self.root)
        self.assertFalse(report['checks']['transaction_behavior_verified'])
        self.assertFalse(report['checks']['framing_behavior_verified'])


if __name__ == '__main__':
    unittest.main()
