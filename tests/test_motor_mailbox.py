import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from numen_gateway import action_lock, read_json, write_json
from motor_mailbox import open_cognition, cognition, enqueue_locked, claim_locked, finish_locked


class MailboxTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory(); self.addCleanup(t.cleanup)
        self.root = Path(t.name); self.now = 1000
        write_json(self.root/'control.json', {'schema':1,'enabled':True,'mission':'farm','missionChangedAt':1})
        write_json(self.root/'settings.json', {'asyncMotor':True})
        write_json(self.root/'lease.json', {'status':'open','turnId':'skill-current'})
        open_cognition(self.root, 'survival-plan-0001', 1100000, lambda:self.now)

    def enqueue(self, payload=None):
        with action_lock(self.root):
            return enqueue_locked(self.root, 'survival-plan-0001', 'action', payload or
                {'tool':'eat','args':{'item_id':'minecraft:bread'}}, lambda:self.now)

    def test_cognition_and_duplicate_commands_do_not_touch_body_lease(self):
        before = (self.root/'lease.json').read_bytes()
        first = self.enqueue(); second = self.enqueue()
        self.assertEqual(first['requestId'],second['requestId'])
        self.assertFalse(first['executionConfirmed'])
        self.assertEqual((self.root/'lease.json').read_bytes(),before)
        self.assertEqual(len(read_json(self.root/'motor-inbox.json')['requests']),1)

    def test_changed_goal_and_expired_cognition_cannot_enqueue(self):
        control = read_json(self.root/'control.json'); control['missionChangedAt']=2
        write_json(self.root/'control.json',control)
        with self.assertRaisesRegex(ValueError,'cognition_goal_changed'):self.enqueue()
        control['missionChangedAt']=1;write_json(self.root/'control.json',control)
        self.now=1101
        with self.assertRaisesRegex(ValueError,'cognition_expired'):self.enqueue()

    def test_claim_is_durable_and_cannot_be_claimed_twice(self):
        row=self.enqueue()
        with action_lock(self.root):
            claimed=claim_locked(self.root,lambda:self.now)
            self.assertEqual(claimed['requestId'],row['requestId'])
            self.assertIsNone(claim_locked(self.root,lambda:self.now))
            finish_locked(self.root,row['requestId'],'completed',{'actionId':'a'})
        self.assertEqual(read_json(self.root/'motor-inbox.json')['requests'][0]['status'],'completed')

    def test_old_queued_work_expires_when_goal_changes(self):
        self.enqueue()
        control=read_json(self.root/'control.json');control['missionChangedAt']=2
        write_json(self.root/'control.json',control)
        with action_lock(self.root):self.assertIsNone(claim_locked(self.root,lambda:self.now))
        self.assertEqual(read_json(self.root/'motor-inbox.json')['requests'][0]['status'],'expired')

    def test_drain_settles_claimed_receipt_without_dispatching_queued_work(self):
        from motor_loop import tick
        self.enqueue()
        self.enqueue({'tool': 'goto', 'args': {'x': 1, 'z': 2}})
        with action_lock(self.root):
            claimed = claim_locked(self.root, lambda: self.now)
        receipt = {'actionId': 'a' * 32, 'tool': 'eat', 'status': 'completed',
                   'completionConfirmed': True}
        controller = SimpleNamespace(root=self.root,
            gateway=SimpleNamespace(turn_receipts=lambda turn: [receipt]),
            data={}, pause=lambda reason: self.fail(reason))
        tick(controller, {}, {'drain': {'status': 'requested'}})
        rows = read_json(self.root/'motor-inbox.json')['requests']
        self.assertEqual(rows[0]['status'], 'completed')
        self.assertEqual(rows[0]['requestId'], claimed['requestId'])
        self.assertEqual(rows[1]['status'], 'queued')

    def test_turn_budget_is_bounded(self):
        for i in range(6):self.enqueue({'tool':'craft','args':{'item_id':'minecraft:stick','count':i+1}})
        with self.assertRaisesRegex(ValueError,'cognition_command_limit'):
            self.enqueue({'tool':'craft','args':{'item_id':'minecraft:stick','count':7}})

    def dispatch_with_contended_terminal_lock(self, receipt_status):
        from motor_loop import dispatch, reconcile
        self.enqueue({'tool': 'game_cast', 'args': {'skill_id': 'feed', 'params': {}}})
        held, release = threading.Event(), threading.Event()
        calls, pauses, receipts = [], [], {}
        def contender():
            with action_lock(self.root, blocking=True):
                held.set()
                release.wait(3)
        worker = threading.Thread(target=contender)
        def action(turn_id, tool, args):
            calls.append((turn_id, tool, args))
            if receipt_status is None:
                return {'ok': False, 'code': 'food_item_missing', 'dispatched': False,
                        'writePerformed': False}
            receipt = {'actionId': 'a' * 32, 'turnId': turn_id, 'tool': tool,
                'status': receipt_status, 'completionConfirmed': False,
                'result': {'ok': False, 'code': 'action_rejected',
                           'result': {'success': False, 'message': 'skill_archived'}}}
            receipts[turn_id] = [receipt]
            return {'ok': False, 'code': 'outcome_unknown' if receipt_status == 'unknown' else 'action_rejected',
                    'actionId': receipt['actionId']}
        def collect(turn_id):
            # A concurrent MCP status read takes the same real interprocess lock
            # after the effect has returned and its durable receipt is available.
            worker.start()
            self.assertTrue(held.wait(3))
            timer.start()
        timer = threading.Timer(.2, release.set)
        controller = SimpleNamespace(root=self.root, clock=lambda: self.now, data={},
            gateway=SimpleNamespace(open_lease=lambda *args: None, action=action,
                close_lease=lambda **kwargs: None, turn_receipts=lambda turn: receipts.get(turn, [])),
            collect_action_receipts=collect, record=lambda *args, **kwargs: None,
            pause=pauses.append)
        try:
            self.assertTrue(dispatch(controller))
        finally:
            release.set()
            if worker.ident is not None:
                worker.join(3)
            timer.cancel()
        row = read_json(self.root/'motor-inbox.json')['requests'][0]
        if receipt_status != 'unknown':
            reconcile(controller)
            self.assertFalse(dispatch(controller))
        self.assertEqual(len(calls), 1)
        return row, pauses

    def test_known_native_rejection_survives_terminal_lock_contention(self):
        row, pauses = self.dispatch_with_contended_terminal_lock('rejected')
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['receipt']['status'], 'rejected')
        self.assertEqual(row['receipt']['outcomeDetail'], 'skill_archived')
        self.assertFalse(pauses)

    def test_known_preflight_failure_survives_terminal_lock_contention(self):
        row, pauses = self.dispatch_with_contended_terminal_lock(None)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['receipt']['code'], 'food_item_missing')
        self.assertFalse(pauses)

    def test_unknown_receipt_still_pauses_after_terminal_lock_contention(self):
        row, pauses = self.dispatch_with_contended_terminal_lock('unknown')
        self.assertEqual(row['status'], 'unknown')
        self.assertEqual(pauses, ['motor_outcome_unknown'])

    def test_outside_area_still_polls_model_terminal_and_publishes_heartbeat(self):
        from test_survival_controller import ControllerTests
        fixture = ControllerTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        controller = fixture.controller
        controller.settings['asyncMotor'] = True
        controller.tick()
        task_id = controller.data['active']['taskId']
        previous_at = read_json(fixture.state/'heartbeat.json')['at']
        fixture.terminal()
        fixture.clock.now += 1
        fixture.gateway.body['position']['x'] = 200
        controller.pending_route = {'token': 'stale-route'}
        controller.pending_policy = {'token': 'stale-policy'}
        controller.pending_motor = {'token': 'stale-interrupt'}

        controller.tick()

        self.assertEqual(fixture.backend.polled, [task_id])
        self.assertIsNone(controller.data['active'])
        self.assertEqual(controller.data['motorStatus'], 'outside_work_area')
        self.assertIsNone(controller.pending_route)
        self.assertIsNone(controller.pending_policy)
        self.assertIsNone(controller.pending_motor)
        self.assertGreater(read_json(fixture.state/'heartbeat.json')['at'], previous_at)
        blocked = read_json(fixture.public)['motor']['blocked']
        self.assertEqual(blocked['code'], 'outside_work_area')
        self.assertEqual(blocked['position'], fixture.gateway.body['position'])
        self.assertTrue(read_json(fixture.state/'control.json')['enabled'])
        self.assertFalse(fixture.gateway.actions)

    def test_outside_area_reconciles_claimed_receipt_without_dispatch(self):
        from motor_loop import tick
        from numen_gateway import GatewayError
        self.enqueue()
        self.enqueue({'tool': 'goto', 'args': {'x': 1, 'z': 2}})
        with action_lock(self.root):
            claim_locked(self.root, lambda: self.now)
        receipt = {'actionId': 'a' * 32, 'tool': 'eat', 'status': 'completed',
                   'completionConfirmed': True}
        def outside(*args, **kwargs):
            raise GatewayError('outside_work_area')
        controller = SimpleNamespace(root=self.root,
            gateway=SimpleNamespace(_area=outside, turn_receipts=lambda turn: [receipt]),
            data={}, pause=lambda reason: self.fail(reason), discard_policy=lambda: None)

        tick(controller, {'position': {'x': 200, 'y': 64, 'z': 100}}, {})

        rows = read_json(self.root/'motor-inbox.json')['requests']
        self.assertEqual([row['status'] for row in rows], ['completed', 'queued'])
        self.assertEqual(controller.data['motorStatus'], 'outside_work_area')

    def test_other_area_errors_are_not_hidden(self):
        from motor_loop import tick
        from numen_gateway import GatewayError
        def broken(*args, **kwargs):
            raise GatewayError('work_area_missing')
        controller = SimpleNamespace(gateway=SimpleNamespace(_area=broken), data={})
        with self.assertRaisesRegex(GatewayError, 'work_area_missing'):
            tick(controller, {'position': {'x': 200, 'z': 100}}, {})

    def test_live_cognition_cannot_be_replaced(self):
        with self.assertRaisesRegex(ValueError, 'cognition_already_open'):
            open_cognition(self.root, 'survival-plan-0002', 1100000, lambda:self.now)

    def test_terminal_queue_retains_receipt_reference_not_observation_history(self):
        from motor_mailbox import view
        row=self.enqueue()
        with action_lock(self.root):
            claim_locked(self.root,lambda:self.now)
            finish_locked(self.root,row['requestId'],'completed',
                {'actionId':'a'*32,'status':'completed','completionConfirmed':True,
                 'before':{'inventory':'x'*200000},'after':{'inventory':'y'*200000}})
        saved=view(self.root)['requests'][0]
        self.assertNotIn('payload',saved)
        self.assertNotIn('before',saved['receipt'])
        self.assertEqual(saved['receipt']['actionId'],'a'*32)
        self.assertLess((self.root/'motor-inbox.json').stat().st_size,4000)

    def test_inbox_capacity_is_bounded_across_turns(self):
        from motor_mailbox import close_cognition
        for i in range(6):
            self.enqueue({'tool':'craft','args':{'item_id':'minecraft:stick','count':i+1}})
        close_cognition(self.root, 'survival-plan-0001')
        open_cognition(self.root, 'survival-plan-0002', 1100000, lambda:self.now)
        with action_lock(self.root):
            for i in range(2):
                enqueue_locked(self.root, 'survival-plan-0002','action',{'tool':'eat','args':{'n':i}},lambda:self.now)
            with self.assertRaisesRegex(ValueError, 'motor_inbox_full'):
                enqueue_locked(self.root, 'survival-plan-0002','action',{'tool':'eat','args':{'n':2}},lambda:self.now)


if __name__=='__main__':unittest.main()

