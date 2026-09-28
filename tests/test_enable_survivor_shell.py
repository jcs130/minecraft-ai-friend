"""Shell enablement changes one role security subtree after a private backup."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('survivor_shell_fixture', ROOT / 'tools/enable_survivor_shell.py')
shell = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell)


class ShellScopeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        marker = self.root / 'server/agents/work/learning-runtime.json'
        marker.parent.mkdir(parents=True)
        marker.write_text('{"qwenVersion":"2.2.1"}', encoding='utf8')
        native = shell.native
        with patch.object(native, 'package_version', return_value='2.2.1'), \
                patch.object(native, 'NATIVE_TOOLS', (*native.FILE_TOOLS,
                    'get_current_time', 'execute_shell_command')):
            self.agent = native.configure_native({'id': 'qd-survivor',
                'name': 'Kirito', 'active_model': {'provider_id': 'user-choice'}}, 'qd-survivor')
        guard = self.agent['security']['tool_guard']
        guard['guarded_tools'].append('execute_shell_command')
        guard['denied_tools'] += sorted(native.SURVIVOR_EXTRA_TOOLS)
        guard['auto_denied_rules'].append('QD_NATIVE_CRON_SCOPE')
        path = self.root / shell.RELATIVE
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(self.agent), encoding='utf8')

    def test_plan_preserves_enabled_tools_and_all_other_role_fields(self):
        before = (self.root / shell.RELATIVE).read_bytes()
        report = shell.run(self.root)
        self.assertTrue(report['changed'])
        self.assertEqual((self.root / shell.RELATIVE).read_bytes(), before)
        expected = shell.desired(self.agent, self.root)
        self.assertEqual(expected['tools'], self.agent['tools'])
        self.assertEqual(expected['active_model'], self.agent['active_model'])
        self.assertNotIn('execute_shell_command', expected['security']['tool_guard']['guarded_tools'])
        self.assertTrue(shell.native.SURVIVOR_EXTRA_TOOLS.isdisjoint(
            expected['security']['tool_guard']['denied_tools']))

    def test_apply_backups_original_and_changes_only_security(self):
        original = copy.deepcopy(self.agent)
        with patch.object(shell, 'require_stopped', return_value=[]), \
                patch.object(shell, 'require_idle', return_value={'paused': True}):
            result = shell.run(self.root, apply=True)
        self.assertTrue(result['changed'])
        backup = Path(result['backup']) / 'agent.json'
        self.assertEqual(json.loads(backup.read_text(encoding='utf8')), original)
        changed = json.loads((self.root / shell.RELATIVE).read_text(encoding='utf8'))
        changed['security'] = original['security']
        self.assertEqual(changed, original)

    def test_other_tool_changes_refuse_scope(self):
        self.agent['tools']['builtin_tools']['execute_shell_command']['enabled'] = False
        with self.assertRaises(ValueError):
            shell.desired(self.agent, self.root)


if __name__ == '__main__':
    unittest.main()
