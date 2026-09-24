"""Real mutex contention must not silently discard an unqueued body request."""
from contextlib import contextmanager
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
import motor_mailbox as mailbox
import numen_gateway as gateway


TURN = 'survival-admission-0001'
ARGS = {'item_id': 'minecraft:bread'}


class ActionAdmissionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = 1000
        gateway.write_json(self.root / 'settings.json', {'asyncMotor': True})
        gateway.write_json(self.root / 'control.json', {'schema': 1, 'enabled': True})
        mailbox.open_cognition(self.root, TURN, 1100000, lambda: self.now)
        self.client = gateway.NumenGateway.__new__(gateway.NumenGateway)
        self.client.state, self.client.clock = self.root, lambda: self.now

    @contextmanager
    def held_lock(self, release_after=None, before_release=None):
        """Use a separate file description and the real platform OS mutex."""
        ready, release = threading.Event(), threading.Event()
        errors = []

        def hold():
            try:
                with gateway.action_lock(self.root, blocking=True):
                    ready.set()
                    release.wait(3 if release_after is None else release_after)
                    if before_release:
                        before_release()
            except BaseException as error:
                errors.append(error)
                ready.set()

        worker = threading.Thread(target=hold, daemon=True)
        worker.start()
        try:
            self.assertTrue(ready.wait(2), 'lock holder did not start')
            self.assertFalse(errors, errors)
            yield
        finally:
            release.set()
            worker.join(3)
            self.assertFalse(worker.is_alive(), 'lock holder did not stop')
            self.assertFalse(errors, errors)

    def eat(self):
        return self.client.action(TURN, 'eat', ARGS)

    def test_short_contention_waits_then_enqueues_exactly_once(self):
        with patch.object(self.client, 'snapshot') as snapshot, \
                patch.object(self.client, '_invoke') as invoke:
            with self.held_lock(release_after=0.02):
                reply = self.eat()
            self.assertEqual(reply['code'], 'motor_queued')
            self.assertEqual(self.eat()['requestId'], reply['requestId'])
            snapshot.assert_not_called()
            invoke.assert_not_called()
        self.assertEqual(len(mailbox.view(self.root)['requests']), 1)
        self.assertEqual(gateway.read_json(self.root / 'cognition-lease.json')['actionsUsed'], 1)

    def test_long_contention_has_bounded_wait_and_safe_same_request_retry(self):
        with self.held_lock():
            started = time.monotonic()
            reply = self.eat()
            elapsed = time.monotonic() - started
            self.assertEqual(reply['code'], 'action_busy')
            self.assertFalse(reply['dispatched'])
            self.assertFalse(reply['writePerformed'])
            self.assertFalse(reply['queued'])
            self.assertTrue(reply['retryable'])
            self.assertFalse(reply['retryAutomatically'])
            self.assertEqual(reply['retryAfterSeconds'], 0.1)
            self.assertEqual(reply['retryScope'], 'same_request_only')
            self.assertLess(elapsed, 0.3, 'admission must not wait seconds behind a slow holder')
            self.assertFalse((self.root / 'motor-inbox.json').exists())
            self.assertEqual(gateway.read_json(self.root / 'cognition-lease.json')['actionsUsed'], 0)
        accepted = self.eat()
        self.assertEqual(accepted['code'], 'motor_queued')
        self.assertEqual(self.eat()['requestId'], accepted['requestId'])
        self.assertEqual(len(mailbox.view(self.root)['requests']), 1)

    def test_authority_closed_while_waiting_is_rechecked_before_enqueue(self):
        def close():
            path = self.root / 'cognition-lease.json'
            gateway.write_json(path, gateway.read_json(path) | {'status': 'closed'})
        with self.held_lock(release_after=0.02, before_release=close):
            reply = self.eat()
        self.assertEqual(reply['code'], 'cognition_closed')
        self.assertTrue(reply['turnEnded']['authorityEnded'])
        self.assertFalse(reply['writePerformed'])
        self.assertNotIn('retryable', reply)
        self.assertFalse((self.root / 'motor-inbox.json').exists())

    def test_expiry_disable_and_unknown_are_rechecked_after_lock_wait(self):
        for mutation, expected in (
            (lambda: setattr(self, 'now', 1100), 'cognition_expired'),
            (lambda: gateway.write_json(self.root / 'control.json', {'schema': 1, 'enabled': False}), 'autonomy_disabled'),
            (lambda: gateway.write_json(self.root / 'unknown.json', {'actionId': 'a' * 32}), 'outcome_unknown'),
        ):
            with self.subTest(expected=expected):
                self.now = 1000
                gateway.write_json(self.root / 'control.json', {'schema': 1, 'enabled': True})
                with self.held_lock(release_after=0.02, before_release=mutation):
                    reply = self.eat()
                self.assertEqual(reply['code'], expected)
                self.assertNotIn('retryable', reply)
                self.assertFalse((self.root / 'motor-inbox.json').exists())

    def test_unknown_and_pending_existing_identity_never_get_a_new_request(self):
        first = self.eat()
        for state in ('claimed', 'unknown'):
            with self.subTest(state=state):
                data = mailbox.view(self.root)
                data['requests'][0]['status'] = state
                gateway.write_json(self.root / 'motor-inbox.json', data)
                with self.held_lock(release_after=0.02):
                    reply = self.eat()
                self.assertEqual(reply['requestId'], first['requestId'])
                self.assertEqual(reply['status'], state)
                self.assertNotIn('retryable', reply)
                self.assertEqual(len(mailbox.view(self.root)['requests']), 1)

    def test_error_after_entry_cannot_claim_no_write_or_authorize_replay(self):
        for error in ('action_busy', 'outcome_unknown'):
            with self.subTest(error=error), patch.object(mailbox, 'enqueue_locked',
                    side_effect=gateway.GatewayError(error)):
                reply = self.eat()
                self.assertEqual(reply['code'], error)
                self.assertFalse(reply['retryAutomatically'])
                self.assertNotIn('retryable', reply)
                self.assertNotIn('dispatched', reply)
                self.assertNotIn('writePerformed', reply)

    def test_default_motor_mutex_remains_immediate_under_contention(self):
        with self.held_lock():
            started = time.monotonic()
            with self.assertRaisesRegex(gateway.GatewayError, 'action_busy'):
                with gateway.action_lock(self.root):
                    self.fail('another owner still holds the mutex')
            self.assertLess(time.monotonic() - started, 0.1)


if __name__ == '__main__':
    unittest.main()
