import importlib.util
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location('chat_review', Path(__file__).with_name('goddess_chat_review.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.log = self.root / 'latest.log'
        self.log.write_text('', encoding='utf8')
        from datetime import datetime
        self.now = datetime(2026, 10, 28, 20, 0).timestamp()
        self.players = {n: str(uuid.uuid5(uuid.NAMESPACE_DNS, n)) for n in ['Goddess', 'Yui', '.Fish', 'Coobot']}
        self.commands = []
        self.receipts = {}
        self.delivery_result = 1
        self.failure = None
        self.review = self.make_review()

    def tearDown(self): self.tmp.cleanup()

    def make_review(self):
        return m.Review(self.root / 'inbox.sqlite3', self.log, self.rcon,
                        clock=lambda: self.now, goddess_uuid=self.players['Goddess'])

    def rcon(self, q):
        self.commands.append(q)
        if q.startswith('minecraft:data get entity '):
            name = q.split()[3]
            if name not in self.players: return 'No entity was found'
            values = struct.unpack('>4i', uuid.UUID(self.players[name]).bytes)
            return f'{name} has the following entity data: [I; ' + ', '.join(map(str, values)) + ']'
        if q.startswith('minecraft:data get storage '):
            key = q.split()[-1]
            return ('Storage qiandengji:goddess_chat has the following contents: ' + str(self.receipts[key])) if key in self.receipts else 'Found no elements matching receipt'
        if q.startswith('minecraft:data remove storage '):
            self.receipts.pop(q.split()[-1], None)
            return 'Modified storage qiandengji:goddess_chat'
        self.assertIn(' run minecraft:msg @a[nbt={UUID:[I;', q)
        if self.failure: raise self.failure
        self.receipts[q.split()[5]] = self.delivery_result
        return '(RCON accepted command with empty text reply)'

    def append(self, text='回血能补饥饿吗', player='Yui', clock='20:00:00', newline=True):
        with self.log.open('a', encoding='utf8') as f:
            f.write(f'[{clock}] [Async Chat Thread - #170/INFO]: [Not Secure] <{player}> {text}' + ('\n' if newline else ''))

    def send(self, batch, index=0, topic='basic.food'):
        return self.review.whisper(batch['batchId'], batch['messages'][index]['id'], topic,
            '圣愈只回血，饱食补饥饿。先查：/mycli skills info food',
            'resource/NATIVE_RPG_CURRENT.md：food 补饥饿；selfheal 回血，已读当前发布记录。')

    def writes(self): return [q for q in self.commands if 'run minecraft:msg' in q]

    def test_public_only_excludes_private_commands_system_and_own(self):
        self.append()
        self.append('公告', 'Goddess')
        with self.log.open('a', encoding='utf8') as f:
            f.write('[20:00:00] [Server thread/INFO]: Yui issued server command: /login secret\n')
            f.write('[20:00:00] [Server thread/INFO]: [Coobot -> Yui] private words\n')
            f.write('[20:00:00] [Server thread/INFO]: MC_AUTH_STATE {}\n')
        batch = self.review.poll()
        self.assertEqual(len(batch['messages']), 1)
        self.assertEqual(batch['messages'][0]['player'], 'Yui')

    def test_accidental_credentials_never_enter_database(self):
        for text in ['/login hidden', '密码是hidden', 'api_key=hidden', '#invite=hidden', 'MC_AUTH_STATE {}']:
            self.append(text)
        self.assertEqual(self.review.poll()['status'], 'empty')
        db = sqlite3.connect(self.review.path)
        try:
            self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
        finally: db.close()

    def test_bootstrap_skips_old_chat_and_handles_midnight(self):
        self.append(clock='19:30:00')
        self.assertEqual(self.review.poll()['status'], 'empty')
        from datetime import datetime
        near_midnight = datetime(2026, 10, 29, 0, 1).timestamp()
        self.assertIsNotNone(m.parse_line('[23:59:30] [Async Chat Thread - #1/INFO]: <Yui> test', near_midnight))

    def test_partial_line_waits_for_newline(self):
        self.append(newline=False)
        self.assertEqual(self.review.poll()['status'], 'empty')
        with self.log.open('a', encoding='utf8') as f: f.write('\n')
        self.assertEqual(len(self.review.poll()['messages']), 1)

    def test_exclusive_lease_and_wrong_finish(self):
        self.append(); b = self.review.poll()
        self.assertEqual(self.make_review().poll()['status'], 'busy')
        with self.assertRaises(ValueError): self.review.finish('wrong')
        self.review.finish(b['batchId'])
        self.assertEqual(self.review.poll()['status'], 'empty')

    def test_crash_expired_lease_reclaims_without_losing_messages(self):
        self.append(); old = self.review.poll(); self.now += 241
        new = self.make_review().poll()
        self.assertEqual(new['messages'][0]['id'], old['messages'][0]['id'])
        with self.assertRaises(ValueError): self.send(old)

    def test_identity_does_not_change_when_an_expired_batch_is_reclaimed(self):
        self.append(); self.review.poll(); self.now += 241
        self.players['Yui'] = str(uuid.uuid4())
        new = self.review.poll()
        self.assertFalse(new['messages'][0]['onlineAtRead'])
        self.assertEqual(self.send(new)['reason'], 'recipient_offline_or_changed')

    def test_stale_file_is_not_mistaken_for_todays_chat(self):
        self.append(); os.utime(self.log, (self.now - 86400, self.now - 86400))
        self.assertEqual(self.review.poll()['status'], 'empty')

    def test_identity_reads_are_bounded_by_selected_messages(self):
        for i in range(500): self.append(player=f'old_{i}')
        self.append(player='Yui'); self.review.poll()
        self.assertLessEqual(len(self.commands), 24)

    def test_process_death_after_reservation_does_not_resend(self):
        self.append(); b = self.review.poll(); self.failure = SystemExit()
        with self.assertRaises(SystemExit): self.send(b)
        self.failure = None
        self.assertEqual(self.send(b)['status'], 'unknown')
        self.assertEqual(len(self.writes()), 1)

    def test_reviewed_context_keeps_subsequent_self_correction(self):
        self.append('我刚说错了'); old = self.review.poll(); self.review.finish(old['batchId'])
        self.append('明白，应该用饱食术')
        new = self.review.poll()
        self.assertEqual(len(new['messages']), 1)
        self.assertEqual(new['previousContext'][0]['text'], '我刚说错了')

    def test_backlog_prefers_latest_lines_in_original_order(self):
        for i in range(30): self.append(str(i))
        b = self.review.poll()
        self.assertEqual([r['text'] for r in b['messages']], list(map(str, range(6, 30))))
        self.assertEqual(b['skippedMessages'], 6)

    def test_success_native_sender_uuid_and_persistent_dedupe(self):
        self.append(); b = self.review.poll()
        self.assertEqual(self.send(b)['status'], 'server_confirmed')
        again = self.make_review().whisper(b['batchId'], b['messages'][0]['id'], 'basic.food',
                                          '相同消息', '已经核验的同一事实来源')
        self.assertTrue(again['replay']); self.assertFalse(again['resent'])
        self.assertEqual(len(self.writes()), 1)
        self.assertIn(m.selector(self.players['Goddess']), self.writes()[0])
        self.assertNotIn('tellraw', self.writes()[0])
        self.assertNotIn(' @a ', self.writes()[0])

    def test_timeout_is_unknown_and_never_resent(self):
        self.append(); b = self.review.poll(); self.failure = TimeoutError()
        self.assertEqual(self.send(b)['status'], 'unknown')
        self.failure = None
        self.assertTrue(self.send(b)['replay'])
        self.assertEqual(len(self.writes()), 1)

    def test_unknown_command_feedback_is_not_reported_delivered(self):
        self.append(); b = self.review.poll()
        original = self.review.rcon
        self.review.rcon = lambda q: 'No entity was found' if 'run minecraft:msg' in q else original(q)
        self.assertEqual(self.send(b)['status'], 'unknown')

    def test_native_receipt_confirms_empty_rcon_and_cleans_its_own_key(self):
        self.append(); b = self.review.poll()
        self.assertEqual(self.send(b)['status'], 'server_confirmed')
        self.assertEqual(self.receipts, {})
        self.assertTrue(any(q.startswith('minecraft:data get storage qiandengji:goddess_chat receipts.r') for q in self.commands))
        self.assertFalse(any('scoreboard' in q for q in self.commands))

    def test_native_zero_result_is_not_a_success(self):
        self.append(); b = self.review.poll(); self.delivery_result = 0
        self.assertEqual(self.send(b)['status'], 'not_sent')
        self.assertFalse(self.send(b)['resent'])
        self.assertEqual(len(self.writes()), 1)

    def test_timeout_after_execution_recovers_only_receipt_never_resends(self):
        self.append(); b = self.review.poll(); original = self.review.rcon
        def delayed(q):
            reply = original(q)
            if 'run minecraft:msg' in q: raise TimeoutError()
            return reply
        self.review.rcon = delayed
        self.assertEqual(self.send(b)['status'], 'server_confirmed')
        self.assertEqual(len(self.writes()), 1)

    def test_name_reused_for_different_uuid_is_not_messaged(self):
        self.append(); b = self.review.poll()
        self.players['Yui'] = str(uuid.uuid4())
        self.assertEqual(self.send(b)['reason'], 'recipient_offline_or_changed')
        self.assertFalse(self.writes())

    def test_goddess_offline_does_not_fallback_to_console_broadcast(self):
        self.append(); b = self.review.poll(); del self.players['Goddess']
        self.assertEqual(self.send(b)['reason'], 'goddess_offline_or_changed')
        self.assertFalse(self.writes())

    def test_target_not_in_batch_is_rejected(self):
        self.append(); b = self.review.poll()
        with self.assertRaises(ValueError):
            self.review.whisper(b['batchId'], 'somebody-else', 'basic.food', '说明', '已核验的真实来源和结论')
        self.assertFalse(self.writes())

    def test_bedrock_exact_player_supported(self):
        self.append(player='.Fish'); b = self.review.poll()
        self.assertEqual(self.send(b)['recipient'], '.Fish')
        self.assertIn(m.selector(self.players['.Fish']), self.writes()[0])

    def test_player_and_topic_cooldowns_across_instances(self):
        self.append(); b = self.review.poll(); self.send(b); self.review.finish(b['batchId'])
        self.now += 301; self.append(clock='20:05:01'); b = self.review.poll()
        self.assertEqual(self.send(b, topic='basic.heal')['reason'], 'recipient_cooldown')
        self.review.finish(b['batchId']); self.now += 310
        self.append(clock='20:10:11'); b = self.review.poll()
        self.assertEqual(self.send(b)['reason'], 'recipient_cooldown')

    def test_two_message_global_cap_survives_lease_change(self):
        for n in ['Yui', '.Fish', 'Coobot']: self.append(player=n)
        b = self.review.poll()
        self.send(b, 0); self.send(b, 1)
        self.assertEqual(self.send(b, 2)['reason'], 'batch_limit')
        self.review.finish(b['batchId']); self.append(player='Coobot')
        b = self.review.poll()
        self.assertEqual(self.send(b)['reason'], 'global_cooldown')

    def test_rotation_and_truncate_regrow_are_new_generation(self):
        self.append(); b = self.review.poll(); self.review.finish(b['batchId'])
        self.log.write_text('different header\n', encoding='utf8'); self.append('new content')
        b2 = self.review.poll()
        self.assertNotEqual(b['messages'][0]['id'], b2['messages'][0]['id'])
        self.review.finish(b2['batchId'])
        os.replace(self.log, self.root / 'rotated.log'); self.log.write_text('', encoding='utf8')
        self.append('new file')
        self.assertEqual(self.review.poll()['messages'][0]['text'], 'new file')

    def test_bounded_read_marks_gap(self):
        self.review.poll()
        self.log.write_bytes(b'x' * (m.MAX_READ * 2) + b'\n')
        self.append('fresh')
        batch = self.review.poll()
        self.assertGreater(batch['skippedBytes'], 0)
        self.assertEqual(batch['messages'][0]['text'], 'fresh')

    def test_text_controls_secrets_and_missing_evidence_rejected(self):
        self.append(); b = self.review.poll()
        for message, evidence in [('hi\n/say everyone', '真实来源和明确结论'), ('token=hidden', '真实来源和明确结论'),
                                  ('x' * 141, '真实来源和明确结论'), ('正确提示', '')]:
            with self.assertRaises(ValueError):
                self.review.whisper(b['batchId'], b['messages'][0]['id'], 'basic.food', message, evidence)
        self.assertFalse(self.writes())


if __name__ == '__main__': unittest.main()
