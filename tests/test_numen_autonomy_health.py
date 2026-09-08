import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('numen_autonomy_probe', ROOT/'tools/numen_autonomy_health.py')
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class NumenAutonomyHealthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.now = 1788880000.0
        self.identity = {'bodyUuid': 'd4ac9523-4962-43ed-98c5-19b49e104048',
            'ownerUuid': 'e5005711-be9f-44b7-aaad-6993c0ba5df4', 'bodyName': 'Kirito'}
        self.write('server/survival-agent-state/survival/settings.json', self.identity)
        self.write(probe.CONFIG, {'schema': 1, 'enabled': True, 'bodies': [self.identity]})
        artifact = self.root/probe.JAR; artifact.parent.mkdir(parents=True); artifact.write_bytes(b'candidate')
        sources = {}
        for name in ('world/numen-patches/autonomous-src/AutonomousBodyTick.java',
                     'tools/build_numen_autonomous_tick.py',
                     'world/numen-patches/tests/AutonomousTickPolicyTest.java'):
            path = self.root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(name.encode())
            sources[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.record = {'ok': True, 'capability': probe.CAPABILITY, 'sha256': hashlib.sha256(b'candidate').hexdigest(),
            'sourceFiles': sources}
        self.write(probe.BUILD_RECORD, self.record)
        self.first = {'schema': 1, 'capability': probe.CAPABILITY,
            'configValid': True, 'configEnabled': True,
            'configSha256': hashlib.sha256((self.root/probe.CONFIG).read_bytes()).hexdigest(),
            'nativePadEnabled': True, 'nativePadRadius': 2, 'nativePadTimeoutTicks': 40,
            'nativePadRefreshTicks': 20, 'serverTick': 1000, 'observedAt': self.now*1000-1000,
            'bodies': [{**self.identity, 'online': True, 'eligible': True, 'identityValid': True,
                'ownerOnline': False, 'entityTicking': True, 'bodyTickCount': 300,
                'dimension': 'minecraft:overworld', 'lastRefreshServerTick': 990}]}
        self.second = copy.deepcopy(self.first)
        self.second.update(serverTick=1015, observedAt=self.now*1000)
        self.second['bodies'][0]['bodyTickCount'] = 315

    def write(self, name, value):
        path = self.root/name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf8')

    def check(self):
        samples = iter([self.first, self.second]); pauses = []
        result = probe.check(self.root, lambda: next(samples), pauses.append, lambda: self.now)
        self.assertEqual(pauses, [0.75])
        return result

    def test_two_real_tick_samples_pass_without_writes_or_public_identity(self):
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.check()
        self.assertTrue(result['ok']); self.assertEqual(result['evidence']['bodyTicksAdvanced'], 15)
        self.assertNotIn(self.identity['bodyUuid'], json.dumps(result))
        self.assertEqual(result['worldActions'], 0); self.assertEqual(result['modelRequests'], 0)
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_online_brain_with_frozen_physics_is_not_healthy(self):
        for status in (self.first, self.second): status['bodies'][0]['entityTicking'] = False
        self.second['bodies'][0]['bodyTickCount'] = 300
        result = self.check(); self.assertFalse(result['ok'])
        self.assertFalse(result['checks']['entity_ticking']); self.assertFalse(result['checks']['body_tick_progress'])

    def test_entity_ticking_flag_without_progress_is_not_enough(self):
        self.second['bodies'][0]['bodyTickCount'] = 300
        self.assertFalse(self.check()['checks']['body_tick_progress'])

    def test_stale_or_replayed_samples_fail(self):
        self.second = copy.deepcopy(self.first)
        self.assertFalse(self.check()['ok'])
        self.first['observedAt'] -= 60000
        self.assertFalse(self.check()['checks']['native_policy_loaded'])

    def test_restarted_server_or_replaced_body_counter_is_not_progress(self):
        self.second['serverTick'] = 10
        self.assertFalse(self.check()['checks']['body_tick_progress'])
        self.second['serverTick'] = 1015; self.second['bodies'][0]['bodyTickCount'] = 1
        self.assertFalse(self.check()['checks']['body_tick_progress'])

    def test_owner_online_can_use_native_path_only_when_identity_valid(self):
        for status in (self.first, self.second):
            status['bodies'][0].update(ownerOnline=True, eligible=False)
        self.assertTrue(self.check()['ok'])
        self.second['bodies'][0]['identityValid'] = False
        self.assertFalse(self.check()['ok'])

    def test_body_or_owner_mismatch_is_not_authorized(self):
        self.second['bodies'][0]['ownerUuid'] = '29c7f3a6-e1e8-4860-827b-117d02574530'
        self.assertFalse(self.check()['ok'])

    def test_extra_policy_body_requires_review(self):
        self.write(probe.CONFIG, {'schema': 1, 'enabled': True, 'bodies': [self.identity, self.identity]})
        self.assertFalse(self.check()['checks']['exact_body_binding'])

    def test_cached_config_hash_must_match_disk(self):
        self.second['configSha256'] = '0'*64
        self.assertFalse(self.check()['checks']['native_policy_loaded'])

    def test_disabled_or_expanded_native_pad_fails(self):
        self.second['nativePadEnabled'] = False
        self.assertFalse(self.check()['checks']['bounded_native_ticket'])
        self.second['nativePadEnabled'] = True; self.second['nativePadRadius'] = 10
        self.assertFalse(self.check()['checks']['bounded_native_ticket'])

    def test_jar_or_source_drift_fails(self):
        (self.root/probe.JAR).write_bytes(b'old jar')
        self.assertFalse(self.check()['checks']['artifact_matches_build'])
        path = next(iter(self.record['sourceFiles']))
        (self.root/path).write_text('changed source')
        self.assertFalse(self.check()['checks']['source_current'])

    def test_unrelated_build_record_is_not_current_capability(self):
        self.record['capability'] = 'existing_body_restore_v1'; self.write(probe.BUILD_RECORD, self.record)
        self.assertFalse(self.check()['checks']['artifact_matches_build'])

    def test_path_escape_is_rejected(self):
        self.record['sourceFiles']['../private.txt'] = '0'*64
        self.write(probe.BUILD_RECORD, self.record)
        self.assertFalse(self.check()['checks']['source_current'])

    def test_native_command_missing_is_red_without_retry_or_action(self):
        calls = []
        def missing():
            calls.append('numen_autonomy_status')
            raise ValueError('unknown command')
        result = probe.check(self.root, missing, lambda _: None, lambda: self.now)
        self.assertFalse(result['ok']); self.assertEqual(calls, ['numen_autonomy_status'])


if __name__ == '__main__':
    unittest.main()
