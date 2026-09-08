import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('maid_bridge_health_tests', ROOT / 'tools/maid_bridge_health.py')
health = importlib.util.module_from_spec(spec); spec.loader.exec_module(health)


class MaidBridgeHealth(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.now = 1788850000
        self.put('world/maid-bridge-src/qa/MaidQa.java', 'fixture')
        self.put('tools/smoke_maid_bridge.py', 'smoke')
        self.put('world/maid-bridge-src/build/build-record.json', {'sha256': self.sha(b'jar'), 'sources': {'world/maid-bridge-src/qa/MaidQa.java': self.sha(b'fixture')}})
        for target in ('server/mc/mods', 'client/mods'): self.put(target + '/qiandeng-maid-bridge-0.1.0.jar', 'jar')
        self.put('server/mc/config/touhou_little_maid/sites/llm.json', {'codingplan': {'id': 'codingplan', 'api_type': 'qiandeng-qwen', 'url': 'http://npc:8091/v1/maid/chat/completions', 'secret_key': '', 'headers': {}}})
        self.put('server/mc/config/qiandeng_maid_bridge/identity.key', 'test-private-key-do-not-include-' * 2)
        self.registry = {'schema': 1, 'bindingsValid': True, 'independentSessions': True, 'registeredCount': 1, 'activeRoleIds': ['fixture-role']}
        self.put('server/mcdata/village/maid-agents/public/roles.json', self.registry)
        self.smoke = {'ok': True, 'jarSha256': self.sha(b'jar'), 'modelCalls': 0, 'ttsCalls': 0, 'productionMutations': 0,
            'checks': dict.fromkeys(health.SMOKE_CHECKS, True), 'fixtureSha256': self.sha(b'fixture'), 'toolSha256': self.sha(b'smoke')}
        self.put('reports/maid-bridge-smoke.json', self.smoke)
        self.reply = {'schema': 1, 'engine': 'qiandeng_maid_bridge', 'ok': True, 'phase': 'observed',
            'code': 'loaded_maids_observed', 'unloadedNotScanned': True, 'observedAt': self.now * 1000,
            'totalLoaded': 1, 'nextOffset': 1, 'truncated': False, 'maids': [{'maidUuid': '12345678-1234-1234-1234-123456789abc',
            'ownerUuid': 'private-owner-identifier', 'displayName': 'private-character-name', 'nativeChatSetting': True}]}
        self.adapter = {'ok': True, 'trustedIdentityEnabled': True, 'nativeMcpEnabled': True, 'mountedIdentityKeyMatches': True, 'registry': self.registry}

    @staticmethod
    def sha(value): return hashlib.sha256(value).hexdigest()
    def put(self, name, value):
        target = self.root / name; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value if isinstance(value, str) else json.dumps(value), 'utf8')
    def probe(self):
        commands = []
        def rcon(command): commands.append(command); return 'QD_MAID_JSON ' + json.dumps(self.reply)
        result = health.check(self.root, self.now, rcon, lambda: self.adapter)
        self.assertEqual(commands, ['qdmaid list 0'])
        return result

    def test_read_only_readiness_has_no_private_identity_or_key(self):
        result = self.probe(); self.assertTrue(result['ok'], result)
        self.assertEqual(result['loadedMaids'], 1)
        self.assertNotIn('private-', json.dumps(result))

    def test_missing_native_persona_is_reported_for_owned_body(self):
        self.reply['maids'][0]['nativeChatSetting'] = False
        result = self.probe(); self.assertFalse(result['ok'])
        self.assertEqual(result['ownedLoadedMaidsMissingNativeSettings'], 1)

    def test_bad_mounted_key_or_stale_native_response_cannot_pass(self):
        self.adapter['mountedIdentityKeyMatches'] = False
        self.assertFalse(self.probe()['checks']['signed_adapter_ready'])
        self.reply['observedAt'] -= 20000
        self.assertFalse(self.probe()['checks']['native_loaded_discovery'])

    def test_stale_qa_proof_rejected_after_fixture_changes(self):
        self.smoke['fixtureSha256'] = self.sha(b'old-fixture')
        self.put('reports/maid-bridge-smoke.json', self.smoke)
        self.assertFalse(self.probe()['checks']['isolated_native_smoke'])

    def test_config_only_generated_setting_cannot_pass_reload_readiness(self):
        self.put('server/mc/config/touhou_little_maid/settings/qd-bridge-fixture.yml', 'generic')
        self.assertFalse(self.probe()['checks']['managed_settings_reload_safe'])
        target = 'server/mc/tlm_custom_pack/qiandeng-native-chat-1.0.0/assets/qiandeng_bridge/settings/qd-bridge-fixture.yml'
        self.put(target, 'generic')
        self.assertTrue(self.probe()['checks']['managed_settings_reload_safe'])
        self.put(target, 'different personality')
        self.assertFalse(self.probe()['checks']['managed_settings_reload_safe'])


if __name__ == '__main__': unittest.main()
