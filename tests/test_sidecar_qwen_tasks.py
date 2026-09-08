import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
from qwen_tasks import BASE, ROLES, LIMITS, QwenTasks, final_text, read_json, write_json


def completed(text='完成'):
    return {'status': 'finished', 'result': {'status': 'completed', 'output': [
        {'type': 'message', 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'text', 'text': text}]}]}}


class NativeTaskTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name); self.now = 100000
        self.routes = self.root / 'routes.json'
        write_json(self.routes, {'schema': 1, 'routes': {key: {'runtime': 'game', 'apiUrl': BASE, 'agentId': role}
            for key, role in ROLES.items()}})
        self.calls = []
        self.response = completed()
        self.error = None
        def api(method, path, role, payload=None):
            self.calls.append((method, path, role, payload))
            if self.error: raise self.error
            return {'task_id': 'task-012345abcdef'} if method == 'POST' else self.response
        self.client = QwenTasks(self.root / 'state', self.routes, transport=api, clock=lambda: self.now)

    def test_exact_native_route_no_provider_and_poll_extracts_only_completed_text(self):
        row = self.client.submit('guild_quest', '2026-09-09', '拟单')
        self.assertEqual(row['status'], 'submitted')
        method, path, role, payload = self.calls[0]
        self.assertEqual((method, path, role), ('POST', '/console/chat/task', 'qd-guild-planner'))
        self.assertEqual(payload['timeout'], 180)
        self.assertEqual(set(payload), {'channel','session_id','user_id','timeout','input','request_context'})
        self.assertEqual(payload['channel'], 'console')
        self.assertFalse(any(k in json.dumps(payload) for k in ('api_key', 'model', 'provider')))
        done = self.client.poll('guild_quest', '2026-09-09')
        self.assertEqual(done['text'], '完成'); self.assertEqual(done['status'], 'completed')
        self.client.submit('guild_quest', '2026-09-09', '拟单')
        with self.assertRaisesRegex(ValueError, 'qwen_request_conflict'):
            self.client.submit('guild_quest', '2026-09-09', 'Changed prompt')
        self.assertEqual(len(self.calls), 2)

    def test_native_mcp_readiness_list_is_accepted_but_task_shape_stays_strict(self):
        token = self.root / 'fixture-token'
        token.write_text('fixture-only-not-a-production-token', encoding='ascii')
        client = QwenTasks(self.root / 'http-fixture', self.routes, token=token)
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'[{"name":"identity","enabled":true}]'
        opener = Mock(); opener.open.return_value = response
        with patch('qwen_tasks.urllib.request.build_opener', return_value=opener):
            self.assertEqual(client._http('GET', '/mcp/tools/maid_native', 'fixture'), [{'name': 'identity', 'enabled': True}])
            with self.assertRaisesRegex(ValueError, 'qwen_response_invalid'):
                client._http('GET', '/console/chat/task/task-012345abcdef', 'fixture')

    def test_uncertain_submission_reserved_before_io_and_never_replayed_after_restart(self):
        self.error = OSError('lost reply')
        result = self.client.submit('guild_quest', 'tomorrow', 'q')
        self.assertEqual(result['status'], 'submission_uncertain')
        self.assertEqual(len(read_json(self.client.root / 'budget.json')), 1)
        clone = QwenTasks(self.client.root, self.routes, transport=Mock(side_effect=AssertionError('must not POST')), clock=lambda: self.now)
        self.assertEqual(clone.submit('guild_quest', 'tomorrow', 'q')['status'], 'submission_uncertain')
        self.now += 500
        self.assertEqual(self.client.submit('guild_quest', 'different-day', 'q')['status'], 'busy')
        self.now += 86401
        self.assertEqual(clone.submit('guild_quest', 'after-24h', 'q')['status'], 'busy')

    def test_native_failure_and_missing_task_never_produce_answer_or_trigger_post(self):
        self.client.submit('npc_dialogue', 'a', 'q')
        self.response = {'status': 'finished', 'result': {'status': 'failed', 'output': completed()['result']['output']}}
        self.assertEqual(self.client.poll('npc_dialogue', 'a')['status'], 'failed')
        self.assertEqual(self.client.poll('npc_dialogue', 'absent')['status'], 'not_submitted')
        self.assertEqual(sum(c[0] == 'POST' for c in self.calls), 1)

    def test_unrelated_roles_do_not_block_each_other_but_same_role_stays_serial(self):
        self.client.submit('npc_dialogue', 'a', 'q')
        self.assertEqual(self.client.submit('guild_quest', 'day', 'q')['status'], 'submitted')
        self.response = {'status': 'running'}
        self.now += 90000
        self.assertEqual(self.client.submit('npc_dialogue', 'b', 'q')['status'], 'busy')
        self.response = completed()
        self.now += 11
        self.client.poll('npc_dialogue', 'a')
        self.assertEqual(self.client.submit('npc_dialogue', 'b', 'q')['status'], 'submitted')

    def test_unlimited_purposes_keep_usage_without_a_cooldown_or_daily_cap(self):
        for purpose in ROLES:
            self.assertEqual(LIMITS[purpose], (None, 0))
            for i in range(30):
                row = self.client.submit(purpose, 'different-npc-' + str(i), 'q')
                self.assertEqual(row['status'], 'submitted')
                self.client.poll(purpose, 'different-npc-' + str(i))
        self.assertEqual(len(read_json(self.client.root / 'budget.json')), 90)

    def test_maid_usage_includes_failed_tasks_without_blocking_independent_characters(self):
        from types import SimpleNamespace
        bindings = {name: {'agentId': 'role-' + name, 'sessionId': 'life-' + name} for name in ('alice', 'bob')}
        self.client.maid_registry = SimpleNamespace(resolve=lambda maid, owner: bindings[maid])
        self.assertEqual(LIMITS['maid_dialogue'], (None, 0))
        for i in range(24):
            maid = 'alice' if i % 2 else 'bob'
            key = 'individual-' + str(i)
            row = self.client.submit('maid_dialogue', key, 'q', maid_uuid=maid, owner_uuid='fixture-owner')
            self.assertEqual(row['status'], 'submitted')
            self.response = completed() if i % 2 else {'status': 'finished', 'result': {'status': 'failed', 'output': []}}
            done = self.client.poll('maid_dialogue', key, maid_uuid=maid, owner_uuid='fixture-owner')
            self.assertEqual(done['status'], 'completed' if i % 2 else 'failed')
            self.now += 60
        self.assertEqual(self.client.submit('maid_dialogue', 'extra', 'q', maid_uuid='alice',
                         owner_uuid='fixture-owner')['status'], 'submitted')
        self.assertEqual(len(read_json(self.client.root / 'budget.json')), 25)
        self.assertEqual(sum(c[0] == 'POST' for c in self.calls), 25)

    def test_legacy_unknown_request_is_recovered_as_active_even_outside_usage_window(self):
        self.error = OSError('lost POST')
        self.client.submit('guild_quest', 'old', 'q')
        for path in (self.client.root / 'active-roles').glob('*.json'):
            path.unlink()
        self.now += 172800
        self.assertEqual(self.client.submit('guild_quest', 'new', 'q')['status'], 'busy')
        self.assertEqual(len(self.calls), 1)

    def test_bad_routes_and_arbitrary_purposes_never_touch_network(self):
        for changes in ({'apiUrl': 'http://evil/v1'}, {'agentId':'mc-god'}, {'runtime':'host'}):
            doc = read_json(self.routes); doc['routes']['guild_quest'].update(changes); write_json(self.routes,doc)
            with self.assertRaises(ValueError): self.client.submit('guild_quest','a','q')
        with self.assertRaises(ValueError): self.client.submit('model_call','a','q')
        self.assertEqual(self.calls, [])

    def test_poll_is_throttled_and_unknown_task_only_gets_polled(self):
        self.client.submit('npc_dialogue', 'a', 'q')
        self.error = OSError('native restart')
        self.assertEqual(self.client.poll('npc_dialogue', 'a')['status'], 'poll_unavailable')
        self.client.poll('npc_dialogue', 'a')
        self.assertEqual(len(self.calls), 2)
        self.now += 10; self.client.poll('npc_dialogue', 'a')
        self.assertEqual([c[0] for c in self.calls], ['POST','GET','GET'])

    def test_final_text_does_not_treat_tool_or_reasoning_as_final_answer(self):
        for changes in ({'type':'plugin_call'}, {'role':'tool'}, {'status':'in_progress'},
                        {'content':[{'type':'reasoning','text':'hidden'}]}):
            value = completed(); value['result']['output'][0].update(changes)
            self.assertIsNone(final_text(value))
        self.assertIsNone(final_text(completed('x' * 16001)))

    def test_native_iteration_sentinel_is_failed_without_fallback_or_new_post(self):
        for limit in (4, 6, 12):
            value = completed('Earlier tool narration is not a final answer.')
            value['result']['metadata'] = None
            sentinel = completed('Max iterations (' + str(limit) + ') reached')['result']['output'][0]
            sentinel['metadata'] = None
            value['result']['output'].append(sentinel)
            self.assertIsNone(final_text(value))
        self.client.submit('maid_dialogue', 'limit-case', 'fixture input')
        self.response = value
        done = self.client.poll('maid_dialogue', 'limit-case')
        self.assertEqual(done['status'], 'failed')
        self.assertNotIn('text', done)
        self.client.submit('maid_dialogue', 'limit-case', 'fixture input')
        self.assertEqual(sum(c[0] == 'POST' for c in self.calls), 1)
        self.assertEqual(len(read_json(self.client.root / 'budget.json')), 1)

    def test_empty_last_native_message_does_not_reuse_earlier_text(self):
        value = completed('Earlier narration.')
        value['result']['output'].extend(completed('')['result']['output'])
        self.assertIsNone(final_text(value))
        self.assertEqual(final_text(completed('The log says Max iterations (6) reached; I will wait.')),
                         'The log says Max iterations (6) reached; I will wait.')

    def test_terminal_and_waiting_native_states_are_distinct(self):
        for status in ('failed', 'cancelled', 'canceled', 'error', 'timeout', 'timed_out'):
            self.now += 86401
            self.client.submit('npc_dialogue', status, 'q')
            self.response = {'status': status}
            self.assertEqual(self.client.poll('npc_dialogue', status)['status'], 'failed')
        for status in ('queued', 'pending'):
            self.now += 86401
            self.client.submit('npc_dialogue', status, 'q')
            self.response = {'status': status}
            self.assertEqual(self.client.poll('npc_dialogue', status)['status'], 'running')
            self.response = completed()
            self.now += 11
            self.client.poll('npc_dialogue', status)
        self.now += 86401
        self.client.submit('npc_dialogue', 'inner-error', 'q')
        self.response = {'status':'finished','result':{'status':'error','output':completed()['result']['output']}}
        self.assertEqual(self.client.poll('npc_dialogue', 'inner-error')['status'], 'failed')

    def test_older_running_poll_cannot_overwrite_concurrent_completed_answer(self):
        self.client.submit('guild_quest', 'day', 'q')
        gets = []
        def interleaving(method, path, role, payload=None):
            self.assertEqual(method, 'GET')
            gets.append(path)
            if len(gets) == 1:
                self.now += 11
                self.assertEqual(self.client.poll('guild_quest', 'day')['text'], '终态已保存')
                return {'status': 'running'}
            return completed('终态已保存')
        self.client.transport = interleaving
        result = self.client.poll('guild_quest', 'day')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['text'], '终态已保存')
        self.assertEqual(read_json(self.client._path('guild_quest', 'day'))['text'], '终态已保存')

    def test_older_unavailable_poll_cannot_erase_concurrent_failed_terminal(self):
        self.client.submit('guild_quest', 'day', 'q')
        gets = []
        def interleaving(method, path, role, payload=None):
            gets.append(path)
            if len(gets) == 1:
                self.now += 11
                self.assertEqual(self.client.poll('guild_quest', 'day')['status'], 'failed')
                raise OSError('old GET timed out')
            return {'status':'failed'}
        self.client.transport = interleaving
        self.assertEqual(self.client.poll('guild_quest', 'day')['status'], 'failed')


if __name__ == '__main__': unittest.main()
