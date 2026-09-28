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

    def request_drain(self):
        control = {'enabled': True, 'drain': {'status': 'requested', 'requestId': 'operator-drain-exact'}}
        write_json(self.root/'control.json', control)
        return control

    def test_drain_between_ticks_retires_known_read_only_program_boundary(self):
        job = self.claimed_skill()
        job.pop('lastTurnId'); job.pop('lastExecution')
        job.update(steps=0, observations=1, lastObservation={'tool': 'navigation_sense'})
        write_json(self.root/'skill-job.json', job)
        control = self.request_drain()
        tick(self.controller, self.body, control)
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'cancelled')
        self.assertEqual(view(self.root)['requests'][0]['status'], 'cancelled')
        self.assertEqual(self.finalizations, 1)
        self.assertEqual(read_json(self.root/'control.json'), control)
        self.assertFalse(self.calls)

    def test_drain_waits_for_exact_native_terminal_then_finalizes_once_without_cancel(self):
        job = self.claimed_skill()
        action = {'tool': 'goto', 'args': {'x': 180, 'y': 64, 'z': 100}}
        job.update(lastAction=action, lastResult={'actionId': 'a'*32})
        write_json(self.root/'skill-job.json', job)
        self.receipts[job['lastTurnId']][0].update(action)
        control = self.request_drain()
        self.body['task']['busy'] = True
        tick(self.controller, self.body, control)
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'running')
        self.body['task']['busy'] = False
        tick(self.controller, self.body, control)
        tick(self.controller, self.body, control)
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'cancelled')
        self.assertEqual(view(self.root)['requests'][0]['status'], 'cancelled')
        self.assertEqual(self.finalizations, 1)
        self.assertEqual(read_json(self.root/'control.json'), control)
        self.assertFalse(self.calls)

    def test_drain_never_retires_unknown_mismatched_or_dispatching_program(self):
        job = self.claimed_skill()
        action = {'tool': 'goto', 'args': {'x': 180, 'y': 64, 'z': 100}}
        job.update(lastAction=action, lastResult={'actionId': 'a'*32})
        receipt = self.receipts[job['lastTurnId']][0] | action
        control = self.request_drain()
        cases = ('unknown_file', 'inflight_file', 'reserved_lease', 'unknown_lease',
                 'execution_pending', 'body_unavailable', 'dispatching', 'wrong_turn',
                 'wrong_action', 'wrong_args', 'unconfirmed', 'effect_unconfirmed', 'unknown_receipt')
        for case in cases:
            with self.subTest(case=case):
                write_json(self.root/'skill-job.json', job)
                current = dict(receipt)
                if case == 'unknown_file': write_json(self.root/'unknown.json', {'actionId': 'unknown'})
                if case == 'inflight_file': write_json(self.root/'inflight-action.json', {'actionId': 'flight'})
                if case in ('reserved_lease', 'unknown_lease'):
                    write_json(self.root/'lease.json', {'status': case.split('_')[0]})
                if case == 'execution_pending': self.controller.data['actionExecution']['inFlight'] = True
                if case == 'body_unavailable': self.body['ok'] = False
                if case == 'dispatching': write_json(self.root/'skill-job.json', job | {'status': 'dispatching'})
                if case == 'wrong_turn': current['turnId'] = 'other'
                if case == 'wrong_action': current['actionId'] = 'b'*32
                if case == 'wrong_args': current['args'] = {'x': 181, 'y': 64, 'z': 100}
                if case == 'unconfirmed': current['completionConfirmed'] = False
                if case in ('effect_unconfirmed', 'unknown_receipt'): current['status'] = case.replace('_receipt', '')
                self.receipts[job['lastTurnId']] = [current]
                tick(self.controller, self.body, control)
                self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'dispatching' if case == 'dispatching' else 'running')
                self.assertEqual(view(self.root)['requests'][0]['status'], 'claimed')
                self.assertEqual(self.finalizations, 0)
                for name in ('unknown.json', 'inflight-action.json'):
                    (self.root/name).unlink(missing_ok=True)
                write_json(self.root/'lease.json', {'status': 'closed'})
                self.controller.data['actionExecution']['inFlight'] = False
                self.body['ok'] = True
        self.assertFalse(self.calls)

    def test_drain_retries_practice_after_known_cancellation_without_redispatch(self):
        job = self.claimed_skill()
        job.pop('lastTurnId'); job.pop('lastExecution')
        job.update(steps=0, observations=1)
        write_json(self.root/'skill-job.json', job)
        control = self.request_drain()
        attempts = []
        def settle():
            attempts.append(True)
            if len(attempts) > 1:
                self.settle_practice()
        self.controller.settle_practice = settle
        tick(self.controller, self.body, control)
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'cancelled')
        self.assertEqual(view(self.root)['requests'][0]['status'], 'claimed')
        tick(self.controller, self.body, control)
        tick(self.controller, self.body, control)
        self.assertEqual(view(self.root)['requests'][0]['status'], 'cancelled')
        self.assertEqual(len(attempts), 2)
        self.assertEqual(self.finalizations, 1)
        self.assertFalse(self.calls)


if __name__ == '__main__':
    unittest.main()
