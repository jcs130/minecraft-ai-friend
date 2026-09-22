import hashlib, importlib.util, json, tempfile, time, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('jev_health', ROOT/'tools/jev_intent_health.py')
probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)


class IntentHealthTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup); self.root = Path(tmp.name)
        self.heart = {'ts': time.time()*1000, 'jevIntent': {'schema': 1, 'publicNpcRoutingVersion': 1, 'provider': 'official-jev', 'configured': True, 'inFlight': 0, 'limit': 2}}
        self.write('server/mcdata/npc-health.json', {'updated_at': time.time(), 'threads': {'inbox': True}, 'story_dialogue_version': 1,
            'public_chat_routing': {'version': 1, 'owner': 'world-public-chat', 'lastPoll': time.time()}})
        hashes = {}
        for name in probe.REQUIRED:
            path=self.root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'fixture')
            hashes[name] = hashlib.sha256(b'fixture').hexdigest()
        self.write('reports/jev-intent-smoke.json', {'ok': True, 'worldActions': 0, 'testsPassed': 7, 'npcTestsPassed': 6, 'sources': hashes})
    def write(self, name, data):
        path=self.root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(data), 'utf8')
    def check(self):
        self.write('server/world-data/world-heartbeat.json', self.heart); return probe.check(self.root)
    def test_current_evidence(self): self.assertTrue(self.check()['ok'])
    def test_stale_runtime(self):
        self.heart['ts'] -= 181000; self.assertFalse(self.check()['ok'])
    def test_missing_key_and_overflow(self):
        self.heart['jevIntent']['configured'] = False; self.assertFalse(self.check()['ok'])
        self.heart['jevIntent']['configured'] = True; self.heart['jevIntent']['inFlight'] = 3; self.assertFalse(self.check()['ok'])
    def test_changed_source(self):
        (self.root/'world/src/mc-god.ts').write_bytes(b'changed'); self.assertFalse(self.check()['ok'])
    def test_missing_or_stale_npc_consumer(self):
        self.write('server/mcdata/npc-health.json', {'updated_at': time.time(), 'threads': {'inbox': False}})
        self.assertFalse(self.check()['ok'])


if __name__ == '__main__': unittest.main()
