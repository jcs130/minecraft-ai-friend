from pathlib import Path
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from speech import SpeechTools
from character_speech import SpeechBroker, write, read
from mcp_server import SkillTools

ACTOR = '11111111-1111-4111-8111-111111111111'
TURN = 'speech_test_turn_12345'


class Gateway:
    def __init__(self, state, now):
        self.state, self.clock = state, lambda: now

    def _check_binding(self):
        return 'Kirito', ACTOR

    def _settings(self):
        return {'bodyUuid': ACTOR}

    def _invoke(self, name):
        assert name == 'get_self_status'
        return {'dimension': 'minecraft:overworld'}


class SurvivorSpeechTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.state = self.root / 'survival'
        now = time.time()
        self.gateway = Gateway(self.state, now)
        write(self.state / 'control.json', {'schema': 1, 'enabled': True})
        write(self.state / 'lease.json', {'schema': 1, 'turnId': TURN, 'status': 'open',
            'expiresAt': (now + 180) * 1000, 'actionLimit': 1, 'actionsUsed': 0})
        broker = SpeechBroker(self.root / 'voice', self.gateway.clock)
        write(broker.root / 'speech-profiles.json', {'schema': 1, 'actors': {
            ACTOR: {'enabled': True, 'voiceId': 'cosy_male', 'version': 'v1'}}})
        self.speech = SpeechTools(self.gateway, SkillTools(self.state, clock=self.gateway.clock), broker)

    def test_speech_keeps_action_lease_and_is_once_per_turn(self):
        before = (self.state / 'lease.json').read_bytes()
        one = self.speech.speak(TURN, '收到。')
        self.assertTrue(one['ok'])
        self.assertEqual(before, (self.state / 'lease.json').read_bytes())
        self.assertEqual(one, self.speech.speak(TURN, '收到。'))
        self.assertEqual(self.speech.speak(TURN, '第二句。')['code'], 'speech_request_conflict')

    def test_invalid_lease_and_paused_cannot_speak(self):
        self.assertFalse(self.speech.speak('wrong', '收到。')['ok'])
        write(self.state / 'control.json', {'schema': 1, 'enabled': False})
        self.assertEqual(self.speech.speak(TURN, '收到。')['code'], 'autonomy_disabled')
        self.assertFalse(self.speech.cancel(TURN)['ok'])

    def test_used_lease_may_speak_but_closed_may_not(self):
        value = read(self.state / 'lease.json')
        value.update(status='used', actionsUsed=1)
        write(self.state / 'lease.json', value)
        self.assertTrue(self.speech.speak(TURN, '已出发。')['ok'])
        value['status'] = 'closed'
        write(self.state / 'lease.json', value)
        self.assertEqual(self.speech.cancel(TURN)['code'], 'lease_invalid')

    def test_status_readable_when_paused_and_cancel_is_not_completion(self):
        one = self.speech.speak(TURN, '收到。')
        stop = self.speech.cancel(TURN)
        self.assertFalse(stop['playbackStoppedConfirmed'])
        write(self.state / 'control.json', {'schema': 1, 'enabled': False})
        result = self.speech.status(one['utteranceId'])
        self.assertEqual(result['status'], 'cancellation_requested')
        self.assertFalse(result['playbackCompleted'])

    def test_unknown_body_action_blocks_new_speech(self):
        write(self.state / 'unknown.json', {'status': 'unknown'})
        self.assertEqual(self.speech.speak(TURN, '完成了。')['code'], 'outcome_unknown')


if __name__ == '__main__':
    unittest.main()
