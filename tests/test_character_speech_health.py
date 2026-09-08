import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('character_speech_health', ROOT / 'tools/character_speech_health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class SpeechHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.voice = self.root / 'server/mc/data/godvoice'
        self.put(self.voice / '.speech-health.json', {'schema': 2, 'protocol': 2,
            'updatedAt': 1000000, 'activeCount': 0, 'queuedCount': 0})
        self.put(self.voice / '.voice-health.json', {'updated_at': 1000})
        self.put(self.voice / 'speech-profiles.json', {'schema': 1, 'actors': {
            'body': {'enabled': True, 'voiceId': 'cosy_male', 'version': 'v1'}}})
        self.put(self.root / 'server/survival-agent-state/survival/settings.json', {'bodyUuid': 'body'})
        self.voices = ['cosy_male']
        self.tools = [{'name': name, 'enabled': True} for name in ('speak', 'speech_status', 'stop_speaking')]

    def put(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf8')

    def fetch(self, url, headers=None):
        return {'voices': self.voices} if url.endswith('/voices') else self.tools

    def run_probe(self):
        return health.check(self.root, clock=lambda: 1001, fetch=self.fetch)

    def test_ready_without_synthesis(self):
        result = self.run_probe()
        self.assertTrue(result['ok'])
        self.assertEqual(result['ttsRequests'], 0)

    def test_old_player_protocol_and_stale_worker_fail(self):
        self.put(self.voice / '.speech-health.json', {'schema': 1})
        self.put(self.voice / '.voice-health.json', {'updated_at': 1})
        result = self.run_probe()
        self.assertFalse(result['checks']['live_player_protocol'])
        self.assertFalse(result['checks']['voice_worker_fresh'])

    def test_missing_voice_or_disabled_native_tool_fails(self):
        self.voices = ['goddess']
        self.tools[0]['enabled'] = False
        result = self.run_probe()
        self.assertFalse(result['checks']['local_voice_available'])
        self.assertFalse(result['checks']['native_speech_tools'])

    def test_missing_file_fails_without_crash(self):
        (self.voice / '.speech-health.json').unlink()
        self.assertFalse(self.run_probe()['ok'])


if __name__ == '__main__':
    unittest.main()
