"""Heard replies join one existing life task, respecting its budget and terminal."""
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
import uuid

import test_survival_controller as fixture
from test_survival_life_session import FakeParty
from numen_gateway import read_json
from controller import party_reply_context


class PartyReplyProjectionTests(unittest.TestCase):
    def test_keeps_hearing_identity_and_original_time_without_full_bindings(self):
        row = {'eventId': 'event-1', 'replyTo': 'message-1', 'partyId': 'team', 'bindingRevision': 1,
               'sender': {'agentId': 'yui', 'bodyUuid': 'body-yui', 'displayName': '结衣',
                          'sessionId': 'private-session', 'ownerUuid': 'owner'},
               'recipient': {'agentId': 'kirito', 'sessionId': 'receiver-session'},
               'text': '我会看看情况。', 'requiresReply': False, 'trusted': False,
               'receipt': {'heard': True, 'phase': 'heard', 'code': 'nearby_speech_heard',
                           'emittedAt': 1000, 'observedAt': 1001, 'dimension': 'minecraft:overworld',
                           'distance': 3.5, 'textSha256': 'a' * 64, 'listenerPosition': [1, 2, 3]}}
        before = deepcopy(row)
        projected = party_reply_context([row])[0]
        self.assertEqual(projected['sender'], {'agentId': 'yui', 'bodyUuid': 'body-yui', 'displayName': '结衣'})
        self.assertEqual(projected['text'], row['text'])
        self.assertEqual(projected['replyTo'], row['replyTo'])
        self.assertFalse(projected['requiresReply'])
        self.assertFalse(projected['trusted'])
        self.assertEqual(projected['receipt'], {k: row['receipt'][k] for k in
            ('heard', 'phase', 'code', 'emittedAt', 'observedAt', 'dimension', 'distance')})
        self.assertNotIn('recipient', projected)
        self.assertEqual(row, before)

    def test_ordered_parts_and_unknown_keep_exact_status_instead_of_assuming_heard(self):
        rows = [{'eventId': 'first', 'text': 'two parts', 'receipt': {
            'kind': 'ordered_game_speech', 'heard': True,
            'parts': [{'eventId': 'part1', 'heard': True, 'emittedAt': 1000},
                      {'eventId': 'part2', 'heard': True, 'emittedAt': 2000}]}},
            {'eventId': 'unknown', 'text': 'unconfirmed', 'receipt': {
                'heard': False, 'phase': 'unknown', 'code': 'delivery_unknown', 'ok': False}}]
        self.assertEqual(party_reply_context(rows), rows)


class ReplyParty(FakeParty):
    def __init__(self):
        super().__init__()
        self.message = None
        self.config = SimpleNamespace(configured=lambda: True, roster=lambda: [])
        self.replies = []
        self.consumed = {}
        self.validated = []

    def add(self):
        reply = {'eventId': str(uuid.uuid4()), 'text': 'A heard environmental fixture.',
                 'requiresReply': False, 'trusted': False, 'receipt': {'heard': True}}
        self.replies.append(reply)
        return reply['eventId']

    def heard_replies(self):
        return deepcopy([r for r in self.replies if r['eventId'] not in self.consumed][:8])

    def consume_replies(self, ids, task_id):
        for event_id in ids:
            if event_id in self.consumed:
                assert self.consumed[event_id] == task_id
            self.consumed[event_id] = task_id

    def validate_session(self, session, settings, reservation=None):
        self.validated.append(deepcopy(reservation))


