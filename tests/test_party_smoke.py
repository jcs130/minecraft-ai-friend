import copy
import json
from pathlib import Path
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from smoke_survivor_party import verify_reply, same_life_identity, live_owned_body, usage_snapshot, usage_changes, verify_game_dialogue
from party_world import speech_event
from test_party_world import world_receipt


class PartySmokeTests(unittest.TestCase):
    def setUp(self):
        self.members = {role: dict(agentId=role, bodyUuid='body-' + role, ownerUuid='owner-' + role,
            sessionId='life-' + role, userId='user-' + role, channel='console') for role in ('kirito', 'maid')}
        self.party = {'partyId': 'test', 'revision': 1}
        payload = {'sender': self.members['kirito'], 'recipient': self.members['maid'],
            'partyId': 'test', 'bindingRevision': 1, 'text': 'Need food?'}
        reply = {'sender': payload['recipient'], 'recipient': payload['sender'],
            'replyTo': 'message-1', 'requiresReply': False, 'text': 'I will check.'}
        self.row = {'payload': json.dumps(payload), 'reply': json.dumps(reply), 'message_id': 'message-1',
            'sender': 'kirito', 'recipient': 'maid', 'binding_revision': 1, 'status': 'answered',
            'reservation_state': 'answered', 'task_id': 'task-a', 'reservation_task_id': 'task-a'}
        self.native = {'status': 'completed', 'result': {'status': 'completed', 'session_id': 'life-maid',
            'output': [{'type': 'message', 'role': 'assistant', 'status': 'completed',
                        'content': [{'type': 'text', 'text': 'I will check.'}]}]}}
        self.chats = [{'id': 'chat-1', 'session_id': 'life-maid', 'user_id': 'user-maid', 'channel': 'console'}]

    def verify(self):
        return verify_reply(self.row, self.members, self.party, self.native, self.chats)

    def test_exact_native_receipt_without_chat_text_export(self):
        result = self.verify()
        self.assertTrue(result['verified'])
        self.assertNotIn('I will check.', json.dumps(result))

    def test_wrong_recipient_session_or_user_is_not_evidence(self):
        self.chats[0]['user_id'] = 'someone-else'
        self.assertFalse(self.verify()['verified'])

    def test_terminal_task_id_must_match_reservation(self):
        self.row['reservation_task_id'] = 'task-other'
        self.assertFalse(self.verify()['verified'])

    def test_reasoning_cannot_be_used_as_answer(self):
        self.native['result']['output'][0]['type'] = 'reasoning'
        self.assertFalse(self.verify()['verified'])

    def test_failed_native_task_does_not_verify_saved_text(self):
        self.native['status'] = 'failed'
        self.assertFalse(self.verify()['verified'])

    def test_saved_framework_limit_reply_is_not_a_real_answer_and_history_is_untouched(self):
        text = 'Max iterations (6) reached'
        reply = json.loads(self.row['reply']); reply['text'] = text
        self.row['reply'] = json.dumps(reply)
        self.native['result']['output'].append({'type': 'message', 'role': 'assistant', 'status': 'completed',
            'metadata': None, 'content': [{'type': 'text', 'text': text}]})
        before = copy.deepcopy(self.row)
        self.assertFalse(self.verify()['verified'])
        self.assertEqual(self.row, before)

    def test_old_binding_and_different_answer_fail(self):
        self.party['revision'] = 2
        self.assertFalse(self.verify()['verified'])
        self.party['revision'] = 1
        self.native['result']['output'][0]['content'][0]['text'] = 'Something else.'
        self.assertFalse(self.verify()['verified'])

    def test_reply_must_not_require_another_response(self):
        reply = json.loads(self.row['reply'])
        reply['requiresReply'] = True
        self.row['reply'] = json.dumps(reply)
        self.assertFalse(self.verify()['verified'])

    def test_life_report_matches_every_stable_identity_field(self):
        session = dict(primarySessionId='life-one', agentId='qd-survivor', bodyUuid='fixture-body',
                       userId='survival-controller', channel='console', chatId='fixture-chat')
        report = {'ok': True, 'session': copy.deepcopy(session)}
        self.assertTrue(same_life_identity(report, session))
        for field in session:
            with self.subTest(field=field):
                changed = copy.deepcopy(report)
                changed['session'][field] = 'different'
                self.assertFalse(same_life_identity(changed, session))

    def test_owner_must_be_online_and_maid_actually_loaded(self):
        maid, survivor = {'bodyUuid': 'maid-fixture'}, {'bodyUuid': 'kirito-fixture'}
        body = {'ok': True, 'identity': {'loaded': True, 'maidUuid': maid['bodyUuid'], 'ownerUuid': survivor['bodyUuid']},
                'state': {'ownerOnline': True}}
        self.assertTrue(live_owned_body(body, maid, survivor))
        for path, field, value in (('state', 'ownerOnline', False), ('identity', 'loaded', False),
                                   ('identity', 'ownerUuid', 'other-owner')):
            with self.subTest(field=field):
                changed = copy.deepcopy(body); changed[path][field] = value
                self.assertFalse(live_owned_body(changed, maid, survivor))

    def test_native_usage_is_filtered_per_role_and_counts_model_requests(self):
        party = {'partyId': 'fixture', 'revision': 1, 'members': [{'agentId': 'kirito'}, {'agentId': 'maid'}]}
        rows = [{'agent_id': 'kirito', 'call_count': 4, 'prompt_tokens': 120, 'completion_tokens': 30},
                {'agent_id': 'maid', 'call_count': 2, 'prompt_tokens': 80, 'completion_tokens': 20},
                {'agent_id': 'unrelated', 'call_count': 100, 'prompt_tokens': 999, 'completion_tokens': 888}]
        before = usage_snapshot(party, api=lambda *args: rows, clock=lambda: 100)
        rows[0]['call_count'] += 3; rows[0]['prompt_tokens'] += 25; rows[0]['completion_tokens'] += 10
        after = usage_snapshot(party, api=lambda *args: rows, clock=lambda: 101)
        delta = usage_changes(before, after)
        self.assertEqual(delta['kirito'], {'call_count': 3, 'prompt_tokens': 25, 'completion_tokens': 10})
        self.assertEqual(delta['maid'], {'call_count': 0, 'prompt_tokens': 0, 'completion_tokens': 0})
        self.assertEqual(set(delta), {'kirito', 'maid'})

    def test_missing_counter_wrong_binding_or_failed_read_is_unknown_not_zero(self):
        party = {'partyId': 'fixture', 'revision': 1, 'members': [{'agentId': 'maid'}]}
        rows = [{'agent_id': 'maid', 'call_count': 2, 'prompt_tokens': 80, 'completion_tokens': 20}]
        before = usage_snapshot(party, api=lambda *args: rows, clock=lambda: 100)
        after = usage_snapshot(party, api=lambda *args: rows, clock=lambda: 101)
        self.assertIsNone(usage_changes(None, after)['maid'])
        self.assertIsNone(usage_changes({**before, 'bindingRevision': 2}, after)['maid'])
        rows[0].pop('prompt_tokens')
        missing = usage_snapshot(party, api=lambda *args: rows, clock=lambda: 102)
        self.assertFalse(missing['roles']['maid']['available'])
        self.assertNotIn('call_count', missing['roles']['maid'])
        self.assertIsNone(usage_changes(before, missing)['maid'])
        def failed(*args): raise TimeoutError('fixture unavailable')
        error = usage_snapshot(party, api=failed, clock=lambda: 103)
        self.assertIsNone(usage_changes(before, error)['maid'])


class GameDialogueEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.message_id = str(uuid.UUID(int=100))
        first, second = ({'bodyUuid': str(uuid.UUID(int=i))} for i in (1, 2))
        self.messages = {
            'payload': {'messageId': self.message_id, 'sender': first, 'recipient': second,
                        'text': '在附近说话。', 'channel': 'nearby'},
            'reply': {'messageId': str(uuid.uuid5(uuid.UUID(self.message_id), 'reply')),
                      'sender': second, 'recipient': first, 'text': '我听见了。', 'channel': 'nearby',
                      'replyTo': self.message_id, 'requiresReply': False}}
        self.live = {}
        for message in self.messages.values():
            event = speech_event(message['messageId'], message['sender']['bodyUuid'], message['recipient']['bodyUuid'], message['text'])
            receipt = world_receipt(event)
            message['worldDelivery'] = {'eventId': event['eventId'], 'state': 'heard', 'receipt': copy.deepcopy(receipt)}
            self.live[event['eventId']] = receipt
        self.row = {'message_id': self.message_id, 'dispatch_started': 100001}
        self.reads = []

    def status(self, event_id):
        self.reads.append(event_id)
        return copy.deepcopy(self.live[event_id])

    def emit(self, *args):
        self.fail('Evidence collection must never speak in the world')

    def verify(self):
        row = self.row | {k: json.dumps(v) for k, v in self.messages.items()}
        return verify_game_dialogue(row, self)

    def test_two_world_receipts_are_required_and_private_text_not_exported(self):
        result = self.verify()
        self.assertTrue(result['verified'])
        self.assertEqual(len(self.reads), 2)
        self.assertNotIn('在附近说话。', json.dumps(result, ensure_ascii=False))
        self.assertNotIn('我听见了。', json.dumps(result, ensure_ascii=False))
        self.assertEqual({r['kind'] for r in result['events']}, {'request', 'reply'})

    def test_missing_saved_or_live_receipt_fails_closed(self):
        for kind in ('payload', 'reply'):
            with self.subTest(kind=kind):
                saved = copy.deepcopy(self.messages)
                self.messages[kind]['worldDelivery']['receipt'] = None
                self.assertFalse(self.verify()['verified'])
                self.messages = saved
                event_id = saved[kind]['messageId']
                receipt = self.live.pop(event_id)
                self.assertFalse(self.verify()['verified'])
                self.live[event_id] = receipt

    def test_request_or_reply_not_heard_never_count_as_conversation(self):
        for kind in ('payload', 'reply'):
            for state in ('pending', 'unknown', 'rejected', 'expired'):
                with self.subTest(kind=kind, state=state):
                    saved = copy.deepcopy(self.messages)
                    self.messages[kind]['worldDelivery']['state'] = state
                    self.assertFalse(self.verify()['verified'])
                    self.messages = saved

    def test_forged_receipt_identity_hash_or_wrong_channel_is_rejected(self):
        for kind in ('payload', 'reply'):
            for field, value in (('listenerUuid', str(uuid.UUID(int=200))), ('textSha256', 'f' * 64),
                                 ('channel', 'msg'), ('eventId', str(uuid.UUID(int=201)))):
                with self.subTest(kind=kind, field=field):
                    saved = copy.deepcopy(self.messages)
                    self.messages[kind]['worldDelivery']['receipt'][field] = value
                    self.assertFalse(self.verify()['verified'])
                    self.messages = saved

    def test_saved_and_live_spatial_receipts_must_be_same_event_observation(self):
        receipt = self.messages['reply']['worldDelivery']['receipt']
        receipt.update(listenerPosition=[0, 64, 0], distance=0)
        self.assertFalse(self.verify()['verified'])

    def test_live_unknown_or_rejected_does_not_verify_saved_heard_marker(self):
        for kind in ('payload', 'reply'):
            event_id = self.messages[kind]['messageId']
            saved = copy.deepcopy(self.live[event_id])
            for phase in ('unknown', 'rejected', 'not_found'):
                self.live[event_id].update(phase=phase, ok=False, heard=False)
                self.assertFalse(self.verify()['verified'])
            self.live[event_id] = saved

    def test_unrelated_event_ids_and_private_to_public_fallback_do_not_verify(self):
        self.messages['payload']['worldDelivery']['eventId'] = self.messages['reply']['messageId']
        self.assertFalse(self.verify()['verified'])
        self.messages['payload']['worldDelivery']['eventId'] = self.message_id
        self.messages['reply']['messageId'] = str(uuid.uuid4())
        self.assertFalse(self.verify()['verified'])
        self.messages['reply']['messageId'] = str(uuid.uuid5(uuid.UUID(self.message_id), 'reply'))
        self.messages['payload']['channel'] = 'msg'
        self.assertFalse(self.verify()['verified'])

    def test_model_dispatch_before_world_hearing_cannot_be_success(self):
        self.row['dispatch_started'] = 99998
        self.assertFalse(self.verify()['verified'])
        self.row['dispatch_started'] = None
        self.assertFalse(self.verify()['verified'])


if __name__ == '__main__':
    unittest.main()
