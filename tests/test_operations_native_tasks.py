"""Run in the operations image: deterministic task/budget tests, no model calls."""
import importlib.util
import json
from datetime import datetime, timezone
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

    def test_native_submission_and_durable_single_active_task(self):
        with patch.object(native,'api',return_value={'task_id':'task-fixture'}) as api:
            result=native.delegate('default','mc-herald','检查采集时间')
            self.assertTrue(result['ok'])
            payload=api.call_args.kwargs['json']
            self.assertEqual(payload['timeout'],180)
            self.assertEqual(payload['request_context']['root_agent_id'],'default')
            self.assertEqual(native.delegate('default','mc-priest','第二项')['code'],'operations_task_unresolved')
            self.assertEqual(sum(c.args[0] == 'POST' for c in api.call_args_list),1)

    def test_uncertain_submission_is_charged_and_not_retried(self):
        with patch.object(native,'api',side_effect=TimeoutError) as api:
            value=native.delegate('default','mc-herald','检查状态')
            self.assertEqual(value['status'],'submission_uncertain')
            self.assertFalse(value['retryAutomatically'])
            self.assertEqual(native.delegate('default','mc-herald','同样任务')['code'],'operations_task_unresolved')
            self.assertEqual(api.call_count,1)

    def test_no_daily_or_cooldown_cap_but_unknown_never_ages_out(self):
        now=100000
        self.assertIsNone(native.DAILY_LIMIT); self.assertEqual(native.COOLDOWN,0)
        self.assertIsNone(native.budget_check([{'startedAt':now,'status':'completed'}]*500,now))
        self.assertEqual(native.budget_check([{'startedAt':0,'status':'submission_uncertain'}],now),'operations_task_unresolved')

    def test_finished_receipt_is_written_before_next_submission(self):
        with patch.object(native,'api',return_value={'task_id':'task-fixture'}):
            native.delegate('default','mc-herald','一')
        with patch.object(native,'api',side_effect=[{'status':'finished','result':{'status':'completed'}}, {'task_id':'task-next'}]) as api:
            self.assertTrue(native.delegate('default','mc-priest','二')['ok'])
            self.assertEqual([c.args[0] for c in api.call_args_list],['GET','POST'])
        with native.ledger() as rows:
            self.assertEqual(next(r for r in rows if r['taskId']=='task-fixture')['status'],'completed')

    def test_receipt_unavailable_blocks_new_submissions(self):
        with patch.object(native,'api',return_value={'task_id':'task-fixture'}):
            native.delegate('default','mc-herald','一')
        with patch.object(native,'api',side_effect=TimeoutError) as api:
            self.assertEqual(native.delegate('default','mc-priest','二')['code'],'operations_task_unresolved')
            self.assertEqual([c.args[0] for c in api.call_args_list],['GET'])

    def test_fixed_coordinator_parent_can_have_only_one_child(self):
        from world_operations import JOB_ID
        parent=native.reserve_operation('default',JOB_ID)
        with patch.object(native,'api',return_value={'task_id':'task-child'}) as api:
            child=native.delegate('default','mc-herald','检查当前事实')
            self.assertTrue(child['ok']);self.assertEqual(child['parentRunId'],parent['runId'])
            self.assertEqual(native.delegate('default','mc-priest','第二个')['code'],'operations_task_unresolved')
            self.assertEqual(sum(c.args[0]=='POST' for c in api.call_args_list),1)
        native.finish_run(parent['runId'],'completed')
        with native.ledger() as rows:self.assertEqual(native.budget_check(rows,0),'operations_task_unresolved')

    def test_non_coordinator_cron_never_grants_parent_exception(self):
        native.reserve_operation('default','qd-learning-default')
        with patch.object(native,'api') as api:
            self.assertEqual(native.delegate('default','mc-herald','任务')['code'],'operations_task_unresolved')
            api.assert_not_called()

    def archive(self, row):
        report={'schema':1,'role':row['role'],'requestId':row['requestId'],'status':'proposed','worldActionsExecuted':0}
        archive={'schema':1,'project':'qiandengji-ops','runId':row['runId'],'ok':True,
            'backend':'qwenpaw-native-background-task','worldActionsExecuted':0,
            'finishedAt':datetime.fromtimestamp(row['startedAt']+1,timezone.utc).isoformat(),'roles':[{
                'role':row['role'],'requestId':row['requestId'],'taskId':row['taskId'],
                'nativeResultStatus':'completed','reportRecorded':True,'ok':True}]}
        path=self.root/'run-reports'/(row['runId']+'.json');path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(archive))
        target=self.root/'work/operations/reports'/row['role']/(row['requestId']+'.json')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report))
        return path,archive

    def test_exact_archived_native_completion_resolves_missing_live_task(self):
        with patch.object(native,'api',return_value={'task_id':'task-fixture'}):row=native.delegate('default','mc-herald','一')
        self.archive(row)
        with patch.object(native,'api',side_effect=TimeoutError):
            self.assertEqual(native.reconcile_pending()['reconciled'],[row['runId']])
        with native.ledger() as rows:
            self.assertEqual(rows[0]['status'],'completed')
            self.assertEqual(rows[0]['terminalEvidence'],'archived_native_receipt')
            self.assertEqual(len(rows[0]['evidenceSha256']),64)

    def test_wrong_archive_identity_or_missing_record_never_releases(self):
        with patch.object(native,'api',return_value={'task_id':'task-fixture'}):row=native.delegate('default','mc-herald','一')
        for change in ({'taskId':'other'},{'requestId':'other'},{'role':'mc-priest'},
                       {'nativeResultStatus':'running'},{'reportRecorded':False}):
            path,archive=self.archive(row);archive['roles'][0].update(change);path.write_text(json.dumps(archive))
            with patch.object(native,'api',side_effect=TimeoutError):self.assertEqual(native.reconcile_pending()['reconciled'],[])
        self.archive(row)
        (self.root/'work/operations/reports'/row['role']/(row['requestId']+'.json')).unlink()
        self.assertFalse(native.archived_terminal(row))

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