class ReplyContextTests(unittest.TestCase):
    create = fixture.ControllerTests.create
    write = fixture.ControllerTests.write

    def setUp(self):
        fixture.ControllerTests.setUp(self)
        self.party = ReplyParty()
        self.controller.party = self.party
        self.control = read_json(self.state / 'control.json') | {'autonomous': True}
        self.write('control.json', self.control)
        self.controller.data.update(lastReviewAt=self.clock(),
            lastDecisionSignature=self.controller.decision_signature(self.gateway.body, self.control))

    def normal_event(self):
        self.gateway.body['counts']['minecraft:oak_log'] += 1

    def finish(self, status='completed'):
        self.backend.reply = {'status': 'finished', 'result': {'status': status,
            'session_id': self.controller.data['active']['sessionId'], 'output': [
                {'role': 'assistant', 'type': 'message', 'status': 'completed',
                 'content': [{'type': 'text', 'text': 'I considered the reply.'}]}]}}
        self.controller.tick()

    def test_only_replies_stay_observing_until_original_review_then_join_same_session(self):
        self.controller.tick()
        self.assertFalse(self.backend.submitted)
        signature = self.controller.decision_signature(self.gateway.body, self.control)
        due = self.controller.next_review(self.control)
        first, second = self.party.add(), self.party.add()
        started = self.clock()
        for instant in (started + 1, started + 121, started + 300, due - 1):
            self.clock.now = instant
            self.controller.tick()
            self.assertEqual(self.controller.data['status'], 'observing')
            self.assertFalse(self.backend.submitted)
            self.assertFalse(self.party.consumed)
            self.assertEqual(self.controller.next_review(self.control), due)
        self.assertEqual(self.controller.decision_signature(self.gateway.body, self.control), signature)
        self.clock.now = due
        self.controller.tick()
        active = read_json(self.state / 'controller.json')['active']
        self.assertEqual(active['partyReplyEventIds'], [first, second])
        self.assertNotIn('partyReservation', active)
        self.assertEqual(self.controller.data['wakeReason'], 'autonomous_review')
        submitted = self.backend.submitted[0]
        self.assertEqual(submitted['session']['primarySessionId'], self.controller.session['primarySessionId'])
        prompt = json.loads(submitted['prompt'].split('\n', 1)[1])
        self.assertEqual([r['eventId'] for r in prompt['partyReplies']], [first, second])
        self.assertIn('不要求再回复', prompt['instruction'])
        self.assertEqual(submitted['requestContext'], self.party.request_context())
        self.assertEqual([r['eventId'] for r in self.party.validated if r], [first, second])
        self.controller.tick()  # The known task is still running.
        self.assertFalse(self.party.consumed)
        self.finish()
        self.assertEqual(self.party.consumed, {first: active['taskId'], second: active['taskId']})
        self.assertFalse(self.party.calls)
        self.assertEqual(len(self.controller.data['decisions']), 1)
        self.clock.now += 121
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)

    def test_reply_arriving_during_task_survives_its_exact_terminal_ack(self):
        first = self.party.add()
        self.normal_event()
        self.controller.tick()
        later = self.party.add()
        self.finish()
        self.assertIn(first, self.party.consumed)
        self.assertNotIn(later, self.party.consumed)
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.clock.now += 121
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.controller.data['status'], 'observing')
        self.normal_event()
        self.controller.tick()
        active = self.controller.data['active']
        self.assertEqual(active['partyReplyEventIds'], [later])
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertEqual(self.controller.data['wakeReason'], 'world_or_goal_changed')

    def test_original_incoming_request_can_still_wake_before_review(self):
        reply = self.party.add()
        self.party.message = {'messageId': 'incoming-request', 'text': 'A new addressed request.'}
        self.controller.tick()
        self.assertEqual(self.controller.data['wakeReason'], 'party_message')
        self.assertIn('partyReservation', self.controller.data['active'])
        self.assertEqual(self.controller.data['active']['partyReplyEventIds'], [reply])
        self.assertEqual(len(self.backend.submitted), 1)

    def test_budget_cooldown_busy_and_pause_leave_reply_unconsumed(self):
        self.party.add()
        self.controller.data['nextDecisionAt'] = self.clock() + 300
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'cooldown')
        self.clock.now += 301
        self.controller.data['decisions'] = [{'startedAt': self.clock()}] * self.settings['decisionsPerDay']
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'budget_wait')
        self.controller.data['decisions'] = []
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'acting')
        self.gateway.body['task']['busy'] = False
        self.controller.pause('operator_pause')
        self.controller.tick()
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.party.consumed)

    def test_unknown_submission_and_restart_never_consume_or_replay(self):
        event_id = self.party.add()
        self.normal_event()
        self.backend.on_submit = lambda *_: (_ for _ in ()).throw(TimeoutError())
        self.backend.cancel_error = ValueError('native task unknown')
        self.controller.tick()
        restarted = self.create()
        restarted.party = self.party
        restarted.tick()
        self.assertFalse(self.party.consumed)
        self.assertEqual(restarted.data['active']['partyReplyEventIds'], [event_id])
        self.assertEqual(len(self.backend.submitted), 1)

    def test_failed_known_task_consumes_input_without_retrying_same_reply(self):
        event_id = self.party.add()
        self.normal_event()
        self.controller.tick()
        self.finish('failed')
        self.assertIn(event_id, self.party.consumed)
        self.assertFalse(self.party.calls)
        self.clock.now += 121
        self.controller.tick()
        # Normal inference recovery may continue life, but cannot replay speech.
        if self.controller.data['active']:
            self.assertNotIn(event_id, self.controller.data['active']['partyReplyEventIds'])
        self.assertFalse(self.party.calls)

    def test_cancel_only_consumes_after_exact_task_terminal_confirmation(self):
        event_id = self.party.add()
        self.normal_event()
        self.controller.tick()
        self.backend.cancel_reply = {'stopped': False, 'waitingForTerminal': True}
        self.controller.pause('operator_pause')
        self.controller.tick()
        self.assertFalse(self.party.consumed)
        self.backend.cancel_reply = {'stopped': True, 'alreadyTerminal': True}
        self.controller.tick()
        self.assertIn(event_id, self.party.consumed)
        self.assertIsNone(self.controller.data['active'])
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])

    def test_embodied_projection_keeps_original_binding_validation_and_exact_consumption(self):
        self.controller.settings.update(contextProtocol=2, brainProtocol=1, memoryEpoch='current')
        self.party.config.roster = lambda: []
        event_id = self.party.add()
        self.party.replies[0].update(replyTo='request-one', sender={'agentId': 'yui',
            'bodyUuid': 'yui-body', 'sessionId': 'sender-session'},
            recipient={'agentId': 'qd-survivor', 'sessionId': 'receiver-session'})
        original = deepcopy(self.party.replies[0])
        self.normal_event()
        self.controller.tick()
        active = deepcopy(self.controller.data['active'])
        prompt = json.loads(self.backend.submitted[-1]['prompt'].split('\n', 1)[1])
        projected = prompt['events']['partyReplies'][0]
        self.assertNotIn('recipient', projected)
        self.assertNotIn('sessionId', projected['sender'])
        self.assertEqual(projected['eventId'], event_id)
        self.assertEqual([row for row in self.party.validated if row is not None], [original])
        self.assertEqual(self.party.replies, [original])
        self.assertFalse(self.party.consumed)
        self.finish()
        self.assertEqual(self.party.consumed, {event_id: active['taskId']})
        self.assertFalse(self.party.calls)


if __name__ == '__main__':
    unittest.main()
