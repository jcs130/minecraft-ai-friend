"""Offline scheduler checks: no task registration, inventory, Docker or models."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'tools'/f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
task = load('operations_inventory_task')
locking = load('operations_inventory_lock')


class FakeProcess:
    def __init__(self, output=b'', code=0, timeout=False):
        self.stdout = io.BytesIO(output)
        self.code = code
        self.timeout = timeout
        self.pid = 12345
    def wait(self, timeout):
        if self.timeout:
            raise subprocess.TimeoutExpired('fixed-fixture', timeout)
        return self.code
    def poll(self):
        return None if self.timeout else self.code


class InventoryTaskTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-inventory-task-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.spec = task.plan(root=self.root)
        self.raw = {'exists': True, 'xml': task.task_xml(self.spec, 'S-1-5-21-123-456-789-1001'),
                    'enabled': True, 'state': 3, 'lastTaskResult': 0}

    def test_default_and_install_without_execute_are_plans_without_external_calls_or_writes(self):
        with (patch.object(task, 'powershell', side_effect=AssertionError('No Scheduler')),
             patch.object(task, 'run_collector', side_effect=AssertionError('No collector')),
             patch.object(task, 'plan', return_value=self.spec), redirect_stdout(io.StringIO()) as output):
            for args in ([], ['plan'], ['install']):
                self.assertEqual(task.main(args), 0)
        self.assertIn('"applied": false', output.getvalue())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_execute_is_rejected_for_read_only_or_internal_actions(self):
        with (patch.object(task, 'query', side_effect=AssertionError('No Scheduler')),
             patch.object(task, 'run_collector', side_effect=AssertionError('No collector')),
             redirect_stdout(io.StringIO())):
            for action in ('plan', 'query', 'run'):
                self.assertEqual(task.main([action, '--execute', 'qiandengji']), 1)

    def test_task_is_fixed_hidden_pythonw_snapshot_with_bounded_repetition_and_no_elevation(self):
        self.assertEqual(self.spec['collector'][-2:], [str(self.root/'tools/operations.py'), 'snapshot'])
        self.assertEqual(Path(self.spec['action']['executable']).name, 'pythonw.exe')
        self.assertEqual(task.task_identity(self.raw, self.spec)['definitionMatches'], True)
        xml = self.raw['xml']
        for exact in ('<Interval>PT2M</Interval>', '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
                      '<ExecutionTimeLimit>PT100S</ExecutionTimeLimit>', '<LogonType>InteractiveToken</LogonType>',
                      '<RunLevel>LeastPrivilege</RunLevel>', '<WakeToRun>false</WakeToRun>'):
            self.assertIn(exact, xml)
        self.assertNotIn('<Duration>', xml)
        with self.assertRaises(ValueError):
            task.task_xml(self.spec, 'user; injected')

    def test_query_does_not_mark_foreign_or_changed_schedule_as_managed_and_ready(self):
        for old, new in [('snapshot', 'restart'), ('run</Arguments>', 'run extra</Arguments>'),
                         ('PT2M', 'PT10M'), ('PT100S', 'PT0S'), ('IgnoreNew', 'Parallel'),
                         ('LeastPrivilege', 'HighestAvailable'), ('InteractiveToken', 'Password')]:
            # The scheduler action contains wrapper run, not collector snapshot.
            if old not in self.raw['xml']:
                continue
            result = task.task_identity({**self.raw, 'xml': self.raw['xml'].replace(old, new)}, self.spec)
            self.assertFalse(result['definitionMatches'], old)
        foreign = task.task_identity({**self.raw, 'xml': self.raw['xml'].replace(task.MARKER, 'Someone else')}, self.spec)
        self.assertFalse(foreign['managed'])
        self.assertNotIn('xml', foreign)
        self.assertFalse(task.task_identity({'exists': False}, self.spec)['definitionMatches'])

    def test_install_refuses_foreign_fixed_name_before_registering(self):
        spec = {**task.plan(), 'filesReady': True}
        foreign = {**self.raw, 'xml': self.raw['xml'].replace(task.MARKER, 'Unrelated task')}
        with (patch.object(task, 'query_raw', return_value=foreign),
             patch.object(task, 'powershell', side_effect=AssertionError('Must not register'))):
            with self.assertRaises(ValueError):
                task.install(spec)

    def test_windows_normalized_durations_match_but_changed_limits_do_not(self):
        for duration, expected in [('PT1M40S', True), ('PT100S', True), ('PT90S', False),
                                   ('PT101S', False), ('PT0S', False), ('P', False),
                                   ('PT100.0S', False), ('PT1M41S', False)]:
            raw = {**self.raw, 'xml': self.raw['xml'].replace('PT100S', duration).replace('PT2M', 'PT120S')}
            with self.subTest(duration=duration):
                self.assertIs(task.task_identity(raw, self.spec)['definitionMatches'], expected)

    def test_explicit_install_dispatches_but_test_never_registers(self):
        with (patch.object(task, 'install', return_value={'ok': True, 'applied': True}) as install,
             redirect_stdout(io.StringIO()) as output):
            self.assertEqual(task.main(['install', '--execute', 'qiandengji']), 0)
        install.assert_called_once()
        self.assertTrue(json.loads(output.getvalue())['applied'])

    def test_omitted_windows_defaults_require_actual_com_values_and_strict_types(self):
        tree = ET.fromstring(self.raw['xml'])
        for path in ('Principals/Principal/RunLevel', 'Triggers/TimeTrigger/Enabled', 'Settings/Enabled', 'Settings/WakeToRun'):
            parts = path.split('/')
            parent = tree.find('/'.join(f'{{{task.NS}}}{part}' for part in parts[:-1]))
            parent.remove(parent.find(f'{{{task.NS}}}{parts[-1]}'))
        raw = {**self.raw, 'xml': ET.tostring(tree, encoding='unicode'),
               'effective': {'runLevel': 0, 'triggerEnabled': True, 'settingsEnabled': True, 'wakeToRun': False}}
        self.assertTrue(task.task_identity(raw, self.spec)['definitionMatches'])
        for bad in (None, {}, 'defaults'):
            self.assertFalse(task.task_identity({**raw, 'effective': bad}, self.spec)['definitionMatches'])
        for key, bad_values in [('runLevel', (None, False, 1, '0')),
                                ('triggerEnabled', (None, 1, False, 'true')),
                                ('settingsEnabled', (None, 1, False, 'true')),
                                ('wakeToRun', (None, 0, True, 'false'))]:
            for bad in bad_values:
                changed = {**raw, 'effective': {**raw['effective'], key: bad}}
                with self.subTest(key=key, bad=bad):
                    self.assertFalse(task.task_identity(changed, self.spec)['definitionMatches'])
            changed = {**raw, 'effective': {k: v for k, v in raw['effective'].items() if k != key}}
            self.assertFalse(task.task_identity(changed, self.spec)['definitionMatches'])

    def test_run_uses_only_fixed_collector_and_overwrites_bounded_valid_utf8_log(self):
        process = FakeProcess(('咏唱。'*task.LOG_LIMIT).encode('utf-8'))
        def launch(args, **kwargs):
            self.assertEqual(args, self.spec['collector'])
            self.assertEqual(kwargs['cwd'], self.root)
            self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
            self.assertEqual(kwargs['creationflags'], getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            return process
        result, code = task.run_collector(self.spec, launch)
        self.assertEqual(code, 0); self.assertTrue(result['ok']); self.assertTrue(result['outputTruncated'])
        log = self.root/'runtime/operations-inventory-task.log'
        self.assertLessEqual(log.stat().st_size, task.LOG_LIMIT)
        log.read_text('utf-8')
        task.run_collector(self.spec, lambda *a, **kw: FakeProcess(b'new run'))
        self.assertNotIn('咏唱', log.read_text('utf-8'))

    def test_busy_cli_is_reported_as_skipped_and_never_rewrites_snapshot(self):
        path = self.root/'server/panel-state/operations.json'
        path.parent.mkdir(parents=True)
        path.write_text('existing snapshot', encoding='utf-8')
        result, code = task.run_collector(self.spec, lambda *a, **kw: FakeProcess(b'{"skipped":true}', 75))
        self.assertEqual(code, 75); self.assertEqual(result['status'], 'skipped')
        self.assertFalse(result['ok'])
        self.assertEqual(path.read_text('utf-8'), 'existing snapshot')

    def test_timeout_terminates_only_owned_child_tree_and_records_failure(self):
        process = FakeProcess(b'partial', timeout=True)
        with patch.object(task, 'stop_owned_tree') as stop:
            result, code = task.run_collector(self.spec, lambda *a, **kw: process)
        stop.assert_called_once_with(process)
        self.assertEqual(code, 124); self.assertEqual(result['status'], 'timeout'); self.assertFalse(result['ok'])

    def test_launch_error_replaces_previous_success_without_private_exception_text(self):
        task.run_collector(self.spec, lambda *a, **kw: FakeProcess())
        def fail(*args, **kwargs):
            raise OSError('PRIVATE')
        result, code = task.run_collector(self.spec, fail)
        self.assertEqual(code, 1); self.assertFalse(result['ok'])
        receipt = (self.root/'runtime/operations-inventory-task.json').read_text('utf-8')
        self.assertNotIn('PRIVATE', receipt)
        self.assertFalse(json.loads(receipt)['ok'])

    def test_real_os_lock_blocks_another_process_and_releases_without_deleting_file(self):
        code = ('import importlib.util,sys; from pathlib import Path; '
                's=importlib.util.spec_from_file_location("lock",sys.argv[1]); '
                'm=importlib.util.module_from_spec(s);s.loader.exec_module(m); '
                'c=m.inventory_lock(Path(sys.argv[2])); '
                'print(c.__enter__(),flush=True); input(); c.__exit__(None,None,None)')
        child = subprocess.Popen([sys.executable, '-X', 'utf8', '-B', '-c', code,
                                  str(ROOT/'tools/operations_inventory_lock.py'), str(self.root)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, encoding='utf-8',
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            self.assertEqual(child.stdout.readline().strip(), 'True')
            with locking.inventory_lock(self.root, wait_seconds=0.05) as acquired:
                self.assertFalse(acquired)
            child.communicate('\n', timeout=3)
            self.assertEqual(child.returncode, 0)
            with locking.inventory_lock(self.root) as acquired:
                self.assertTrue(acquired)
            self.assertTrue((self.root/'runtime/operations-inventory.lock').is_file())
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=3)


if __name__ == '__main__':
    unittest.main()
