import importlib.util
from pathlib import Path
import sys, types, unittest
from unittest.mock import Mock, patch


class BaseChild:
    def __init__(self,*args):
        self.process=Mock(pid=123);self.process.poll.return_value=None
        self.spec={'id':'gate','port':39477,'listenHost':'127.0.0.1','startupTimeoutSeconds':120}
        self.started=0;self.stop_started=0;self.ready=True;self.stopping=False
        self.problem=None;self.metrics={};self.failures=0;self.log=Mock()
        self.stop=Mock();self.failed=Mock()
    def state(self):return {'ready':self.ready}


fake=types.ModuleType('maw_service')
fake.CONSOLE_COMMANDS=frozenset();fake.Child=BaseChild;fake.Supervisor=object
for name in ('properties','read_json','submit','guard_console'):setattr(fake,name,Mock())
fake.utc=lambda:'observed';fake.check_owned_listener=Mock();fake.probe_service=Mock(return_value={})
spec=importlib.util.spec_from_file_location('tau_policy_test_target',Path(__file__).with_name('tau_service.py'))
target=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'maw_service':fake}):spec.loader.exec_module(target)


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        fake.check_owned_listener.reset_mock(side_effect=True)
        fake.probe_service.reset_mock(side_effect=True);fake.probe_service.return_value={}
        self.child=target.TauChild({},None,None);self.child.boot=None
        self.child._native_probe=Mock();self.child.probe_grace.success(100)

    def test_transient_login_load_is_reported_unhealthy_without_disconnect(self):
        fake.probe_service.side_effect=TimeoutError('probe timeout')
        with patch.object(target.time,'monotonic',return_value=105):self.child.tick()
        self.assertTrue(self.child.ready)
        self.assertFalse(self.child.state()['ready'])
        self.assertTrue(self.child.state()['servingDuringProbeGrace'])
        self.child.stop.assert_not_called()
        fake.check_owned_listener.assert_called_once()

    def test_expired_grace_stops_only_the_owned_child(self):
        fake.probe_service.side_effect=TimeoutError('probe timeout')
        with patch.object(target.time,'monotonic',return_value=131):self.child.tick()
        self.assertFalse(self.child.ready);self.child.stop.assert_called_once()

    def test_ownership_and_invalid_data_never_use_grace(self):
        fake.check_owned_listener.side_effect=RuntimeError('foreign listener')
        with patch.object(target.time,'monotonic',return_value=105):self.child.tick()
        self.assertFalse(self.child.ready);self.assertFalse(self.child.grace_active)
        fake.probe_service.assert_not_called()
        fake.check_owned_listener.side_effect=None;self.child.ready=True
        self.child._native_probe.side_effect=ValueError('invalid native health')
        with patch.object(target.time,'monotonic',return_value=106):self.child.tick()
        self.assertFalse(self.child.ready);self.assertFalse(self.child.grace_active)

    def test_exit_and_stop_timeout_do_not_force_terminate_or_replay(self):
        self.child.process.poll.return_value=3
        with patch.object(target.time,'monotonic',return_value=105):self.child.tick()
        self.assertIsNone(self.child.process);self.child.failed.assert_called_once_with(105)
        self.assertFalse(self.child.ready)
        second=target.TauChild({},None,None);second.stopping=True
        with patch.object(target.time,'monotonic',return_value=105):second.tick()
        self.assertEqual(second.problem,'stop_timeout: still running; no forced termination')
        second.process.terminate.assert_not_called();second.stop.assert_not_called()


if __name__=='__main__':unittest.main()
