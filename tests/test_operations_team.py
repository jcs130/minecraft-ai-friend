import importlib.util
import json
from pathlib import Path
import tempfile
from datetime import datetime, timezone, timedelta
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ops_tools',ROOT/'world/ops/operations_team_mcp.py')
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class OperationsTeamTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.public=self.root/'public'; self.public.mkdir()
        self.tools=module.OperationsTools('default',self.public,self.root/'operations')

    def snapshot(self,age=0):
        at=(datetime.now(timezone.utc)-timedelta(seconds=age)).isoformat()
        for name in ('world','operations','health'):
            (self.public/(name+'.json')).write_text(json.dumps({'generatedAt':at,'ok':True,'services':[
                {'id':'qwenpaw-ops','group':'operations'},{'id':'old','group':'legacy-team'}],'issues':[]}),encoding='utf8')

    def test_current_snapshot_carries_times_and_drops_old_services(self):
        self.snapshot(); value=self.tools.snapshot()
        self.assertTrue(value['ok']); self.assertFalse(value['worldActionsAllowed'])
        self.assertEqual([r['id'] for r in value['snapshots']['operations']['data']['services']],['qwenpaw-ops'])
        self.assertEqual(len(value['snapshots']['world']['sha256']),64)

    def test_stale_future_missing_and_malformed_are_not_live(self):
        for age in (301,-60):
            self.snapshot(age); self.assertFalse(self.tools.snapshot()['ok'])
        (self.public/'world.json').write_text('[]'); self.assertFalse(self.tools.snapshot()['ok'])
        (self.public/'world.json').unlink(); self.assertFalse(self.tools.snapshot()['ok'])

    def test_report_is_role_bound_and_duplicate_does_not_write_twice(self):
        args=('request_001','待核对',['状态来源：测试'],['司灯核对当前证据'])
        self.assertEqual(self.tools.submit(*args)['code'],'report_recorded')
        self.assertEqual(self.tools.submit(*args)['code'],'already_recorded')
        reports=self.tools.reports()['reports']; self.assertEqual(len(reports),1)
        self.assertEqual(reports[0]['role'],'default'); self.assertEqual(reports[0]['worldActionsExecuted'],0)
        with self.assertRaises(ValueError): self.tools.submit('request_001','改写旧报告',[],[])

    def test_paths_and_large_inputs_are_rejected(self):
        with self.assertRaises(ValueError): module.OperationsTools('../other',self.public,self.root)
        for key in ('../outside','/tmp/evil','short','../request_001'):
            with self.assertRaises(ValueError): self.tools.submit(key,'x',[],[])
        with self.assertRaises(ValueError): self.tools.submit('request_002','x',['y']*13,[])
        with self.assertRaises(ValueError): self.tools.submit('request_002','x'*2001,[],[])
        self.assertEqual(self.tools.reports()['reports'],[])

    def test_corrupt_report_is_not_published(self):
        folder=self.root/'operations/reports/default'; folder.mkdir(parents=True)
        (folder/'test.json').write_text('{bad')
        self.assertEqual(self.tools.reports()['reports'],[])

    def test_latest_report_is_ordered_by_timestamp_not_request_id(self):
        for index in range(4):
            self.tools.submit('zz_old_00'+str(index),'old',[],[])
        self.tools.submit('aa_latest_001','latest',[],[])
        self.assertEqual(self.tools.reports()['reports'][0]['summary'],'latest')
        self.assertEqual(len(self.tools.reports()['reports']),4)

    def test_multibyte_report_must_fit_read_limit(self):
        with self.assertRaises(ValueError):
            self.tools.submit('large_report','内容'*1000,['中文'*750]*12,[])
        self.assertEqual(self.tools.reports()['reports'],[])


if __name__=='__main__': unittest.main()
