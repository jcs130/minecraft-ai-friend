import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from configure_sao_characters import managed_text, START, END
import configure_sao_characters as migration


class PersonaTests(unittest.TestCase):
    def test_managed_updates_preserve_other_memory_and_are_idempotent(self):
        prior = '# My life\nI learned how to build a camp.\n'
        initial = managed_text(prior, 'first persona')
        self.assertTrue(initial.startswith(prior))
        self.assertEqual(managed_text(initial, 'first persona'), initial)
        updated = managed_text(initial + '\nNew memories.\n', 'new persona')
        self.assertIn('New memories.', updated)
        self.assertNotIn('first persona', updated)
        self.assertEqual(updated.count(START), 1)

    def test_ambiguous_marker_refuses_overwriting_personal_content(self):
        with self.assertRaises(ValueError): managed_text(START + START + END, 'new')

    def test_character_contract_is_familial_and_actual_game_permissions_still_apply(self):
        settings = json.loads((ROOT / 'config/characters/sao.json').read_text(encoding='utf8'))
        self.assertEqual(settings['yui']['name'], '结衣')
        self.assertIn('心理健康咨询', settings['yui']['persona'])
        self.assertIn('爸爸', settings['kirito']['persona'])
        self.assertIn('真实游戏状态', settings['kirito']['persona'])
        self.assertIn('临时称呼', settings['yui']['persona'])

    def test_native_file_chunk_and_etag_are_required_before_any_put(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, limit): return json.dumps(self.value).encode()[:limit]
        response = Response()
        good = {'content': '完整的人设\n', 'etag': 'current-version', 'eof': True,
                'truncated': False, 'offset': 0}
        requests = []
        def opened(request, **kwargs):
            requests.append(request); return response
        with patch.object(migration.urllib.request, 'build_opener', return_value=SimpleNamespace(open=opened)):
            response.value = good
            self.assertEqual(migration.workspace_file('fixture-role', 'SOUL.md'), good)
            for change in ({'eof': False, 'truncated': True}, {'etag': None}, {'offset': 16}):
                response.value = good | change
                with self.assertRaises(ValueError): migration.workspace_file('fixture-role', 'SOUL.md')
            count = len(requests)
            with self.assertRaises(ValueError): migration.workspace_file('fixture-role', 'SOUL.md', 'new')
            self.assertEqual(len(requests), count)
            response.value = {'etag': 'new-version'}
            migration.workspace_file('fixture-role', 'SOUL.md', 'new', good['etag'])
            self.assertEqual(requests[-1].get_header('If-match'), good['etag'])

    def test_idle_boundary_checks_native_roles_body_lease_and_large_controller(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / 'server/survival-agent-state/survival'; state.mkdir(parents=True)
            (state / 'control.json').write_text(json.dumps({'enabled': False}))
            (state / 'controller.json').write_text(json.dumps({'active': None, 'history': 'x' * 300000}))
            calls = []
            def api(method, path, role):
                calls.append((method, path, role)); return {'running_task_count': 0}
            migration.require_idle('fixture-yui', root=root, call=api)
            self.assertEqual({c[2] for c in calls}, {'fixture-yui', 'qd-survivor'})
            for value in (None, True, 1):
                with self.subTest(count=value), self.assertRaises(ValueError):
                    migration.require_idle('fixture-yui', root=root, call=lambda *_: {'running_task_count': value})
            for status in ('unknown', 'reserved', 'open'):
                (state / 'lease.json').write_text(json.dumps({'status': status}))
                with self.subTest(lease=status), self.assertRaises(ValueError):
                    migration.require_idle('fixture-yui', root=root, call=api)
            (state / 'lease.json').write_text(json.dumps({'status': 'closed'}))
            migration.require_idle('fixture-yui', root=root, call=api)
            (state / 'inflight-action.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'still_in_flight'):
                migration.require_idle('fixture-yui', root=root, call=api)

    def test_unknown_submission_is_not_replayed_and_known_native_must_be_terminal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'server/mcdata/village/qwen-tasks/requests/task.json'
            path.parent.mkdir(parents=True)
            row = {'agentId': 'fixture-yui', 'status': 'submission_uncertain', 'taskId': None}
            path.write_text(json.dumps(row))
            with self.assertRaisesRegex(ValueError, 'unknown_submission'):
                migration.require_terminal_tasks('fixture-yui', root=root, call=lambda *_: self.fail('no network'))
            row['taskId'] = 'task-000000000000'; path.write_text(json.dumps(row))
            with self.assertRaisesRegex(ValueError, 'still_active'):
                migration.require_terminal_tasks('fixture-yui', root=root, call=lambda *_: {'status': 'running'})
            original = path.read_bytes()
            migration.require_terminal_tasks('fixture-yui', root=root, call=lambda *_: {'status': 'finished'})
            self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__': unittest.main()
