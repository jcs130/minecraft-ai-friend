import base64
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from party_world import GameSpeech, reconcile_world, speech_event, validate_receipt


def world_receipt(event, phase='heard', code=None):
    return {k: event[k] for k in ('schema', 'eventId', 'speakerUuid', 'listenerUuid', 'textSha256', 'channel')} | {
        'ok': phase == 'heard', 'heard': phase == 'heard', 'phase': phase,
        'code': code or ('nearby_speech_heard' if phase == 'heard' else 'outside_hearing_radius'),
        'dimension': 'minecraft:overworld', 'speakerPosition': [0., 64., 0.],
        'listenerPosition': [3., 64., 4.], 'distance': 5., 'radius': 24 if event['channel'] == 'nearby' else None,
        'emittedAt': 100000000, 'observedAt': 100000001}


def confirm_heard(queue, event_id):
    event = queue.claim_world(event_id)
    if event['state'] == 'unknown':
        queue.record_world_receipt(event_id, world_receipt(event))
    return queue.world_event(event_id)


class FakeWorld:
    """Explicit world fixture; storage never auto-confirms game hearing."""
    def __init__(self):
        self.emits = []
        self.reads = []
        self.receipts = {}
        self.phase = 'heard'
        self.lose_reply = False

    def emit(self, event):
        self.emits.append(deepcopy(event))
        result = world_receipt(event, self.phase)
        self.receipts[event['eventId']] = result
        if self.lose_reply:
            raise TimeoutError('test lost receipt after the game heard')
        return result

    def status(self, event_id):
        self.reads.append(event_id)
        return self.receipts[event_id]


