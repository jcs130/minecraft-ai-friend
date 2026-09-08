"""Evidence tests use temporary journals and fake native GET replies only."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('life_smoke', ROOT / 'tools/smoke_survivor_life.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
BODY = 'd4ac9523-4962-43ed-98c5-19b49e104048'
SESSION = 'life-' + 'a' * 32
OLD, FIRST, SECOND = 'survival-' + '0' * 32, 'survival-' + '1' * 32, 'survival-' + '2' * 32


class SurvivorLifeSmokeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.state = Path(tmp.name)
        self.controller = {'schema': 1, 'active': None, 'status': 'stopped',
                           'decisions': [{'turnId': OLD, 'startedAt': 900}]}
        self.session = {'schema': 1, 'agentId': 'qd-survivor', 'bodyUuid': BODY,
            'primarySessionId': SESSION, 'userId': 'survival-controller', 'channel': 'console', 'chatId': 'chat-one'}
        self.settings = {'bodyUuid': BODY, 'decisionsPerDay': 96, 'decisionCooldownSeconds': 180}
        self.write('controller.json', self.controller)
        self.write('settings.json', self.settings)
        self.write('life-session.json', self.session)
        self.append({'kind': 'decision_finished', 'turnId': OLD, 'taskId': 'task-old', 'completed': True})
        self.calls = []
        self.usage = {'modelRequests': 10, 'promptTokens': 1000, 'completionTokens': 300}
        self.tasks = {}
        self.chats = [{'id': 'chat-one', 'session_id': SESSION, 'user_id': 'survival-controller', 'channel': 'console'}]
        self.before = smoke.baseline(self.state, self.get, clock=lambda: 1000)
        self.calls.clear()

    def write(self, name, value):
        path = self.state / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    def append(self, row):
        with (self.state / 'episodes.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(row) + '\n')

    def get(self, route):
        self.calls.append(route)
        if route.startswith('/chats?'):
            return copy.deepcopy(self.chats)
        if route.startswith('/token-usage/details?'):
            return [{'agent_id': 'qd-survivor', 'call_count': self.usage['modelRequests'],
                'prompt_tokens': self.usage['promptTokens'], 'completion_tokens': self.usage['completionTokens']},
                {'agent_id': 'mc-god', 'call_count': 99999, 'prompt_tokens': 999999, 'completion_tokens': 999999}]
        if route.startswith('/console/chat/task/'):
            result = self.tasks.get(route.rsplit('/', 1)[-1])
            if result is None:
                raise smoke.EvidenceError('native_http_404')
            return copy.deepcopy(result)
        raise AssertionError('Unexpected route: ' + route)

    def new_tasks(self):
        for turn, task, timestamp in ((FIRST, 'task-one', 1001), (SECOND, 'task-two', 1002)):
            self.controller['decisions'].append({'turnId': turn, 'startedAt': timestamp})
            self.append({'kind': 'decision_finished', 'turnId': turn, 'taskId': task, 'completed': True})
            self.tasks[task] = {'status': 'finished', 'result': {'status': 'completed', 'session_id': SESSION,
                'output': [{'type': 'message', 'role': 'assistant', 'status': 'completed',
                            'content': [{'type': 'text', 'text': 'PRIVATE-CONVERSATION-MUST-NOT-LEAVE'}]}]}}
        self.write('controller.json', self.controller)
        self.usage = {'modelRequests': 14, 'promptTokens': 4000, 'completionTokens': 700}
        self.receipt()

    def receipt(self, **updates):
        action = 'b' * 32
        row = {'schema': 2, 'actionId': action, 'turnId': FIRST, 'tool': 'craft',
            'acceptedAt': 1001200, 'status': 'completed', 'completionConfirmed': True,
            'before': {'ok': True, 'bodyUuid': BODY, 'dimension': 'minecraft:overworld',
                       'counts': {'minecraft:oak_log': 1}},
            'after': {'ok': True, 'bodyUuid': BODY, 'dimension': 'minecraft:overworld',
                      'counts': {'minecraft:oak_planks': 4}},
            'result': {'ok': True, 'actionId': action}, **updates}
        self.write('turn-actions/' + FIRST + '.json', {'schema': 1, 'turnId': FIRST, 'actionIds': [action]})
        self.write('action-receipts/' + action + '.json', row)

    def collect(self):
        return smoke.collect(self.state, self.before, self.get, clock=lambda: 1100)

    @staticmethod
    def check(report, name):
        return next(r for r in report['checks'] if r['name'] == name)

    def test_two_new_native_tasks_one_bound_chat_and_real_receipt_pass(self):
        self.new_tasks()
        result = self.collect()
        self.assertTrue(result['ok'])
        self.assertEqual(len(result['tasks']), 2)
        self.assertEqual(result['modelTasksSubmittedByProbe'], 0)
        self.assertNotIn('PRIVATE-CONVERSATION', json.dumps(result))
        delta = self.check(result, 'native-model-usage-delta')['evidence']['delta']
        self.assertEqual(delta, {'modelRequests': 4, 'promptTokens': 3000, 'completionTokens': 400})
        self.assertFalse(self.check(result, 'same-session-after-live-restart')['ok'])
        self.assertFalse(self.check(result, 'same-session-after-live-restart')['required'])
        self.assertNotIn('/console/chat/task/task-old', self.calls)

    def test_old_turns_and_local_completed_flags_cannot_fake_new_native_work(self):
        self.tasks['task-old'] = {'status': 'finished', 'result': {'status': 'completed', 'session_id': SESSION}}
        report = self.collect()
        self.assertFalse(report['ok'])
        self.assertEqual(report['tasks'], [])
        self.assertNotIn('/console/chat/task/task-old', self.calls)

    def test_native_limit_is_not_valid_answer_but_actions_and_cost_remain(self):
        self.new_tasks()
        result = self.tasks['task-one']['result']
        result['output'].append({'type': 'message', 'role': 'assistant', 'status': 'completed',
            'metadata': None, 'content': [{'type': 'text', 'text': 'Max iterations (6) reached'}]})
        report = self.collect()
        self.assertFalse(report['ok'])
        self.assertFalse(self.check(report, 'persistent-native-session')['ok'])
        self.assertEqual(self.check(report, 'persistent-native-session')['evidence']['verifiedDistinctNativeTasks'], 1)
        self.assertTrue(self.check(report, 'per-action-native-body-receipt')['ok'])
        self.assertEqual(self.check(report, 'native-model-usage-delta')['evidence']['delta']['modelRequests'], 4)
        self.assertFalse(report['tasks'][0]['nativeAnswerVerified'])
        self.assertNotIn('Max iterations', json.dumps(report))

    def test_task_404_remains_unknown_even_with_local_completed_episode(self):
        self.new_tasks()
        self.tasks.pop('task-one')
        report = self.collect()
        self.assertFalse(report['ok'])
        self.assertFalse(self.check(report, 'unknown-outcomes-not-assumed')['ok'])
        self.assertEqual(report['tasks'][0]['error'], 'native_http_404')
        self.assertFalse(report['tasks'][0]['nativeSessionVerified'])

    def test_second_task_with_another_session_cannot_count_as_continuation(self):
        self.new_tasks()
        self.tasks['task-two']['result']['session_id'] = 'old-session'
        self.assertFalse(self.check(self.collect(), 'persistent-native-session')['ok'])

    def test_user_channel_and_persisted_body_are_checked(self):
        self.new_tasks()
        for field, value in (('user_id', 'another-user'), ('channel', 'discord')):
            saved = self.chats[0][field]
            self.chats[0][field] = value
            self.assertFalse(self.check(self.collect(), 'persistent-native-session')['ok'])
            self.chats[0][field] = saved
        self.session['bodyUuid'] = 'other-body'
        self.write('life-session.json', self.session)
        self.assertFalse(self.collect()['ok'])

    def test_pending_native_task_does_not_count_as_verified_finished_session(self):
        self.new_tasks()
        self.tasks['task-two'] = {'status': 'running'}
        report = self.collect()
        self.assertFalse(report['ok'])
        self.assertEqual(report['tasks'][1]['nativeStatus'], 'running')

    def test_unknown_action_is_explicit_and_never_a_valid_body_receipt(self):
        self.new_tasks()
        self.receipt(status='unknown', completionConfirmed=False)
        self.write('unknown.json', {'actionId': 'b' * 32, 'turnId': FIRST, 'tool': 'craft'})
        report = self.collect()
        self.assertFalse(report['ok'])
        self.assertFalse(self.check(report, 'per-action-native-body-receipt')['ok'])
        self.assertFalse(self.check(report, 'unknown-outcomes-not-assumed')['ok'])

    def test_unconfirmed_mining_observation_does_not_claim_goal_success(self):
        self.new_tasks()
        self.receipt(tool='mine', status='observed_ended', completionConfirmed=False)
        report = self.collect()
        self.assertTrue(report['ok'])
        receipt = report['actionReceipts'][0]
        self.assertFalse(receipt['completionConfirmed'])
        self.assertIsNone(receipt['nativeResultSuccess'])

    def test_old_receipt_wrong_actor_or_missing_after_cannot_pass(self):
        self.new_tasks()
        for changes in ({'acceptedAt': 999999}, {'before': {'ok': True, 'bodyUuid': 'wrong'}}, {'after': {}}):
            self.receipt(**changes)
            self.assertFalse(self.check(self.collect(), 'per-action-native-body-receipt')['ok'])

    def test_goto_requires_native_id_and_epoch_receipt_association(self):
        self.new_tasks()
        base = {'ok': True, 'bodyUuid': BODY, 'dimension': 'minecraft:overworld', 'counts': {}, 'navigationEpoch': 'epoch-1'}
        self.receipt(tool='goto', before=base, after=base, nativeTaskId='t1',
                     navigationOutcome={'task_id': 'wrong', 'navigation_epoch': 'epoch-1', 'success': True})
        self.assertFalse(self.collect()['ok'])
        self.receipt(tool='goto', before=base, after=base, nativeTaskId='t1',
                     navigationOutcome={'task_id': 't1', 'navigation_epoch': 'epoch-1', 'success': False}, status='failed')
        report = self.collect()
        self.assertTrue(report['ok'])
        self.assertFalse(report['actionReceipts'][0]['nativeResultSuccess'])

    def test_changed_episode_history_and_conflicting_task_identity_fail_closed(self):
        self.new_tasks()
        self.append({'kind': 'decision_finished', 'turnId': FIRST, 'taskId': 'different-task'})
        with self.assertRaisesRegex(smoke.EvidenceError, 'conflicting_native_tasks'):
            self.collect()
        (self.state / 'episodes.jsonl').write_text('')
        with self.assertRaisesRegex(smoke.EvidenceError, 'history_truncated'):
            self.collect()

    def test_unknown_and_rewound_native_usage_do_not_become_zero(self):
        self.new_tasks()
        self.usage['modelRequests'] = None
        report = self.collect()
        self.assertIsNone(self.check(report, 'native-model-usage-delta')['evidence']['delta'])
        self.assertFalse(report['ok'])
        self.usage['modelRequests'] = 1
        self.assertFalse(self.collect()['ok'])

    def test_baseline_refuses_active_task_and_missing_explicit_native_counters(self):
        self.controller['active'] = {'taskId': 'in-flight'}
        self.write('controller.json', self.controller)
        with self.assertRaisesRegex(smoke.EvidenceError, 'no_active_model_task'):
            smoke.baseline(self.state, self.get, clock=lambda: 1000)
        before = dict(self.before, usage={'modelRequests': None})
        with self.assertRaisesRegex(smoke.EvidenceError, 'native_usage_required'):
            smoke.collect(self.state, before, self.get, clock=lambda: 1100)

    def test_output_cannot_overwrite_production_and_http_cannot_target_other_hosts(self):
        with self.assertRaisesRegex(smoke.EvidenceError, 'reports_or_runtime'):
            smoke.save_report(ROOT / 'server/survival-agent-state/survival/controller.json', {})
        with self.assertRaisesRegex(smoke.EvidenceError, 'game_qwen_endpoint_required'):
            smoke.NativeGet('https://external.invalid/api')


if __name__ == '__main__':
    unittest.main()
