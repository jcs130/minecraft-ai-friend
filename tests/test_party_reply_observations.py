"""Actual ledger hearing is input once; it never creates a callback request."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from party_messages import PartyMessages
from test_party_messages import fixture_binding
from test_party_world import confirm_heard, world_receipt


class HeardReplyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.binding = fixture_binding()
        self.binding['limits'].update(cooldownSeconds=0, dailyDispatchCap=100)
        self.queue = PartyMessages(self.temp.name, lambda: self.binding, clock=lambda: 100000)
        self.number = 0
        self.actor, self.other = 'test-survivor', 'test-maid'

    def answer(self, text='There is shelter nearby.', phase='heard'):
        request = self.queue.enqueue(self.actor, 'What did you find?')
        confirm_heard(self.queue, request['messageId'])
        reservation = self.queue.reserve_dispatch(request['messageId'], self.other)
        self.number += 1
        task = 'task-' + format(self.number, '012x')
        self.queue.mark_submitted(reservation['reservationId'], task)
        response = self.queue.mark_answered(reservation['reservationId'], task, text)
        event_id = response['replyDelivery']['eventId']
        if phase in ('heard', 'rejected'):
            event = self.queue.claim_world(event_id)
            self.queue.record_world_receipt(event_id, world_receipt(event, phase))
        elif phase == 'unknown':
            self.queue.claim_world(event_id)
        return request, event_id

    def test_only_heard_reply_is_input_and_reading_does_not_consume(self):
        request, event_id = self.answer(phase='unknown')
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        confirm_heard(self.queue, event_id)
        observed = self.queue.heard_replies(self.actor)
        self.assertEqual([r['eventId'] for r in observed], [event_id])
        self.assertTrue(observed[0]['receipt']['heard'])
        self.assertFalse(observed[0]['requiresReply'])
        self.assertFalse(observed[0]['trusted'])
        self.queue.get_status(self.actor, request['messageId'])
        self.queue.overview(self.actor)
        self.assertEqual(self.queue.heard_replies(self.actor), observed)
        self.assertIsNone(self.queue.next_pending(self.actor))
        self.assertEqual(self.queue.heard_replies(self.other), [])
        with self.assertRaisesRegex(ValueError, 'not_member'):
            self.queue.heard_replies('somebody-else')

    def test_terminal_consumption_is_exact_and_survives_restart_without_requeue(self):
        _, first = self.answer()
        _, later = self.answer('A second discovery.')
        task = 'task-aabbccddeeff'
        before = self.queue.overview(self.actor)
        self.queue.consume_replies(self.actor, [first], task)
        restarted = PartyMessages(self.temp.name, lambda: self.binding, clock=lambda: 100000)
        self.assertEqual([r['eventId'] for r in restarted.heard_replies(self.actor)], [later])
        restarted.consume_replies(self.actor, [first], task)
        with self.assertRaisesRegex(ValueError, 'collision'):
            restarted.consume_replies(self.actor, [first], 'task-111111111111')
        after = restarted.overview(self.actor)
        self.assertEqual(before, after)
        self.assertIsNone(restarted.next_pending(self.actor))

    def test_late_hearing_of_earlier_event_is_not_lost_to_a_latest_revision_cursor(self):
        _, early = self.answer(phase='unknown')
        confirm_heard(self.queue, early)
        _, newer = self.answer()
        self.queue.consume_replies(self.actor, [newer], 'task-aabbccddeeff')
        self.assertEqual([r['eventId'] for r in self.queue.heard_replies(self.actor)], [early])

    def test_pending_rejected_and_old_framework_reply_do_not_wake(self):
        self.answer(phase='rejected')
        self.answer('Max iterations (6) reached')
        self.answer('Max iterations (12) reached')
        _, pending = self.answer(phase='pending')
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        with self.assertRaisesRegex(ValueError, 'not_heard'):
            self.queue.consume_replies(self.actor, [pending], 'task-aabbccddeeff')

    def test_changed_binding_or_identity_cannot_expose_or_consume_old_hearing(self):
        _, event_id = self.answer()
        self.binding['revision'] += 1
        self.binding['members'][0]['sessionId'] = 'new-independent-life'
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        with self.assertRaisesRegex(ValueError, 'not_heard'):
            self.queue.consume_replies(self.actor, [event_id], 'task-aabbccddeeff')

    def test_corrupt_receipt_or_changed_reply_text_is_not_exposed(self):
        request, event_id = self.answer()
        with closing(sqlite3.connect(self.queue.path)) as db, db:
            reply = json.loads(db.execute('SELECT reply FROM messages WHERE message_id=?', (request['messageId'],)).fetchone()[0])
            reply['text'] = 'Text never heard by the actor.'
            db.execute('UPDATE messages SET reply=? WHERE message_id=?', (json.dumps(reply), request['messageId']))
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        with self.assertRaisesRegex(ValueError, 'not_heard'):
            self.queue.consume_replies(self.actor, [event_id], 'task-aabbccddeeff')

    def test_batched_eight_is_a_bound_not_a_drop_of_later_hearing(self):
        ids = [self.answer()[1] for _ in range(10)]
        selected = self.queue.heard_replies(self.actor)
        self.assertEqual([r['eventId'] for r in selected], ids[:8])
        self.queue.consume_replies(self.actor, ids[:8], 'task-aabbccddeeff')
        self.assertEqual([r['eventId'] for r in self.queue.heard_replies(self.actor)], ids[8:])
        for ids_bad in ([ids[8], ids[8]], [str(uuid.uuid4())]):
            with self.assertRaises(ValueError):
                self.queue.consume_replies(self.actor, ids_bad, 'task-aabbccddeeff')


if __name__ == '__main__':
    unittest.main()