class PartyWorldTests(unittest.TestCase):
    def setUp(self):
        from test_party_messages import fixture_binding
        from party_messages import PartyMessages
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.binding = fixture_binding()
        self.now = 100000
        self.queue = PartyMessages(self.temp.name, lambda: self.binding, clock=lambda: self.now)
        self.game = FakeWorld()
        self.actor = 'test-survivor'; self.other = 'test-maid'

    def request(self, **kwargs):
        return self.queue.enqueue(self.actor, 'Can you hear me?', **kwargs)

    def test_unheard_request_cannot_disclose_text_or_reserve_model(self):
        message = self.request()
        self.assertIsNone(self.queue.get_status(self.other, message['messageId'])['text'])
        self.assertIsNone(self.queue.overview(self.other)['messages'][0]['text'])
        self.assertIsNone(self.queue.next_pending(self.other))
        self.assertEqual(self.queue.reserve_dispatch(message['messageId'], self.other)['dispatchStatus'], 'not_heard')
        self.assertEqual(self.queue.budget_status(self.actor)['reservedDispatches24h'], 0)
        reconcile_world(self.queue, self.game, message['messageId'])
        self.assertEqual(self.queue.next_pending(self.other)['text'], message['text'])

    def test_rejected_game_request_never_retries_or_spends_even_after_nearer(self):
        self.game.phase = 'rejected'
        message = self.request()
        event = reconcile_world(self.queue, self.game, message['messageId'])
        self.assertEqual(event['state'], 'rejected')
        self.game.phase = 'heard'
        reconcile_world(self.queue, self.game, message['messageId'])
        self.assertEqual(len(self.game.emits), 1)
        self.assertEqual(self.game.reads, [])
        self.assertIsNone(self.queue.get_status(self.other, message['messageId'])['text'])
        self.assertIsNone(self.queue.next_pending(self.other))

    def test_unknown_after_restart_queries_existing_event_never_speaks_twice(self):
        from party_messages import PartyMessages
        self.game.lose_reply = True
        message = self.request()
        self.assertEqual(reconcile_world(self.queue, self.game, message['messageId'])['state'], 'unknown')
        self.assertIsNone(self.queue.next_pending(self.other))
        restarted = PartyMessages(self.temp.name, lambda: self.binding, clock=lambda: self.now)
        self.assertEqual(reconcile_world(restarted, self.game, message['messageId'])['state'], 'heard')
        self.assertEqual(len(self.game.emits), 1)
        self.assertEqual(self.game.reads, [message['messageId']])

    def test_spoofed_hash_channel_body_and_distance_never_confirm_hearing(self):
        message = self.request()
        event = self.queue.claim_world(message['messageId'])
        for change in ({'textSha256': '0' * 64}, {'listenerUuid': str(uuid.uuid4())},
                       {'channel': 'msg'}, {'distance': 1000}, {'listenerPosition': [50, 64, 0]}):
            with self.assertRaises(ValueError):
                self.queue.record_world_receipt(event['eventId'], world_receipt(event) | change)
        self.assertEqual(self.queue.world_event(event['eventId'])['state'], 'unknown')

    def test_reply_is_private_draft_until_heard_and_never_schedules_callback(self):
        message = self.request(); confirm_heard(self.queue, message['messageId'])
        reserved = self.queue.reserve_dispatch(message['messageId'], self.other)
        self.queue.mark_submitted(reserved['reservationId'], 'task-112233aabbcc')
        draft = self.queue.mark_answered(reserved['reservationId'], 'task-112233aabbcc', 'Yes, over here.')
        self.assertIsNone(draft['reply']); self.assertEqual(draft['status'], 'submitted')
        self.assertIsNotNone(self.queue.active_for_recipient(self.other))
        event_id = draft['replyDelivery']['eventId']
        reconcile_world(self.queue, self.game, event_id, allow_dispatch=False)
        self.assertEqual(self.game.emits, [])
        self.assertEqual(self.game.reads, [])
        self.assertIsNone(self.queue.get_status(self.actor, message['messageId'])['reply'])
        reconcile_world(self.queue, self.game, event_id)
        final = self.queue.get_status(self.actor, message['messageId'])
        self.assertEqual(final['reply']['text'], 'Yes, over here.')
        self.assertEqual(final['status'], 'answered')
        self.assertIsNone(self.queue.active_for_recipient(self.other))
        self.assertIsNone(self.queue.next_pending(self.actor))

    def test_expired_unsaid_intent_cannot_be_sent_on_resume(self):
        message = self.request(ttl_seconds=1)
        self.now += 2
        self.assertEqual(reconcile_world(self.queue, self.game, message['messageId'])['state'], 'expired')
        self.assertEqual(self.game.emits, [])

    def test_text_exact_unicode_and_channel_are_part_of_idempotence(self):
        message = self.request(channel='msg')
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.queue.enqueue(self.actor, message['text'], message_id=message['messageId'], channel='nearby')
        for text in ('x' * 161, 'line\nbreak', 'x\x7fy', 'x\ud800y'):
            with self.assertRaises(ValueError): self.queue.enqueue(self.actor, text)
        self.assertEqual(len(self.queue.enqueue(self.actor, '😀' * 160)['text']), 160)

    def test_native_rcon_emits_exact_base64_body_and_validates_receipt(self):
        event = speech_event(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), '测试 😀')
        calls = []
        def run(command):
            calls.append(command)
            return 'QD_MAID_JSON ' + json.dumps(world_receipt(event))
        game = GameSpeech(run)
        self.assertTrue(game.emit(event)['heard'])
        encoded = calls[0].split(' ')[2]
        self.assertNotIn('+', encoded); self.assertNotIn('/', encoded)
        payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
        self.assertEqual(payload, event)
        self.assertTrue(game.status(event['eventId'])['heard'])
        self.assertEqual(calls[1], 'qdmaid party_speech_status ' + event['eventId'])

    def test_msg_can_cross_dimensions_and_distance_without_nearby_claim(self):
        event = speech_event(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), 'Private', 'msg')
        receipt = world_receipt(event) | {'distance': None, 'radius': None,
            'speakerPosition': [0, 70, 0], 'listenerPosition': [100000, 5, 100000]}
        self.assertTrue(validate_receipt(receipt, event)['heard'])

    def test_survivor_existing_secret_environment_is_reused(self):
        event = speech_event(str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), 'Test')
        with patch.dict('os.environ', {'MC_RCON_SECRET': '/run/secrets/rcon'}, clear=True):
            with patch('maid_native_tools.NativeRcon') as factory:
                factory.return_value.return_value = 'QD_MAID_JSON ' + json.dumps(world_receipt(event))
                self.assertTrue(GameSpeech().emit(event)['heard'])
                factory.assert_called_once_with(password_file='/run/secrets/rcon')


if __name__ == '__main__': unittest.main()
