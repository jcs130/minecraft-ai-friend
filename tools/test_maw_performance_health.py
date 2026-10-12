import unittest
from maw_performance_health import assess


class PerformanceHealthTest(unittest.TestCase):
    def fixture(self):
        return dict(schemaVersion=1,runId='current',pid=123,sampledAt='2026-10-13T00:00:00Z',
            sampleCount=1200,windowCapacity=1200,meanMs=2,p50Ms=1,p95Ms=3,p99Ms=4,maxMs=60,
            slowTicksOver50Ms=1,uptimeSeconds=60,heapUsedBytes=1_000_000,
            heapCommittedBytes=2_000_000,heapMaxBytes=4_000_000,gcCount=2,gcTimeMs=10)
    def check(self, row): return assess(row,123,1791849605)
    def test_current_run(self):
        r=self.check(self.fixture());self.assertTrue(r['ok']);self.assertEqual(r['warnings'],[])
    def test_old_process_is_not_recovery(self):
        row=self.fixture();row['pid']=122;self.assertFalse(self.check(row)['ok'])
    def test_stale_snapshot(self):
        self.assertFalse(assess(self.fixture(),123,1791849630)['ok'])
    def test_nan_and_infinite_rejected(self):
        for bad in (float('nan'),float('inf'),-1):
            row=self.fixture();row['p99Ms']=bad;self.assertFalse(self.check(row)['ok'])
    def test_invalid_memory_and_percentiles(self):
        for key,value in [('heapUsedBytes',9_000_000),('p50Ms',10),('sampleCount',1201)]:
            row=self.fixture();row[key]=value;self.assertFalse(self.check(row)['ok'])
    def test_pressure_is_warning_without_restart(self):
        row=self.fixture();row.update(meanMs=45,p95Ms=55,p99Ms=60,heapUsedBytes=3_600_000,heapCommittedBytes=4_000_000)
        r=self.check(row);self.assertTrue(r['ok']);self.assertEqual(r['warnings'],['tick_budget_pressure','heap_pressure'])
    def test_absent_data_fails(self):self.assertFalse(self.check({})['ok'])


if __name__=='__main__':unittest.main()
