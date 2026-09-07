"""Run in the operations image: deterministic task/budget tests, no model calls."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'world/ops'))
if os.name != 'nt':
    import operations_native_tasks as native


@unittest.skipIf(os.name=='nt','fcntl ledger is exercised in the Linux operations image')
class NativeTaskTests(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory(); self.addCleanup(folder.cleanup)
        self.root=Path(folder.name)
        change=patch.object(native,'STATE',self.root); change.start(); self.addCleanup(change.stop)

    def test_rejected_role_cannot_call_api(self):
        with patch.object(native,'api') as api:
            for caller,target in [('mc-herald','default'),('default','default'),('default','host-admin')]:
                self.assertFalse(native.delegate(caller,target,'task')['ok'])
            api.assert_not_called()

    def test_native_submission_and_shared_cooldown(self):
        with patch.object(native,'api',return_value={'task_id':'task-fixture'}) as api:
            result=native.delegate('default','mc-herald','检查采集时间')
            self.assertTrue(result['ok'])
            payload=api.call_args.kwargs['json']
            self.assertEqual(payload['timeout'],180)
            self.assertEqual(payload['request_context']['root_agent_id'],'default')
            self.assertEqual(native.delegate('default','mc-priest','第二项')['code'],'delegation_cooldown')
            self.assertEqual(api.call_count,1)

    def test_uncertain_submission_is_charged_and_not_retried(self):
        with patch.object(native,'api',side_effect=TimeoutError) as api:
            value=native.delegate('default','mc-herald','检查状态')
            self.assertEqual(value['status'],'submission_uncertain')
            self.assertFalse(value['retryAutomatically'])
            self.assertEqual(native.delegate('default','mc-herald','同样任务')['code'],'delegation_cooldown')
            self.assertEqual(api.call_count,1)

    def test_rolling_day_and_cooldown_boundaries(self):
        now=100000
        self.assertEqual(native.budget_check([{'startedAt':now-1799}],now),'delegation_cooldown')
        self.assertIsNone(native.budget_check([{'startedAt':now-1800}],now))
        self.assertEqual(native.budget_check([{'startedAt':now-2000-i*2000} for i in range(4)],now),'daily_delegation_budget')
        self.assertIsNone(native.budget_check([{'startedAt':now-86400}],now))

    def test_task_ownership_and_poll_throttle(self):
        with patch.object(native,'api',return_value={'task_id':'task-fixture'}):
            native.delegate('default','mc-herald','测试')
        with patch.object(native,'api',return_value={'status':'finished','result':{'status':'completed'}}) as api:
            self.assertFalse(native.task_status('mc-herald','task-fixture')['ok'])
            self.assertEqual(native.task_status('default','other-task')['code'],'unknown_task')
            self.assertEqual(native.task_status('default','task-fixture')['status'],'finished')
            self.assertEqual(native.task_status('default','task-fixture')['code'],'poll_cooldown')
            self.assertEqual(api.call_count,1)


if __name__=='__main__': unittest.main()
