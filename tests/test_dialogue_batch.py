"""A single heard reply covers exactly the durably reserved utterances."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from party_messages import PartyMessages
from test_party_messages import fixture_binding
from test_party_world import confirm_heard, world_receipt


class DialogueBatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.binding = fixture_binding()
        self.binding['limits'].update(dailyDispatchCap=None, cooldownSeconds=0)
        self.now = 100000
        self.queue = PartyMessages(self.tmp.name, lambda: self.binding, clock=lambda: self.now)
        self.sender, self.recipient = 'test-maid', 'test-survivor'

    def message(self, text='Are you safe?', heard=True, **kw):
        message = self.queue.enqueue(self.sender, text, **kw)
        if heard:
            confirm_heard(self.queue, message['messageId'])
        return message['messageId']

    def reserve(self, primary, others):
        return self.queue.reserve_dispatch(primary, self.recipient, batch_ids=others)

    def status(self, mid):
        return self.queue.get_status(self.recipient, mid)

    def reply(self, reservation):
        rid, task = reservation['reservationId'], 'task-000000000001'
        self.queue.mark_submitted(rid, task)
        return self.queue.mark_answered(rid, task, '我在田边，会先处理补给。')['replyDelivery']['eventId']

    def test_bound_full_text_one_model_reservation_one_real_reply(self):
        ids = [self.message(text) for text in ('Are you safe?', 'I am beside the farm.', 'Please get food.', 'Later message')]
        batch = self.queue.dialogue_batch(ids[0], self.recipient)
        self.assertEqual([item['messageId'] for item in batch], ids[1:3])
        self.assertEqual([item['text'] for item in batch], ['I am beside the farm.', 'Please get food.'])
        reserved = self.reserve(ids[0], ids[1:3])
        self.assertTrue(reserved['claimed'])
        self.assertFalse(self.reserve(ids[0], ids[1:3])['claimed'])
        event = self.reply(reserved)
        self.assertEqual(self.status(ids[1])['status'], 'pending')
        confirm_heard(self.queue, event)
        for mid in ids[1:3]:
            row = self.status(mid)
            self.assertEqual(row['status'], 'observed')
            self.assertEqual(row['detail'], 'answered_together:' + ids[0])
            self.assertIsNone(row['reply'])
        self.assertEqual(self.status(ids[0])['status'], 'answered')
        self.assertEqual(self.status(ids[3])['status'], 'pending')
        self.assertEqual(self.queue.next_pending(self.recipient)['messageId'], ids[3])
        self.assertEqual(self.queue.budget_status(self.recipient)['reservedDispatches24h'], 1)

    def test_unknown_restart_and_ttl_do_not_release_or_repost(self):
        ids = [self.message(ttl_seconds=2), self.message(ttl_seconds=2)]
        reserved = self.reserve(ids[0], ids[1:])
        self.now += 1000
        self.queue = PartyMessages(self.tmp.name, lambda: self.binding, clock=lambda: self.now)
        self.assertIsNone(self.queue.next_pending(self.recipient))
        self.assertFalse(self.reserve(ids[1], [])['claimed'])
        self.assertEqual(self.status(ids[1])['status'], 'pending')
        self.assertEqual(self.queue.active_for_recipient(self.recipient)['reservationId'], reserved['reservationId'])

    def test_definitive_native_failure_releases_originals(self):
        ids = [self.message(), self.message()]
        r = self.reserve(ids[0], ids[1:])
        task = 'task-000000000001'
        self.queue.mark_submitted(r['reservationId'], task)
        self.queue.mark_failed(r['reservationId'], task, 'native_task_failed')
        self.assertEqual(self.queue.next_pending(self.recipient)['messageId'], ids[1])

    def test_rejected_reply_releases_members_without_hearing_claim(self):
        ids = [self.message(), self.message()]
        event = self.reply(self.reserve(ids[0], ids[1:]))
        claimed = self.queue.claim_world(event)
        self.queue.record_world_receipt(event, world_receipt(claimed, 'rejected'))
        self.assertEqual(self.status(ids[0])['status'], 'failed')
        self.assertEqual(self.queue.next_pending(self.recipient)['messageId'], ids[1])

    def test_known_no_submission_releases_batch_and_keeps_attempt_audit(self):
        ids = [self.message(), self.message()]
        r = self.reserve(ids[0], ids[1:])
        self.queue.mark_deferred(r['reservationId'], 'busy')
        self.assertEqual(self.queue.next_pending(self.recipient)['messageId'], ids[1])
        with self.queue._transaction() as db:
            self.assertEqual(db.execute('SELECT state FROM dialogue_batches').fetchone()[0], 'released')

    def test_unheard_or_classifying_message_cannot_enter_batch(self):
        a, b, c = self.message(), self.message(heard=False), self.message()
        self.queue.begin_attention(c, self.recipient)
        self.assertEqual(self.queue.dialogue_batch(a, self.recipient), [])
        self.assertEqual(self.reserve(a, [b])['dispatchStatus'], 'batch_changed')
        self.assertEqual(self.reserve(a, [c])['dispatchStatus'], 'batch_changed')
        self.assertIsNone(self.queue.active_for_recipient(self.recipient))

    def test_expired_snapshot_never_submits_a_partial_group(self):
        a, b = self.message(), self.message(ttl_seconds=1)
        self.assertEqual(len(self.queue.dialogue_batch(a, self.recipient)), 1)
        self.now += 2
        self.assertEqual(self.reserve(a, [b])['dispatchStatus'], 'batch_changed')
        self.assertEqual(self.status(a)['status'], 'pending')

    def test_stale_attention_cannot_consume_held_member(self):
        a, b = self.message(), self.message()
        self.queue.begin_attention(b, self.recipient)
        self.now += 6
        self.assertTrue(self.reserve(a, [b])['claimed'])
        self.assertFalse(self.queue.finish_attention(b, self.recipient, 'observe', {}))
        self.assertEqual(self.status(b)['status'], 'pending')

    def test_binding_change_does_not_retarget_held_utterances(self):
        a, b = self.message(), self.message()
        r = self.reserve(a, [b])
        self.binding['revision'] += 1
        self.binding['members'][0]['sessionId'] = 'new-life'
        self.assertIsNone(self.queue.next_pending(self.recipient))
        self.queue.mark_deferred(r['reservationId'], 'busy')
        self.assertEqual(self.queue.overview(self.sender)['counts']['expired'], 2)

    def test_partial_long_reply_does_not_settle_group(self):
        a, b = self.message(), self.message()
        r = self.reserve(a, [b])
        task = 'task-000000000001'
        self.queue.mark_submitted(r['reservationId'], task)
        row = self.queue.mark_answered(r['reservationId'], task, '我还没有完成任务。' * 30)
        parts = self.queue.delivery_events(row['replyDelivery']['eventId'])
        self.assertGreater(len(parts), 1)
        confirm_heard(self.queue, parts[0]['eventId'])
        self.assertEqual(self.status(b)['status'], 'pending')
        for part in parts[1:]:
            confirm_heard(self.queue, part['eventId'])
        self.assertEqual(self.status(b)['detail'], 'answered_together:' + a)

    def test_survivor_context_includes_complete_group_without_unheard_text(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
        from party import SurvivorParty
        a, b = self.message('Where are you?'), self.message('Correction: wait by the farm.')
        message = self.status(a)
        message['batchMessages'] = self.queue.dialogue_batch(a, self.recipient)
        party = SurvivorParty.__new__(SurvivorParty)
        context = party.context(message)
        self.assertIn(b, context)
        self.assertIn('Correction: wait by the farm.', context)
        message['batchMessages'][0]['worldDelivery']['receipt']['heard'] = False
        with self.assertRaisesRegex(ValueError, 'not_heard'):
            party.context(message)
