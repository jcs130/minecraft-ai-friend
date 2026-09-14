"""Exercise the real action mutex against an overlapping controller observation."""
import threading
import unittest

import test_survival_controller as fixtures
from numen_gateway import NumenGateway, action_lock, read_json, write_json


class DispatchRaceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ControllerTests('test_submission_persists_budget_and_reservation_before_http')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.state = self.fixture.state
        self.controller = self.fixture.controller
        self.gateway = self.fixture.gateway
        self.backend = self.fixture.backend
        self.gateway._settle_inflight = lambda body: None
        self.gateway.action_status = lambda body: NumenGateway.action_status(self.gateway, body)

    def writer(self):
        started, release = threading.Event(), threading.Event()
        errors = []

        def dispatch():
            try:
                with action_lock(self.state, blocking=True):
                    write_json(self.state / 'unknown.json', {'actionId': 'a' * 32})
                    started.set()
                    if not release.wait(5):
                        raise RuntimeError('controller blocked behind the active dispatch')
                    (self.state / 'unknown.json').unlink()
            except Exception as error:
                errors.append(error)

        thread = threading.Thread(target=dispatch, daemon=True)
        thread.start()
        self.assertTrue(started.wait(2))

        def finish():
            release.set()
            thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertFalse(errors, errors)

        return finish

    def assert_enabled(self):
        self.assertTrue(read_json(self.state / 'control.json')['enabled'])
        self.assertFalse(self.backend.cancelled)
        self.assertNotIn('task_stop', self.gateway.invoked)

    def test_marker_created_after_locked_status_does_not_disable_controller(self):
        self.controller.tick()
        original = self.gateway.action_status
        cleanups = []

        def overlapping_status(body):
            result = original(body)
            cleanups.append(self.writer())
            return result

        self.gateway.action_status = overlapping_status
        try:
            self.controller.tick()
            self.assert_enabled()
            self.assertEqual(len(self.backend.submitted), 1)
        finally:
            for finish in cleanups:
                finish()

    def test_locked_dispatch_waits_without_model_submission_or_pause(self):
        finish = self.writer()
        try:
            self.controller.tick()
            self.assert_enabled()
            self.assertFalse(self.backend.submitted)
            self.assertEqual(self.controller.data['status'], 'action_confirmation_wait')
            self.assertEqual(self.controller.data['actionExecution']['code'], 'action_busy')
        finally:
            finish()
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assert_enabled()

    def test_persistent_unknown_with_released_mutex_still_pauses(self):
        self.controller.tick()
        with action_lock(self.state, blocking=True):
            write_json(self.state / 'unknown.json', {'actionId': 'b' * 32})
        self.controller.tick()
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(self.controller.data['pauseReason'], 'action_outcome_unknown')
        self.assertTrue((self.state / 'unknown.json').exists())

    def test_receiptless_adapter_also_waits_for_dispatch_mutex(self):
        del self.gateway.action_status
        finish = self.writer()
        try:
            self.controller.tick()
            self.assert_enabled()
            self.assertFalse(self.backend.submitted)
        finally:
            finish()


if __name__ == '__main__':
    unittest.main()
