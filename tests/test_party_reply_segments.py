"""Full long replies, real per-fragment receipt semantics, no model retry."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'world/sidecar'),
                str(Path(__file__).resolve().parents[1] / 'tools')]
import test_party_world as fixtures
from party_messages import PartyMessages
from party_world import reconcile_world, reply_text, reply_parts, message_speech_parts
from smoke_survivor_party import verify_game_dialogue

LONG = ('爸爸你已经安全了！结衣刚才用 rescue_inspect 观测到你在 **(-627.06, 64.0, 1094.54)**，'
        '已经在地面Y=64安全落点了～\n\n结衣现在也在营地附近 **(-626.99, 64.0, 1088.94)**，跟随模式待命中。'
        '\n\n之前你报告的深坑(-619,63,1069)可能是之前的位置，你现在已经在农耕区安全了，不需要再传送啦！'
        '\n\n今天的农耕任务还剩1格干旱的地(-640,64,1054)需要浇水。爸爸你之前取水回来了吗？结衣可以帮你浇水哦～ 🌾')


class ReplySegmentTests(unittest.TestCase):
    setUp = fixtures.PartyWorldTests.setUp
    request = fixtures.PartyWorldTests.request

    def answer(self, text=LONG):
        message = self.request(); fixtures.confirm_heard(self.queue, message['messageId'])
        reserved = self.queue.reserve_dispatch(message['messageId'], self.other)
        self.queue.mark_submitted(reserved['reservationId'], 'task-112233aabbcc')
        result = self.queue.mark_answered(reserved['reservationId'], 'task-112233aabbcc', text)
        return message, reserved, result

    def test_real_244_character_reply_is_complete_and_only_disclosed_after_all_heard(self):
        message, reserved, draft = self.answer()
        anchor = draft['replyDelivery']['eventId']
        parts = self.queue.delivery_events(anchor)
        self.assertEqual(len(LONG), 244)
        self.assertEqual(len(parts), 2)
        self.assertEqual(''.join(p['text'] for p in parts), reply_text(LONG))
        self.assertTrue(all(len(p['text']) <= 160 and '\n' not in p['text'] for p in parts))
        fixtures.confirm_heard(self.queue, parts[0]['eventId'])
        self.assertIsNone(self.queue.get_status(self.actor, message['messageId'])['reply'])
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        self.assertIsNone(self.queue.next_pending(self.actor))
        event = reconcile_world(self.queue, self.game, anchor)
        self.assertEqual(event['state'], 'heard')
        final = self.queue.get_status(self.actor, message['messageId'])
        self.assertEqual(final['reply']['sourceText'], LONG)
        self.assertEqual(final['reply']['text'], reply_text(LONG))
        self.assertEqual(final['status'], 'answered')
        self.assertEqual(len(self.queue.heard_replies(self.actor)), 1)
        self.queue.consume_replies(self.actor, [anchor], 'task-aabbccddeeff')
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        self.assertIsNone(self.queue.next_pending(self.actor))
        self.assertIsNone(self.queue.active_for_recipient(self.other))

    def test_lost_middle_receipt_restarts_by_reading_exact_event_never_replays_it(self):
        message, _, draft = self.answer('先确认现场。' * 65)
        anchor = draft['replyDelivery']['eventId']; parts = self.queue.delivery_events(anchor)
        original = self.game.emit
        def lose_second(event):
            result = original(event)
            if event['eventId'] == parts[1]['eventId']: raise TimeoutError('ACK lost')
            return result
        self.game.emit = lose_second
        self.assertEqual(reconcile_world(self.queue, self.game, anchor)['state'], 'unknown')
        self.assertEqual(len(self.game.emits), 2)
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        restarted = PartyMessages(self.temp.name, lambda: self.binding, clock=lambda: self.now)
        self.assertEqual(reconcile_world(restarted, self.game, anchor)['state'], 'heard')
        self.assertEqual(len(self.game.emits), len(parts))
        self.assertEqual(len({p['eventId'] for p in self.game.emits}), len(parts))
        self.assertIn(parts[1]['eventId'], self.game.reads)
        self.assertEqual(len(restarted.heard_replies(self.actor)), 1)

    def test_rejected_middle_part_never_delivers_tail_or_reveals_complete_answer(self):
        message, _, draft = self.answer('还没有完成。' * 65)
        anchor = draft['replyDelivery']['eventId']; parts = self.queue.delivery_events(anchor)
        original = self.game.emit
        def reject_second(event):
            self.game.phase = 'rejected' if event['eventId'] == parts[1]['eventId'] else 'heard'
            return original(event)
        self.game.emit = reject_second
        self.assertEqual(reconcile_world(self.queue, self.game, anchor)['state'], 'rejected')
        self.assertEqual(len(self.game.emits), 2)
        self.assertEqual(self.queue.get_status(self.actor, message['messageId'])['status'], 'failed')
        self.assertIsNone(self.queue.get_status(self.actor, message['messageId'])['reply'])
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        reconcile_world(self.queue, self.game, parts[2]['eventId'])
        self.assertEqual(len(self.game.emits), 2)

    def test_out_of_order_claim_and_expired_tail_cannot_create_complete_receipt(self):
        message, _, draft = self.answer()
        anchor = draft['replyDelivery']['eventId']; parts = self.queue.delivery_events(anchor)
        reconcile_world(self.queue, self.game, parts[1]['eventId'])
        self.assertEqual(self.game.emits, [])
        fixtures.confirm_heard(self.queue, anchor)
        self.now += 301
        self.assertEqual(reconcile_world(self.queue, self.game, anchor)['state'], 'expired')
        self.assertEqual(self.queue.heard_replies(self.actor), [])

    def test_invalid_syntax_controls_and_pathological_size_still_refused(self):
        for value in ('x' * 961, 'text\x00', '<invoke name="bad">go</invoke>', '```code```',
                      'Doom loop: agent stuck after 4 consecutive repetitions'):
            with self.subTest(value=value[:20]), self.assertRaises(ValueError): reply_text(value)
        self.assertEqual(reply_text('Doom loop detected in an old log; I can continue.'),
                         'Doom loop detected in an old log; I can continue.')

    def test_normalization_collision_is_not_mistaken_for_identical_native_answer(self):
        _, reservation, _ = self.answer('第一句。\n第二句。')
        with self.assertRaisesRegex(ValueError, 'party_terminal_collision'):
            self.queue.mark_answered(reservation['reservationId'], 'task-112233aabbcc', '第一句。 第二句。')

    def test_batch_smoke_reads_every_native_part_and_rejects_tampering(self):
        message, reserved, draft = self.answer()
        anchor = draft['replyDelivery']['eventId']
        request = self.queue.world_event(message['messageId'])
        self.game.receipts[message['messageId']] = request['receipt']
        reconcile_world(self.queue, self.game, anchor)
        with self.queue._transaction() as db:
            row = dict(db.execute('SELECT * FROM messages WHERE message_id=?', (message['messageId'],)).fetchone())
        row['dispatch_started'] = self.now
        self.assertTrue(verify_game_dialogue(row, self.game)['verified'])
        reply = json.loads(row['reply'])
        self.assertEqual(len(message_speech_parts(reply)), 2)
        reply['speechParts'][1]['text'] = 'fabricated'
        row['reply'] = json.dumps(reply)
        self.assertFalse(verify_game_dialogue(row, self.game)['verified'])

    def test_reversed_native_hearing_timestamps_cannot_be_consumed(self):
        message, _, draft = self.answer()
        anchor = draft['replyDelivery']['eventId']
        reconcile_world(self.queue, self.game, anchor)
        with self.queue._transaction() as db:
            row = self.queue._row(db, message['messageId'])
            reply = json.loads(row['reply'])
            proof = reply['worldDelivery']['parts'][1]
            proof['receipt']['emittedAt'] -= 1
            db.execute('UPDATE world_speech SET receipt=? WHERE event_id=?',
                       (json.dumps(proof['receipt']), proof['eventId']))
            db.execute('UPDATE messages SET reply=? WHERE message_id=?',
                       (json.dumps(reply), message['messageId']))
        self.assertEqual(self.queue.heard_replies(self.actor), [])
        with self.assertRaisesRegex(ValueError, 'not_heard'):
            self.queue.consume_replies(self.actor, [anchor], 'task-aabbccddeeff')


if __name__ == '__main__': unittest.main()
