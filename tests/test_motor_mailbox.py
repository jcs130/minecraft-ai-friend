import tempfile
import unittest
from pathlib import Path

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

    def test_turn_budget_is_bounded(self):
        for i in range(6):self.enqueue({'tool':'craft','args':{'item_id':'minecraft:stick','count':i+1}})
        with self.assertRaisesRegex(ValueError,'cognition_command_limit'):
            self.enqueue({'tool':'craft','args':{'item_id':'minecraft:stick','count':7}})

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

