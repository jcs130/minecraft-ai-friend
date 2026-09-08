"""Paid submission must not repeat; completion and evidence must be real."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import exercise_minecraft_knowledge as e


class ExerciseTests(unittest.TestCase):
    def fixture(self, root):
        return {'ok': True, 'usageBefore': {'call_count': 0, 'prompt_tokens': 0, 'completion_tokens': 0},
                'protectedBefore': {'paused': True}, 'modelTasksSubmitted': 0}

    def test_uncertain_post_never_retries(self):
        calls = []
        def api(route, payload):
            calls.append(route)
            raise TimeoutError()
        with tempfile.TemporaryDirectory() as tmp, patch.object(e, 'preflight', self.fixture):
            root = Path(tmp)
            builder = lambda _: {'allowedTools': ['Skill', 'read_file'], 'payload': {'input': []}}
            # Adapt the preflight fixture to its get injection argument.
            with patch.object(e, 'preflight', lambda *args: self.fixture(root)):
                first = e.submit(root, api, builder)
                second = e.submit(root, api, builder)
            self.assertEqual(first['status'], 'submission_uncertain')
            self.assertEqual(second['status'], 'already_reserved_no_resubmit')
            self.assertEqual(len(calls), 1)
            self.assertTrue(e.read(root / e.MARKER)['postAttempted'])

    def test_acceptance_persists_task_before_any_get(self):
        calls = []
        def api(route, payload):
            calls.append(route)
            self.assertEqual(e.read(root / e.MARKER)['status'], 'submission_uncertain')
            return {'task_id': 'task-abc123'}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(e, 'preflight', lambda *args: self.fixture(root)):
                e.submit(root, api, lambda _: {'allowedTools': ['Skill'], 'payload': {}})
            self.assertEqual(e.read(root / e.MARKER)['taskId'], 'task-abc123')
            self.assertEqual(calls, ['/console/chat/task'])

    def test_prose_cannot_be_tool_evidence(self):
        self.assertEqual(e.trace({'messages': [{'type': 'message', 'content': [{'type': 'text',
             'text': '{"type":"plugin_call","name":"Skill"}'}]}]}), [])

    def test_trace_matches_real_call_id_and_error_state(self):
        history = {'messages': [
            {'type': 'plugin_call', 'content': [{'data': {'name': 'Skill', 'call_id': 'real',
                'arguments': '{"skill":"qd-minecraft-guide"}'}}]},
            {'type': 'plugin_call_output', 'content': [{'data': {'call_id': 'other', 'state': 'success', 'output': 'no'}}]},
            {'type': 'plugin_call_output', 'content': [{'data': {'call_id': 'real', 'state': 'denied', 'output': 'blocked'}}]}]}
        actual = e.trace(history)[0]
        self.assertEqual(actual['arguments'], {'skill': 'qd-minecraft-guide'})
        self.assertEqual(actual['toolState'], 'denied')
        self.assertEqual(actual['output'], 'blocked')

    def test_unknown_submission_cannot_collect_or_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            e.save(root / e.MARKER, {'postAttempted': True, 'status': 'submission_uncertain'})
            with self.assertRaisesRegex(ValueError, 'submission_unknown_do_not_retry'):
                e.collect(root, lambda *args: self.fail('no requests after unknown task id'))

    def test_finished_native_task_can_still_have_a_failed_model_response(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            before = {'call_count': 0, 'prompt_tokens': 0, 'completion_tokens': 0}
            e.save(root / e.MARKER, {'taskId': 'task-fixture', 'sessionId': 'fixture',
                'usageBefore': before, 'protectedBefore': {'paused': True}, 'allowedTools': ['Skill']})
            def get(route):
                if route.startswith('/console/chat/task/'):
                    return {'status': 'finished', 'result': {'status': 'failed',
                        'error': {'code': 'MODEL_QUOTA_EXCEEDED'}}}
                if route.startswith('/chats?'): return []
                return [{'agent_id': e.ROLE, **before}]
            with patch.object(e, 'protected', return_value={'paused': True}):
                result = e.collect(root, get)
            self.assertFalse(result['completed'])
            self.assertEqual(result['errorCode'], 'MODEL_QUOTA_EXCEEDED')

    def test_terminal_collection_does_not_replace_usage_with_later_activity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            e.save(root / e.MARKER, {'taskId': 'task-completed'})
            record = {'taskId': 'task-completed', 'nativeTask': {'result': {'status': 'completed'}},
                      'usageDelta': {'call_count': 3}, 'calls': []}
            e.save(root / e.REPORT, record)
            before = (root / e.REPORT).read_bytes()
            result = e.collect(root, lambda *a: self.fail('Terminal evidence must not call a live API again'))
            self.assertTrue(result['completed'])
            self.assertEqual(result['usageDelta'], {'call_count': 3})
            self.assertEqual(before, (root / e.REPORT).read_bytes())


if __name__ == '__main__': unittest.main()
