import importlib.util
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('world_ops_probe',ROOT/'tools/world_operations_health.py')
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
from world_operations import world_job


class WorldOperationsHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.now=datetime(2026,9,8,14,25,tzinfo=timezone.utc).timestamp()
        self.native={'spec':world_job(),'state':{'last_status':'success','last_error':None,
            'last_run_at':datetime.fromtimestamp(self.now-10,timezone.utc).isoformat()}}
        self.context={'schema':1,'updatedAt':self.now,'today':'2026-09-08','nextDay':'2026-09-09',
            'eligibleIssuers':['hesu'],'existingPlan':{'status':'completed','questCount':1,'agentId':'qd-guild-planner'},
            'receipt':None,'publication':{'day':'2026-09-08','status':'published','questCount':2,'agentQuestCount':0}}
        self.write('server/panel-state/world-planning.json',self.context)
        self.write('server/mcdata/npc-health.json',{'updated_at':self.now,'guild_agent_enabled':True,'threads':{'guild-planner':True}})
        self.write('server/mcdata/village/agent-plans/2026-09-09.json',{'status':'completed','agentId':'qd-guild-planner','quests':{'hesu':{}}})
        self.write('server/mcdata/village/quests-2026-09-08.json',{'date':'2026-09-08','quests':[{},{}]})
        self.run={'runId':'world-test','jobId':probe.JOB_ID,'role':'default','source':'native-qwen-world-cron',
            'startedAt':self.now-60,'finishedAt':self.now-10,'status':'completed','executionStatus':'returned','deliveryStatus':'suppressed'}
        self.write('server/operations-agent-state/operations-budget/delegations.json',[self.run])
        self.last={'jobId':probe.JOB_ID,'role':'default','runId':'world-test','status':'finished'}
        self.write('server/operations-agent-state/work/workspaces/default/learning/last-cron.json',self.last)
        self.report={'schema':1,'role':'default','status':'proposed','requestId':'world-daily-2026-09-08','worldActionsExecuted':0,
            'createdAt':datetime.fromtimestamp(self.now-20,timezone.utc).isoformat(),'summary':'PRIVATE_REPORT_BODY'}
        self.report_path='server/operations-agent-state/work/operations/reports/default/world-daily-2026-09-08.json'
        self.write(self.report_path,self.report)
        hashes={}
        for name in probe.SOURCES:
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(name.encode())
            hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
        self.write('runtime/reports/world-daily-operations-candidate-20260908.json',{'totalTests':87,'modelCalls':0,'sourceHashes':hashes})

    def write(self,name,value):
        path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value),encoding='utf8')

    def request(self,route):
        if route=='/cron/jobs/'+probe.JOB_ID:return self.native
        self.assertEqual(route,'/mcp/tools/qiandeng_operations')
        return [{'name':n,'enabled':True} for n in ('operations_world_planning','operations_request_guild_plan')]

    def check(self):return probe.check(self.root,self.request,lambda:self.now)

    def test_real_evidence_passes_without_writes_or_private_text(self):
        before={p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result=self.check();self.assertTrue(result['ok']);self.assertTrue(result['ready'])
        self.assertEqual(result['evidence']['agentPublishedQuests'],0)
        self.assertEqual(result['evidence']['nextDayPublication'],'not_due')
        self.assertNotIn('PRIVATE_REPORT_BODY',json.dumps(result))
        self.assertEqual(before,{p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_configuration_without_executed_report_is_not_verified(self):
        (self.root/self.report_path).unlink()
        result=self.check();self.assertTrue(result['ready']);self.assertFalse(result['ok'])
        self.assertFalse(result['checks']['daily_run_and_report_verified'])

    def test_old_report_cannot_certify_new_run(self):
        self.report['createdAt']=datetime.fromtimestamp(self.now-3600,timezone.utc).isoformat();self.write(self.report_path,self.report)
        self.assertFalse(self.check()['checks']['daily_run_and_report_verified'])

    def test_weekly_maintenance_does_not_erase_daily_receipt(self):
        self.write('server/operations-agent-state/work/workspaces/default/learning/last-cron.json',{
            'jobId':'qd-learning-default','role':'default','status':'finished','runId':'new-weekly-run'})
        self.assertTrue(self.check()['checks']['daily_run_and_report_verified'])
        self.native['state']['last_status']='failed'
        self.assertFalse(self.check()['checks']['daily_run_and_report_verified'])

    def test_failed_or_unresolved_task_never_passes(self):
        for status in ('cron_reserved','submission_uncertain','failed'):
            self.write('server/operations-agent-state/operations-budget/delegations.json',[self.run|{'status':status}])
            self.assertFalse(self.check()['checks']['daily_run_and_report_verified'])

    def test_stale_consumer_or_disabled_native_job_is_red(self):
        self.context['updatedAt']=self.now-91;self.write('server/panel-state/world-planning.json',self.context)
        self.assertFalse(self.check()['checks']['consumer_fresh'])
        self.native['spec']['enabled']=False
        self.assertFalse(self.check()['checks']['native_daily_job_enabled'])

    def test_publication_summary_cannot_fake_generated_contracts(self):
        self.context['publication']['agentQuestCount']=2;self.write('server/panel-state/world-planning.json',self.context)
        result=self.check();self.assertFalse(result['checks']['publication_file_verified'])
        self.assertEqual(result['evidence']['agentPublishedQuests'],0)

    def test_plan_receipt_must_match_owned_private_files(self):
        self.context['receipt']={'status':'completed'};self.write('server/panel-state/world-planning.json',self.context)
        self.assertFalse(self.check()['checks']['planning_state_verified'])

    def test_changed_source_does_not_reuse_old_candidate_proof(self):
        (self.root/probe.SOURCES[0]).write_text('changed')
        self.assertFalse(self.check()['sourceCurrent'])

    def test_native_failure_does_not_get_hidden_by_local_config(self):
        def failure(_):raise OSError('unavailable')
        result=probe.check(self.root,failure,lambda:self.now)
        self.assertFalse(result['checks']['native_daily_job_enabled']);self.assertFalse(result['ok'])

    def test_manifest_probe_uses_selected_project_and_reports_unavailable(self):
        spec=importlib.util.spec_from_file_location('world_ops_manifest_fixture',ROOT/'world/ops/health/health_mon.py')
        health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)
        health.PROJECT=self.root
        helper=self.root/'tools/world_operations_health.py';helper.parent.mkdir()
        helper.write_text('def check(root):\n    assert str(root) == '+repr(str(self.root))+'\n    return {"ok": True, "modelRequests": 0, "worldActions": 0}\n')
        self.assertEqual(health.probe_world_operations(),{'ok':True,'modelRequests':0,'worldActions':0})
        helper.unlink()
        self.assertFalse(health.probe_world_operations()['ok'])


if __name__=='__main__':unittest.main()
