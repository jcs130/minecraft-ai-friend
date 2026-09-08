from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
import world_team_mcp as team


class TeamLifeContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'survivor.json'
        self.now = 1788888000.0
        self.value = {
            'schema': 1, 'project': 'qiandengji-survivor',
            'generatedAt': datetime.fromtimestamp(self.now, timezone.utc).isoformat(),
            'status': 'paused', 'enabled': False, 'pauseReason': 'repeated_model_failure',
            'autonomous': True, 'goal': 'PRIVATE_GOAL', 'reasoning': 'PRIVATE_REASONING',
            'conversation': ['PRIVATE_CONVERSATION'],
            'lastDecision': {'taskId': 'task-fixture', 'completed': False, 'nativeTaskCompleted': True,
                'sessionId': 'PRIVATE_SESSION', 'actions': [{'thought': 'PRIVATE_ACTION'}], 'text': 'PRIVATE_DECISION'},
            'actionExecution': {'ok': True, 'inFlight': False, 'receipt': {'text': 'PRIVATE_RECEIPT'}},
            'body': {'ok': True, 'online': True, 'inventory': ['PRIVATE_INVENTORY'], 'bodyUuid': 'PRIVATE_UUID'},
            'bodyReconnect': {'status': 'verified', 'reason': 'same_body', 'detail': 'PRIVATE_RECONNECT'},
        }

    def snapshot(self):
        self.path.write_text(json.dumps(self.value), encoding='utf-8')
        return team.survivor_snapshot(self.root, clock=lambda: self.now)

    def test_paused_failure_is_visible_without_model_or_body_payload(self):
        result = self.snapshot()
        self.assertTrue(result['fresh'])
        self.assertEqual(result['pauseReason'], 'repeated_model_failure')
        self.assertFalse(result['enabled'])
        self.assertEqual(result['lastDecision'], {'taskId': 'task-fixture', 'completed': False, 'nativeTaskCompleted': True})
        self.assertEqual(result['actionExecution'], {'ok': True, 'inFlight': False})
        self.assertEqual(result['body'], {'ok': True, 'online': True})
        self.assertNotIn('PRIVATE_', json.dumps(result))

    def test_stale_and_future_data_are_unknown_not_live_paused_evidence(self):
        for offset in (-121, 6):
            with self.subTest(offset=offset):
                self.value['generatedAt'] = datetime.fromtimestamp(self.now + offset, timezone.utc).isoformat()
                result = self.snapshot()
                self.assertEqual(result['status'], 'unknown')
                self.assertFalse(result['fresh'])
                self.assertNotIn('pauseReason', result)
                self.assertNotIn('lastDecision', result)

    def test_missing_malformed_or_wrong_schema_has_no_fabricated_status(self):
        self.assertEqual(team.survivor_snapshot(self.root)['status'], 'unknown')
        for value in ([], {'schema': 1, 'project': 'wrong'}, self.value | {'enabled': 'false'},
                      self.value | {'generatedAt': '2026-09-09T00:00:00'}):
            with self.subTest(value_type=type(value).__name__):
                self.path.write_text(json.dumps(value), encoding='utf-8')
                self.assertEqual(team.survivor_snapshot(self.root, clock=lambda: self.now)['status'], 'unknown')
        self.path.write_text('invalid{', encoding='utf-8')
        self.assertFalse(team.survivor_snapshot(self.root)['ok'])

    def test_oversized_and_linked_path_are_rejected(self):
        self.path.write_bytes(b' ' * (2 * 1024 * 1024 + 1))
        self.assertEqual(team.survivor_snapshot(self.root)['code'], 'survivor_snapshot_invalid_file')
        self.snapshot()
        original = Path.is_symlink
        with patch.object(Path, 'is_symlink', lambda path: path == self.root or original(path)):
            result = team.survivor_snapshot(self.root, clock=lambda: self.now)
        self.assertEqual(result['code'], 'survivor_snapshot_invalid_path')

    def test_metadata_values_cannot_hide_arbitrary_nested_text(self):
        self.value['lastDecision']['taskId'] = {'reasoning': 'PRIVATE_TEXT'}
        result = self.snapshot()
        self.assertFalse(result['ok'])
        self.assertNotIn('PRIVATE_', json.dumps(result))

    def test_registered_tool_includes_life_projection_without_mutating_world_snapshot(self):
        class App:
            def __init__(self): self.tools = {}
            def tool(self):
                def add(fn): self.tools[fn.__name__] = fn; return fn
                return add
        app = App()
        team.register_team_tools(app, 'game:mc-god', state=self.root / 'team')
        projection = self.snapshot()
        with patch('operations_team_mcp.OperationsTools.snapshot', return_value={'ok': True, 'worldActionsAllowed': False}), \
             patch.object(team, 'survivor_snapshot', return_value=projection):
            result = app.tools['team_context']()
        self.assertEqual(result['survivor'], projection)
        self.assertEqual(result['world']['worldActionsExecuted'], 0)
        self.assertNotIn('worldActionsAllowed', result['world'])
        self.assertEqual(len(app.tools), 6)


if __name__ == '__main__': unittest.main()
