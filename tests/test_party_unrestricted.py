"""Unlimited inference retains durable message identity and serial dispatch."""
import unittest
from contextlib import closing
from copy import deepcopy
import sqlite3
import test_party_messages as fixtures


class UnrestrictedPartyTests(unittest.TestCase):
    setUp = fixtures.PartyMessageTests.setUp
    enqueue = fixtures.PartyMessageTests.enqueue
    reserve = fixtures.PartyMessageTests.reserve
    submitted = fixtures.PartyMessageTests.submitted
    answer = fixtures.PartyMessageTests.answer

    def test_null_quota_has_no_cooldown_but_keeps_pending_and_unknown_serial(self):
        self.binding['limits'].update(dailyDispatchCap=None, cooldownSeconds=0)
        row = self.enqueue()
        reserved = self.reserve(row)
        self.assertTrue(reserved['claimed'])
        budget = self.ledger.budget_status(self.sender)
        self.assertIsNone(budget['dailyDispatchCap'])
        self.assertIsNone(budget['remaining'])
        self.assertFalse(budget['blocked'])
        self.assertEqual(budget['reservedDispatches24h'], 1)
        other = self.enqueue('another meaningful request')
        self.assertFalse(self.reserve(other)['claimed'])
        self.now += 86401
        self.assertFalse(self.reserve(other)['claimed'])

    def stored_rows(self):
        with closing(sqlite3.connect(self.ledger.path)) as db:
            return {table: db.execute('SELECT * FROM ' + table + ' ORDER BY rowid').fetchall()
                    for table in ('messages', 'reservations', 'world_speech', 'reply_consumptions')}

    def test_same_revision_policy_update_preserves_messages_hearing_and_consumption_exactly(self):
        first, reservation, task = self.submitted()
        self.answer(reservation['reservationId'], task, 'The shelter is here.')
        reply = self.ledger.heard_replies(self.sender)[0]
        pending = self.enqueue('Another original request')
        before = self.stored_rows()
        self.binding['limits'].update(dailyDispatchCap=None, cooldownSeconds=0)
        self.ledger = fixtures.PartyMessages(self.root, lambda: deepcopy(self.binding), clock=lambda: self.now)
        self.assertEqual(self.stored_rows(), before, 'Policy update cannot expire/rewrite/ack any message')
        self.assertEqual(self.ledger.heard_replies(self.sender), [reply])
        self.assertEqual(self.ledger.next_pending(self.recipient)['messageId'], pending['messageId'])
        self.assertEqual(self.ledger.get_status(self.sender, first['messageId'])['bindingRevision'], 1)
        self.assertEqual(self.ledger.budget_status(self.sender)['reservedDispatches24h'], 1)
        self.ledger.consume_replies(self.sender, [reply['eventId']], 'task-111111111111')
        consumed = self.stored_rows()
        self.binding['limits'].update(dailyDispatchCap=4, cooldownSeconds=10)
        self.ledger.overview(self.sender)
        self.assertEqual(self.stored_rows(), consumed)
        self.assertEqual(self.ledger.heard_replies(self.sender), [])

    def test_unknown_reservation_survives_policy_update_and_cannot_replay(self):
        pending = self.enqueue()
        reservation = self.reserve(pending)
        before = self.stored_rows()
        self.binding['limits'].update(dailyDispatchCap=None, cooldownSeconds=0)
        self.ledger = fixtures.PartyMessages(self.root, lambda: deepcopy(self.binding), clock=lambda: self.now)
        self.assertEqual(self.stored_rows(), before)
        self.assertEqual(self.ledger.active_for_recipient(self.recipient)['reservationId'], reservation['reservationId'])
        self.assertFalse(self.reserve(pending)['claimed'])
        self.assertEqual(self.ledger.budget_status(self.sender)['reservedDispatches24h'], 1)

    def test_policy_exception_cannot_hide_identity_or_queue_contract_changes(self):
        baseline = deepcopy(self.binding)
        mutations = [lambda b: b.update(enabled=False),
            lambda b: b['limits'].update(maxPending=17),
            lambda b: b['limits'].update(maxTextChars=500),
            lambda b: b['limits'].update(maxTtlSeconds=121),
            lambda b: b['limits'].update(maxMessages=200)]
        for field, value in [('agentId', 'new-maid'), ('bodyUuid', '00000000-0000-0000-0000-000000000004'),
                             ('ownerUuid', '00000000-0000-0000-0000-000000000004'),
                             ('sessionId', 'new-life'), ('userId', 'new-user')]:
            mutations.append(lambda b, field=field, value=value: b['members'][1].update({field: value}))
        for mutate in mutations:
            self.binding = deepcopy(baseline)
            self.binding['limits'].update(dailyDispatchCap=None, cooldownSeconds=0)
            mutate(self.binding)
            with self.assertRaisesRegex(ValueError, 'revision_collision'):
                self.ledger.overview(self.sender)
        self.binding = deepcopy(baseline)
        self.assertEqual(self.ledger.budget_status(self.sender)['reservedDispatches24h'], 0)


if __name__ == '__main__': unittest.main()
