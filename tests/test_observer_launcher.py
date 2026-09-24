"""Observer joins before its target: supervise waiting without a second client."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import launch_observer_client as launcher
import observer_follow as follow
import psutil

OFFLINE = {'observerOnline': True, 'targetOnline': False,
           'observerSpectator': None, 'distance': None, 'dimensionMatch': None}
FOLLOWING = {'observerOnline': True, 'targetOnline': True,
             'observerSpectator': True, 'distance': 0.0, 'dimensionMatch': True}


class ObserverStartupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.process = Mock(pid=12345)
        self.process.name.return_value = 'javaw.exe'
        self.process.create_time.return_value = 10.0
        self.process.is_running.return_value = True
        self.state = self.work / 'client.json'
        self.state.write_text(json.dumps({'pid': 12345, 'name': 'ag_observer', 'startedAt': 10.0}))

    def test_start_arms_existing_watcher_before_target_returns(self):
        child = SimpleNamespace(pid=12345, poll=lambda: None)
        health = {'ok': True, 'active': True, 'status': 'waiting_target', **OFFLINE}
        base = {'assetIndex': {'id': 'fixture'}}
        mod = {'mainClass': 'fixture.Main', 'arguments': {'jvm': [], 'game': []}}
        output = io.StringIO()
        with patch.object(launcher, 'WORK', self.work), patch.object(launcher, 'prepare', return_value=(base, mod, [])), \
                patch.object(launcher, 'java_21', return_value=Path('fixture-javaw.exe')), \
                patch.object(launcher, 'online', side_effect=[False, True]), \
                patch.object(launcher, 'spectate', side_effect=RuntimeError('No entity was found')) as direct, \
                patch.object(launcher, 'ensure_follow', return_value=health) as managed, \
                patch.object(launcher.subprocess, 'Popen', return_value=child) as start, \
                patch.object(launcher.subprocess, 'CREATE_NEW_PROCESS_GROUP', 512, create=True), \
                patch.object(psutil, 'Process', return_value=self.process), redirect_stdout(output):
            self.assertEqual(launcher.main(['launcher', 'start']), 0)
        direct.assert_not_called()
        managed.assert_called_once_with()
        start.assert_called_once()
        self.assertIn('waiting for Kirito', output.getvalue())
        self.assertNotIn('spectating Kirito', output.getvalue())
        self.assertEqual(json.loads(self.state.read_text())['startedAt'], 10.0)

    def test_ensure_follow_accepts_managed_waiting_and_returns_evidence(self):
        health = {'ok': True, 'active': True, 'status': 'waiting_target', **OFFLINE}
        replies = [SimpleNamespace(returncode=0, stdout='task running', stderr=''),
                   SimpleNamespace(returncode=0, stdout=json.dumps(health), stderr='')]
        with patch.object(launcher, 'WORK', self.work), patch.object(psutil, 'Process', return_value=self.process), \
                patch.object(launcher.subprocess, 'run', side_effect=replies) as run, redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.ensure_follow(), health)
        self.assertEqual(run.call_count, 2)

    def test_ensure_follow_refuses_reused_pid_without_overwriting_start(self):
        self.process.create_time.return_value = 11.0
        before = self.state.read_bytes()
        health = {'ok': True, 'active': True, **OFFLINE}
        with patch.object(launcher, 'WORK', self.work), patch.object(psutil, 'Process', return_value=self.process), \
                patch.object(launcher.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(health))) as run, \
                redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'identity'):
                launcher.ensure_follow()
        run.assert_not_called()
        self.assertEqual(self.state.read_bytes(), before)

    def test_existing_online_client_is_never_launched_again(self):
        with patch.object(launcher, 'prepare', return_value=({}, {}, [])), \
                patch.object(launcher, 'online', return_value=True), patch.object(launcher.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(RuntimeError, 'already online'):
                launcher.main(['launcher', 'start'])
        start.assert_not_called()

    def test_check_reports_waiting_only_for_fresh_managed_heartbeat(self):
        health_file = self.work / 'follow.json'
        for age in (1, 11):
            with self.subTest(age=age):
                health_file.write_text(json.dumps({'active': True, 'clientPid': 12345, 'checkedAt': 100 - age}))
                output = io.StringIO()
                with patch.object(follow, 'FOLLOW_STATE', health_file), \
                        patch.object(follow, 'client_process', return_value=self.process), \
                        patch.object(follow, 'rcon_client', return_value=object()), \
                        patch.object(follow, 'sample', return_value=OFFLINE), \
                        patch.object(follow.time, 'time', return_value=100), redirect_stdout(output):
                    self.assertEqual(follow.check(), 0 if age == 1 else 1)
                value = json.loads(output.getvalue())
                self.assertEqual(value['status'], 'waiting_target' if age == 1 else 'watcher_unhealthy')

    def test_watcher_waits_then_attaches_when_target_returns(self):
        saved = []
        with patch.object(follow, 'client_process', side_effect=[self.process, self.process, self.process, None]), \
                patch.object(follow, 'rcon_client', return_value=object()), \
                patch.object(follow, 'sample', side_effect=[OFFLINE, {**FOLLOWING, 'distance': 24.0}, FOLLOWING]), \
                patch.object(follow, 'attach', return_value='Now spectating Kirito') as attach, \
                patch.object(follow, 'save_state', side_effect=saved.append), patch.object(follow, 'log'), \
                patch.object(follow.time, 'time', return_value=1000), patch.object(follow.time, 'sleep'):
            self.assertEqual(follow.watch(), 0)
        attach.assert_called_once()
        self.assertEqual(saved[0]['status'], 'waiting_target')
        self.assertEqual(saved[0]['lastAttemptAt'], 0)
        self.assertEqual(saved[1]['status'], 'following')
        self.assertEqual(saved[1]['recoveries'], 1)
        self.assertFalse(saved[-1]['active'])


if __name__ == '__main__':
    unittest.main()
