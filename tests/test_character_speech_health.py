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
            'body': {'enabled': True, 'voiceId': 'cosy_male', 'version': 'v1'},
            'yui-body': {'enabled': True, 'voiceId': 'voice_03', 'version': 'v1'}}})
        self.put(self.root / 'server/survival-agent-state/survival/settings.json', {'bodyUuid': 'body'})
        self.put(self.root / 'server/mcdata/village/party/public/roles.json', {'members': [
            {'agentId': '5swvhK', 'kind': 'maid', 'bodyUuid': 'yui-body'}]})
        for role in ('qd-survivor', '5swvhK'):
            folder = self.root / 'server/agents/work/workspaces' / role
            self.put(folder / 'skill.json', {'skills': {'say-it-plain': {'enabled': True, 'channels': ['all']}}})
            (folder / 'AGENTS.md').write_text('<!-- qiandeng-party-voice-v1 -->\n口语规则\n<!-- /qiandeng-party-voice-v1 -->', encoding='utf-8')
            skill = folder / 'skills/say-it-plain/SKILL.md'
            skill.parent.mkdir(parents=True, exist_ok=True)
            skill.write_text('---\nname: say-it-plain\n---\n', encoding='utf-8')
        self.voices = ['cosy_male', 'voice_03']
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

    def test_missing_yui_style_binding_fails(self):
        (self.root / 'server/agents/work/workspaces/5swvhK/skills/say-it-plain/SKILL.md').unlink()
        result = self.run_probe()
        self.assertFalse(result['checks']['plain_speech_skill_binding'])

    def test_yui_must_keep_a_distinct_available_voice(self):
        profiles = json.loads((self.voice / 'speech-profiles.json').read_text(encoding='utf8'))
        profiles['actors']['yui-body']['voiceId'] = 'cosy_male'
        self.put(self.voice / 'speech-profiles.json', profiles)
        self.assertFalse(self.run_probe()['checks']['yui_voice_binding'])

    def test_missing_file_fails_without_crash(self):
        (self.voice / '.speech-health.json').unlink()
        self.assertFalse(self.run_probe()['ok'])


if __name__ == '__main__':
    unittest.main()
