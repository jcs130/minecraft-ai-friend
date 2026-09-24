"""Exact action boundaries must release recovery work without replaying skills."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from motor_mailbox import open_cognition, enqueue_locked, claim_locked, view
from motor_loop import tick
from numen_gateway import GatewayError, action_lock, read_json, write_json


class MotorBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = 1000
        write_json(self.root/'settings.json', {'asyncMotor': True})
        write_json(self.root/'control.json', {'enabled': True})
        write_json(self.root/'lease.json', {'status': 'closed'})
        open_cognition(self.root, 'survival-boundary-1', 1100000, lambda: self.now)
        self.calls, self.receipts, self.finalizations = [], {}, 0
        self.body = {'ok': True, 'position': {'x': 200, 'y': 64, 'z': 100},
                     'gameMode': 'survival', 'task': {'busy': False}}
        def outside(*args, **kwargs):
            raise GatewayError('outside_work_area')
        def action(turn, tool, args):
            self.calls.append((turn, tool, args))
            return {'ok': False, 'code': 'fixture_preflight_rejection'}
        self.controller = SimpleNamespace(root=self.root, clock=lambda: self.now,
            gateway=SimpleNamespace(_area=outside, turn_receipts=lambda turn: self.receipts.get(turn, []),
                open_lease=lambda *args: None, close_lease=lambda **kwargs: None, action=action),
            data={'actionExecution': {'inFlight': False}}, discard_policy=lambda: None,
            pause=lambda reason: self.fail(reason), save=lambda: None,
            collect_action_receipts=lambda turn: None, record=lambda *args, **kwargs: None,
            settle_practice=self.settle_practice)

    def enqueue(self, kind='action', payload=None):
        with action_lock(self.root):
            return enqueue_locked(self.root, 'survival-boundary-1', kind,
                payload or {'tool': 'goto', 'args': {'x': 180, 'y': 64, 'z': 100}}, lambda: self.now)

    def settle_practice(self):
        job = read_json(self.root/'skill-job.json')
        if job.get('practiceStarted') and not job.get('practiceFinalized'):
            self.finalizations += 1
            job['practiceFinalized'] = True
            write_json(self.root/'skill-job.json', job)

    def claimed_skill(self, status='running'):
        request = self.enqueue('skill', {'name': 'walk_program'})
        with action_lock(self.root):
            row = claim_locked(self.root, lambda: self.now)
        job = {'motorRequestId': request['requestId'], 'turnId': row['motorTurnId'],
               'name': 'walk_program', 'status': status, 'practiceStarted': True,
               'lastTurnId': 'skill-boundary-step', 'lastExecution': {
                   'turnId': 'skill-boundary-step', 'actionId': 'a' * 32}}
        write_json(self.root/'skill-job.json', job)
        receipt = {'turnId': 'skill-boundary-step', 'actionId': 'a' * 32,
                   'status': 'completed', 'completionConfirmed': True}
        self.receipts['skill-boundary-step'] = [receipt]
        self.controller.data['actionExecution']['receipt'] = receipt
        self.enqueue()
        return job

    def test_confirmed_preempt_terminal_releases_recovery_queue(self):
        self.enqueue()
        self.controller.data['motorStop'] = {'actionId': 'a' * 32}
        self.controller.data['actionExecution']['receipt'] = {
            'actionId': 'a' * 32, 'status': 'cancelled', 'completionConfirmed': True}
        tick(self.controller, self.body, {'enabled': True})
        self.assertNotIn('motorStop', self.controller.data)
        self.assertEqual([call[1] for call in self.calls], ['goto'])

    def test_confirmed_skill_boundary_finalizes_once_and_releases_recovery(self):
        self.claimed_skill()
        tick(self.controller, self.body, {'enabled': True})
        tick(self.controller, self.body, {'enabled': True})
        job = read_json(self.root/'skill-job.json')
        self.assertEqual(job['status'], 'replan')
        self.assertEqual(job['reason'], 'outside_work_area')
        self.assertTrue(job['practiceFinalized'])
        self.assertEqual(self.finalizations, 1)
        self.assertEqual(view(self.root)['requests'][0]['status'], 'failed')
        self.assertEqual([call[1] for call in self.calls], ['goto'])

    def test_dispatching_skill_is_never_retired_from_idle_alone(self):
        self.claimed_skill(status='dispatching')
        tick(self.controller, self.body, {'enabled': True})
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'dispatching')
        self.assertFalse(self.calls)
        self.assertEqual(self.finalizations, 0)

    def test_exact_rejection_releases_the_skill_as_failed_not_success(self):
        self.claimed_skill()
        self.receipts['skill-boundary-step'][0].update(status='rejected', completionConfirmed=False)
        tick(self.controller, self.body, {'enabled': True})
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'replan')
        self.assertEqual(view(self.root)['requests'][0]['status'], 'failed')
        self.assertEqual([call[1] for call in self.calls], ['goto'])

    def test_known_preflight_replan_without_action_receipt_still_finalizes(self):
        job = self.claimed_skill(status='replan')
        job.update(lastResult={'ok': False, 'code': 'walk_target_too_far',
                               'dispatched': False, 'writePerformed': False})
        write_json(self.root/'skill-job.json', job)
        self.receipts.clear()
        tick(self.controller, self.body, {'enabled': True})
        self.assertEqual(self.finalizations, 1)
        self.assertEqual(view(self.root)['requests'][0]['status'], 'failed')
        self.assertEqual([call[1] for call in self.calls], ['goto'])

    def test_unknown_or_running_native_action_cannot_finish_a_skill(self):
        self.claimed_skill()
        write_json(self.root/'lease.json', {'status': 'unknown'})
        tick(self.controller, self.body, {'enabled': True})
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'running')
        write_json(self.root/'lease.json', {'status': 'closed'})
        for blocker in ('unknown.json', 'inflight-action.json'):
            write_json(self.root/blocker, {'actionId': 'unresolved'})
            tick(self.controller, self.body, {'enabled': True})
            self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'running')
            (self.root/blocker).unlink()
        self.controller.data['actionExecution']['inFlight'] = True
        tick(self.controller, self.body, {'enabled': True})
        self.controller.data['actionExecution']['inFlight'] = False
        self.body['task']['busy'] = True
        tick(self.controller, self.body, {'enabled': True})
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'running')
        self.assertFalse(self.calls)
        self.assertEqual(self.finalizations, 0)

    def test_skill_requires_its_exact_confirmed_terminal_receipt(self):
        self.claimed_skill()
        receipt = self.receipts['skill-boundary-step'][0]
        for change in ({'actionId': 'b' * 32}, {'turnId': 'skill-other'},
                       {'completionConfirmed': False}, {'status': 'in_flight'}):
            self.receipts['skill-boundary-step'] = [receipt | change]
            tick(self.controller, self.body, {'enabled': True})
            self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'running')
        self.assertFalse(self.calls)
        self.assertEqual(self.finalizations, 0)


if __name__ == '__main__':
    unittest.main()
