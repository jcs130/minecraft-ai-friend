"""Known-task GET recovery must never turn into another model submission."""
import copy
import sys
from pathlib import Path
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_survival_controller as fixture
from numen_gateway import read_json
from control import update_control


class PollRecoveryTests(unittest.TestCase):
    setUp = fixture.ControllerTests.setUp
    create = fixture.ControllerTests.create
    write = fixture.ControllerTests.write

    def test_transient_read_recovers_same_task_and_keeps_lease(self):
        self.controller.tick()
        task = self.controller.data['active']['taskId']
        lease = read_json(self.state / 'lease.json')
        self.backend.reply = httpx.ReadTimeout('fixture')
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'model_poll_wait')
        self.assertTrue(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(read_json(self.state / 'lease.json'), lease)
        self.controller.tick()
        self.assertEqual(self.backend.polled, [task])
        self.clock.now += 6
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': []}}
        self.controller.tick()
        self.assertIsNone(self.controller.data['active'])
        self.assertEqual(self.backend.polled, [task, task])
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.backend.cancelled, [])
        self.assertTrue(any(e['kind'] == 'model_poll_recovered' for e in self.controller.data['episodes']))

    def test_restart_keeps_retry_time_and_original_task_deadline(self):
        self.controller.tick()
        self.backend.reply = TimeoutError('fixture')
        self.controller.tick()
        active = copy.deepcopy(self.controller.data['active'])
        restarted = self.create()
        restarted.tick()
        self.assertEqual(restarted.data['active'], active)
        self.assertEqual(len(self.backend.polled), 1)
        self.clock.now += 91
        restarted.tick()
        self.assertEqual(restarted.data['pauseReason'], 'model_timeout')
        self.assertEqual(len(self.backend.polled), 1)
        self.assertEqual(len(self.backend.submitted), 1)

    def test_operator_pause_during_read_backoff_still_wins(self):
        self.controller.tick()
        self.backend.reply = TimeoutError('fixture')
        self.controller.tick()
        update_control(self.state, 'pause')
        self.controller.tick()
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(read_json(self.state / 'control.json')['pauseReason'], 'operator_pause')
        self.assertEqual(len(self.backend.cancelled), 1)
        self.assertEqual(len(self.backend.submitted), 1)

    def test_http_overload_retries_get_but_404_and_auth_do_not(self):
        self.controller.tick()
        request = httpx.Request('GET', 'http://fixture/task')
        self.backend.reply = httpx.HTTPStatusError('overload', request=request,
                                                  response=httpx.Response(503, request=request))
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'model_poll_wait')
        self.clock.now += 6
        self.backend.reply = httpx.HTTPStatusError('missing', request=request,
                                                  response=httpx.Response(404, request=request))
        self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'model_result_unknown')
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.backend.cancelled), 1)

    def test_auth_failure_is_not_treated_as_transient(self):
        self.controller.tick()
        request = httpx.Request('GET', 'http://fixture/task')
        self.backend.reply = httpx.HTTPStatusError('forbidden', request=request,
                                                  response=httpx.Response(403, request=request))
        self.controller.tick()
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(self.controller.data['pauseReason'], 'model_result_unknown')


if __name__ == '__main__':
    unittest.main()
