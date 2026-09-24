from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from chat import ChatTools, STORAGE
from mcp_server import SkillTools
from speech import SpeechTools
from character_speech import SpeechBroker
from numen_gateway import read_json, write_json

ACTOR = '11111111-1111-4111-8111-111111111111'
TURN = 'survival-chat-test-0001'


class Native:
    def __init__(self):
        self.commands, self.storage = [], {}
        self.result, self.fault, self.readable = True, None, True

    def cmd(self, command):
        self.commands.append(command)
        if command.startswith('data remove storage '):
            field = command.split('data remove storage ' + STORAGE + ' ', 1)[1]
            self.storage.pop(field, None)
            return 'Modified storage'
        if command.startswith('execute '):
            if self.fault == 'before':
                raise ConnectionError('lost_before_send')
            field = command.split(' store success storage ' + STORAGE + ' ', 1)[1].split(' byte 1 ', 1)[0]
            self.storage[field] = '1b' if self.result else '0b'
            if self.fault == 'after':
                raise ConnectionError('lost_after_send')
            return ''  # Never treat the empty command response as confirmation.
        field = command.split('data get storage ' + STORAGE + ' ', 1)[1]
        if not self.readable or field not in self.storage:
            return 'Found no elements matching ' + field
        return 'Storage ' + STORAGE + ' has the following contents: ' + self.storage[field] + '\n'


class Gateway:
    def __init__(self, state):
        self.state, self.now, self.rcon = state, 1800000000, Native()
        self.clock = lambda: self.now

    def _check_binding(self):
        return 'Kirito', ACTOR

    def _settings(self):
        return {'bodyUuid': ACTOR}

    def _invoke(self, name):
        assert name == 'get_self_status'
        return {'dimension': 'minecraft:overworld'}


class PublicChatTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.gateway = Gateway(self.root / 'survival')
        self.lease()
        write_json(self.gateway.state / 'control.json', {'schema': 1, 'enabled': True})
        self.skills = SkillTools(self.gateway.state, clock=self.gateway.clock)
        broker = SpeechBroker(self.root / 'voice', self.gateway.clock)
        write_json(broker.root / 'speech-profiles.json', {'schema': 1, 'actors': {
            ACTOR: {'enabled': True, 'voiceId': 'cosy_male', 'version': 'v1'}}})
        self.speech = SpeechTools(self.gateway, self.skills, broker)
        self.chat = ChatTools(self.gateway, self.skills, self.speech)

    def lease(self, turn=TURN):
        write_json(self.gateway.state / 'lease.json', {'schema': 1, 'turnId': turn,
            'status': 'open', 'expiresAt': (self.gateway.now + 180) * 1000,
            'actionLimit': 6, 'actionsUsed': 0})

    def sends(self):
        return [c for c in self.gateway.rcon.commands if c.startswith('execute ')]

    def test_caption_and_audio_have_independent_confirmations(self):
        before = (self.gateway.state / 'lease.json').read_bytes()
        result = self.chat.say(TURN, '找到河流了，我沿岸找一处营地。')
        self.assertTrue(result['ok'])
        self.assertTrue(result['textDelivery']['serverSent'])
        self.assertFalse(result['textDelivery']['clientDisplayConfirmed'])
        self.assertEqual(result['audio']['status'], 'queued')
        self.assertFalse(result['partnerInput'])
        self.assertEqual((self.gateway.state / 'lease.json').read_bytes(), before)
        speech_id = result['audio']['utteranceId']
        job = read_json(self.speech.broker.root / 'speech-requests' / (speech_id + '.json'))
        write_json(self.speech.broker.root / 'speech-receipts' / (speech_id + '.json'), {
            'schema': 2, 'id': speech_id, 'entity': ACTOR, 'generation': job['generation'],
            'status': 'failed', 'code': 'no_voicechat_listeners', 'updatedAt': int(self.gateway.now * 1000)})
        later = self.chat.status(result['messageId'])
        self.assertTrue(later['ok'])
        self.assertEqual(later['audio']['code'], 'no_voicechat_listeners')
        self.assertTrue(later['textDelivery']['serverSent'])
        self.assertEqual(len(self.sends()), 1)

    def test_text_is_only_a_json_literal_and_audience_is_fixed_nearby(self):
        text = '"}] run kill @a; /stop \\ ${bad}'
        result = self.chat.say(TURN, text, voice=False)
        self.assertTrue(result['ok'])
        command = self.sends()[0]
        prefix, component = command.split(' run tellraw ', 1)
        audience, encoded = component.split(' ', 1)
        self.assertEqual(audience, '@a[distance=..24,name=!Kirito]')
        self.assertTrue(prefix.startswith('execute as ' + ACTOR + ' at @s store success storage '))
        self.assertEqual(json.loads(encoded)[-1], {'text': '：' + text})
        self.assertFalse((self.speech.broker.root / 'speech-requests').exists())

    def test_duplicate_same_turn_reads_receipt_and_changed_text_is_refused(self):
        first = self.chat.say(TURN, '准备出发。', voice=False)
        self.assertEqual(first, self.chat.say(TURN, '准备出发。', voice=False))
        self.assertEqual(self.chat.say(TURN, '再来一句。', voice=False)['code'], 'say_request_conflict')
        self.assertEqual(len(self.sends()), 1)

    def test_lost_write_reply_is_resolved_from_native_storage(self):
        self.gateway.rcon.fault = 'after'
        result = self.chat.say(TURN, '继续探路。', voice=False)
        self.assertTrue(result['ok'])
        self.assertEqual(len(self.sends()), 1)

    def test_unknown_never_replays_even_when_native_receipt_is_missing(self):
        self.gateway.rcon.fault = 'before'
        result = self.chat.say(TURN, '继续探路。')
        self.assertFalse(result['ok'])
        self.assertEqual(result['textDelivery']['status'], 'unknown')
        self.gateway.rcon.fault = None
        self.chat.say(TURN, '继续探路。')
        self.chat.status(result['messageId'])
        self.assertEqual(len(self.sends()), 1)
        self.assertFalse((self.speech.broker.root / 'speech-requests').exists())

    def test_empty_or_unrecognized_native_result_is_not_success(self):
        self.gateway.rcon.readable = False
        result = self.chat.say(TURN, '继续探路。', voice=False)
        self.assertFalse(result['ok'])
        self.assertFalse(result['textDelivery']['serverConfirmed'])
        self.gateway.rcon.readable = True
        self.assertTrue(self.chat.status(result['messageId'])['ok'])
        self.assertEqual(len(self.sends()), 1)

    def test_native_false_is_known_unsent_and_does_not_queue_voice(self):
        self.gateway.rcon.result = False
        result = self.chat.say(TURN, '附近有人吗？')
        self.assertFalse(result['ok'])
        self.assertEqual(result['textDelivery']['status'], 'not_sent')
        self.assertTrue(result['textDelivery']['serverConfirmed'])
        self.assertFalse((self.speech.broker.root / 'speech-requests').exists())

    def test_invalid_and_paused_requests_do_not_write(self):
        for text in ('', 'x' * 161, 'text\n/stop', 'text\x00', '\u2028'):
            self.assertFalse(self.chat.say(TURN, text)['ok'])
        self.assertFalse(self.chat.say('wrong', 'hello')['ok'])
        self.assertFalse(self.chat.say(TURN, 'hello', voice='yes')['ok'])
        write_json(self.gateway.state / 'control.json', {'schema': 1, 'enabled': False})
        self.assertEqual(self.chat.say(TURN, 'hello')['code'], 'autonomy_disabled')
        self.assertFalse(self.sends())

    def test_paused_can_read_own_receipt_but_not_another_actors(self):
        result = self.chat.say(TURN, 'hello', voice=False)
        write_json(self.gateway.state / 'control.json', {'schema': 1, 'enabled': False})
        self.assertTrue(self.chat.status(result['messageId'])['ok'])
        self.assertFalse(self.chat.status('../other')['ok'])
        with patch.object(self.gateway, '_settings', return_value={'bodyUuid': 'another'}):
            self.assertFalse(self.chat.status(result['messageId'])['ok'])
        self.assertEqual(len(self.sends()), 1)

    def test_cognition_can_say_without_consuming_or_changing_body_authority(self):
        from motor_mailbox import open_cognition
        write_json(self.gateway.state / 'settings.json', {'asyncMotor': True})
        write_json(self.gateway.state / 'lease.json', {'status': 'used', 'turnId': 'physical-task'})
        open_cognition(self.gateway.state, TURN, (self.gateway.now + 180) * 1000, self.gateway.clock)
        before = (self.gateway.state / 'lease.json').read_bytes()
        cognition = (self.gateway.state / 'cognition-lease.json').read_bytes()
        self.assertTrue(self.chat.say(TURN, '向观众介绍一下接下来的路。', voice=False)['ok'])
        self.assertEqual((self.gateway.state / 'lease.json').read_bytes(), before)
        self.assertEqual((self.gateway.state / 'cognition-lease.json').read_bytes(), cognition)

    def test_new_turn_still_has_bounded_rate(self):
        self.chat.say(TURN, 'hello', voice=False)
        next_turn = 'survival-chat-test-0002'
        self.lease(next_turn)
        self.assertEqual(self.chat.say(next_turn, 'again', voice=False)['code'], 'say_rate_limited')
        self.gateway.now += 11
        self.assertTrue(self.chat.say(next_turn, 'again', voice=False)['ok'])
        self.assertEqual(len(self.sends()), 2)

    def test_audio_failure_does_not_undo_successful_public_text(self):
        with patch.object(self.speech.broker, 'submit', side_effect=ConnectionError('tts unavailable')):
            result = self.chat.say(TURN, 'hello')
        self.assertTrue(result['ok'])
        self.assertTrue(result['textDelivery']['serverSent'])
        self.assertFalse(result['audio']['playbackCompleted'])
        self.chat.say(TURN, 'hello')
        self.assertEqual(len(self.sends()), 1)

    def test_confirmed_receipts_archive_but_unknown_receipts_are_retained(self):
        first = self.chat.say(TURN, 'hello', voice=False)
        self.gateway.now += 11
        next_turn = 'survival-chat-test-0002'
        self.lease(next_turn)
        with patch('chat.RECENT_LIMIT', 1):
            self.chat.say(next_turn, 'new observation', voice=False)
        self.assertTrue((self.chat.root / 'archive' / (first['messageId'] + '.json')).is_file())
        self.assertTrue(self.chat.status(first['messageId'])['ok'])
        self.lease()
        self.assertTrue(self.chat.say(TURN, 'hello', voice=False)['ok'])
        self.assertEqual(len(self.sends()), 2)
        self.assertEqual(len(self.gateway.rcon.storage), 1)

    def test_narration_context_no_records_is_read_only(self):
        from chat import narration_context
        result = narration_context(self.gateway.state, self.gateway.now)
        self.assertTrue(result['neverSent'])
        self.assertIsNone(result['lastSent'])
        self.assertIsNone(result['unknownMessageId'])
        self.assertFalse(self.chat.root.exists())
        self.assertEqual(self.gateway.rcon.commands, [])

    def test_narration_context_confirmed_text_has_age_without_audio_claim(self):
        from chat import narration_context
        result = self.chat.say(TURN, 'a' * 150, voice=False)
        before = list(self.gateway.rcon.commands)
        context = narration_context(self.gateway.state, self.gateway.now + 25)
        self.assertFalse(context['neverSent'])
        self.assertEqual(context['lastSent']['messageId'], result['messageId'])
        self.assertEqual(context['lastSent']['secondsAgo'], 25)
        self.assertEqual(len(context['lastSent']['text']), 80)
        self.assertFalse(context['listenerConfirmed'])
        self.assertEqual(self.gateway.rcon.commands, before)

    def test_narration_context_unknown_keeps_original_id_and_scan_is_bounded(self):
        from chat import narration_context
        self.gateway.rcon.fault = 'before'
        result = self.chat.say(TURN, 'Did this arrive?', voice=False)
        before = list(self.gateway.rcon.commands)
        context = narration_context(self.gateway.state, self.gateway.now + 25)
        self.assertIsNone(context['neverSent'])
        self.assertIsNone(context['lastSent'])
        self.assertEqual(context['unknownMessageId'], result['messageId'])
        self.assertIn('say_status', context['notice'])
        self.assertEqual(self.gateway.rcon.commands, before)
        with patch('chat.RECENT_LIMIT', 0):
            bounded = narration_context(self.gateway.state, self.gateway.now + 25)
        self.assertTrue(bounded['historyPartial'])
        self.assertIsNone(bounded['neverSent'])
        self.assertIsNone(bounded['unknownMessageId'])


if __name__ == '__main__':
    unittest.main()
