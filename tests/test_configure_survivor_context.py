import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import configure_survivor_context as configure
from numen_gateway import write_json, read_json


class ConfigureContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'server/survival-agent-state/survival/settings.json'
        self.before = {'bodyUuid': 'existing-body', 'mission': 'existing-goal', 'decisionsPerDay': 48}
        write_json(self.path, self.before)
        write_json(self.root / 'server/agents/work/learning-runtime.json', {'survivalRequestRuntimeVersion': 2})
        self.native = {'content': '# 桐人\n\n你有一个持久生活主会话。旧内容。\n\n保留个人笔记。', 'etag': 'original'}

    def file_api(self, role, name, content=None, etag=None):
        self.assertEqual((role, name), ('qd-survivor', 'AGENTS.md'))
        if content is not None:
            self.assertEqual(etag, self.native['etag'])
            self.native = {'content': content, 'etag': 'updated'}
        return dict(self.native)

    def test_preview_does_not_touch_native_or_local_state(self):
        with patch.object(configure, 'require_idle', side_effect=AssertionError):
            self.assertFalse(configure.configure(self.root)['applied'])
        self.assertEqual(read_json(self.path), self.before)

    def test_apply_preserves_other_fields_and_personal_notes(self):
        with patch.object(configure, 'require_idle'), patch.object(configure, 'workspace_file', self.file_api):
            self.assertTrue(configure.configure(self.root, True)['applied'])
        self.assertEqual(read_json(self.path), {**self.before, 'contextProtocol': 2})
        self.assertIn('保留个人笔记。', self.native['content'])
        self.assertEqual(self.native['content'].count('增量输入的 updates '), 1)
        self.assertEqual(len(list((self.root / 'runtime').rglob('settings-before.json'))), 1)

    def test_old_runtime_cannot_enable_protocol(self):
        write_json(self.root / 'server/agents/work/learning-runtime.json', {'survivalRequestRuntimeVersion': 1})
        with patch.object(configure, 'require_idle'), self.assertRaisesRegex(ValueError, 'not_loaded'):
            configure.configure(self.root, True)
        self.assertEqual(read_json(self.path), self.before)

    def test_active_controller_cannot_be_reconfigured(self):
        with patch.object(configure, 'require_idle', side_effect=ValueError('active')), self.assertRaisesRegex(ValueError, 'active'):
            configure.configure(self.root, True)
        self.assertEqual(read_json(self.path), self.before)


if __name__ == '__main__':
    unittest.main()
