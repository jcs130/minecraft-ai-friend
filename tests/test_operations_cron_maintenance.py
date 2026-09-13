from pathlib import Path
import importlib.util
import unittest

source=Path(__file__).resolve().parents[1]/'tools/operations_cron_maintenance.py'
spec=importlib.util.spec_from_file_location('cron_maintenance',source)
maintenance=importlib.util.module_from_spec(spec);spec.loader.exec_module(maintenance)


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.original={'spec':{'id':'job','enabled':True},'beforeState':{'last_status':'running'}}
        self.view={'spec':{'id':'job','enabled':False},'state':{'last_status':'error'}}
        self.idle={'status':'idle','running_task_count':0}
        self.history=[{'status':'error','run_at':'2026-09-13T23:47:00+08:00'}]
        self.captured=1789314360.0

    def test_idle_tracker_does_not_certify_running_cron(self):
        self.view['state']['last_status']='running'
        result=maintenance.readiness(self.original,self.view,self.idle,self.history,self.captured)
        self.assertIn('native_cron_running',result)

    def test_inflight_cycle_needs_terminal_after_pause_boundary(self):
        self.assertEqual(maintenance.readiness(self.original,self.view,self.idle,self.history,self.captured),[])
        result=maintenance.readiness(self.original,self.view,self.idle,[],self.captured)
        self.assertIn('inflight_native_terminal_not_observed',result)

    def test_enabled_or_changed_spec_is_not_safe_maintenance_boundary(self):
        self.view['spec']['enabled']=True
        self.view['spec']['id']='changed'
        result=maintenance.readiness(self.original,self.view,self.idle,self.history,self.captured)
        self.assertIn('native_spec_changed',result)
        self.assertIn('schedule_not_paused',result)


if __name__=='__main__':unittest.main()
