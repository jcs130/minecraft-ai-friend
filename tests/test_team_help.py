from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import team_help as help_lane
import world_team
from agent_learning import read


PLAYER = 'game:qd-survivor'
YUI = 'game:5swvhK'
GODDESS = 'game:mc-god'
ENGINEER = 'operations:mc-god'


class HelpTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.team = {**world_team.MEMBERS, YUI: ('结衣', '冒险伙伴')}
        for module in (world_team, help_lane):
            context = patch.object(module, 'members', return_value=self.team)
            context.start(); self.addCleanup(context.stop)
        import team_recruitment
        context = patch.object(team_recruitment, 'specialists', return_value={})
        context.start(); self.addCleanup(context.stop)
        def host(actor):
            if actor == ENGINEER:
                return {'runtime': 'game', 'agentId': 'qd-engineer'}
            runtime, role = actor.split(':')
            return {'runtime': runtime, 'agentId': role}
        context = patch.object(help_lane, 'native_host', side_effect=host)
        context.start(); self.addCleanup(context.stop)
        context = patch.dict(sys.modules, {
            'world_team_profiles': types.SimpleNamespace(tools_for=lambda target:
                ['team_case', 'team_update', 'team_request_help', 'team_help_status', 'team_recruit']),
            'engineering_mcp': types.SimpleNamespace(TOOLS=('engineering_status', 'engineering_test')),
            'native_role_capabilities': types.SimpleNamespace(FILE_TOOLS=('read_file', 'write_file', 'edit_file')),
        })
        context.start(); self.addCleanup(context.stop)
        self.player = world_team.TeamStore(PLAYER, self.root)
        self.goddess = world_team.TeamStore(GODDESS, self.root)
        self.case_id = self.player.report('request-test-0001', 'pit-path-failure', '无法脱困', 'bug',
            '导航工具失败，有回执', '恢复可行路径', ['task-123 / failed'])['caseId']
        self.calls = []
        self.outcome = {'task_id': 'task-123456abcdef'}

    def request(self, runtime, role, method, path, body=None):
        self.calls.append((runtime, role, method, path, body))
        if isinstance(self.outcome, Exception): raise self.outcome
        return self.outcome

    def help(self, actor=PLAYER, recipient='owner'):
        return help_lane.request_help(actor, self.case_id, recipient, root=self.root, request=self.request)

    def test_author_submits_once_and_keeps_life_session_separate(self):
        result = self.help(); again = self.help()
        self.assertEqual(result, again); self.assertEqual(len(self.calls), 1)
        self.assertTrue(result['ok']); self.assertEqual(result['status'], 'submitted')
        payload = self.calls[0][4]
        self.assertEqual(payload['session_id'], 'world-case:' + self.case_id + ':mc-god')
        self.assertEqual(self.calls[0][:4], ('game', 'mc-god', 'POST', '/console/chat/task'))
        self.assertEqual(result['caseVersion'], 1)
        self.assertFalse(result['worldFixConfirmed'])
        self.assertEqual(self.goddess.case(self.case_id)['case']['status'], 'open')

    def test_lost_submission_receipt_is_persisted_and_never_replayed(self):
        self.outcome = TimeoutError('lost receipt')
        result = self.help()
        self.assertEqual(result['status'], 'unknown')
        self.assertFalse(result['automaticRetry'])
        self.assertEqual(read(self.root / 'native-help' / (result['helpId'] + '.json')), result)
        self.outcome = {'task_id': 'task-abcdefabcdef'}
        self.assertEqual(self.help(), result); self.assertEqual(len(self.calls), 1)

    def test_native_rejection_and_bad_receipt_do_not_retry(self):
        for outcome, code in ((urllib.error.HTTPError('local', 409, 'busy', {}, None), 'native_http_409'),
                              ({'task_id': 'unexpected'}, 'native_task_receipt_unrecognized'),
                              (None, 'native_task_receipt_unrecognized')):
            with tempfile.TemporaryDirectory() as folder:
                # A separate help receipt directory while keeping the real case.
                self.outcome = outcome
                context = patch.object(help_lane, 'TeamStore', return_value=self.player)
                with context:
                    result = help_lane.request_help(PLAYER, self.case_id, root=Path(folder), request=self.request)
                    count = len(self.calls)
                    again = help_lane.request_help(PLAYER, self.case_id, root=Path(folder), request=self.request)
                self.assertEqual(result['code'], code); self.assertEqual(result, again)
                self.assertEqual(len(self.calls), count)

    def test_unrelated_character_cannot_send_someone_elses_case(self):
        with self.assertRaisesRegex(ValueError, 'participant_required'): self.help(YUI)
        self.assertFalse(self.calls)

    def test_partner_private_conversation_never_uses_ops_lane(self):
        with self.assertRaisesRegex(ValueError, 'game_channel'): self.help(recipient=YUI)
        self.assertFalse(self.calls)

    def test_self_unknown_and_closed_cases_are_not_dispatched(self):
        for recipient in (PLAYER, 'game:unknown'):
            with self.assertRaisesRegex(ValueError, 'invalid_help_recipient'): self.help(recipient=recipient)
        self.goddess.update('update-test-close', self.case_id, 1, 'resolved', '实际复测通过', ['native receipt'])
        self.assertEqual(self.help()['code'], 'case_already_closed')
        self.assertFalse(self.calls)

    def test_code_issue_uses_migrated_engineers_native_id(self):
        result = self.help(recipient=ENGINEER)
        self.assertEqual(self.calls[0][:2], ('game', 'qd-engineer'))
        self.assertEqual(result['recipient'], ENGINEER)
        self.assertIn('qd-engineer', result['sessionId'])
        self.assertIn('qd_engineering__engineering_test',
                      self.calls[0][4]['request_context']['subagent_allowed_tools'])

    def test_notification_task_cannot_recurse_or_recruit(self):
        self.help()
        allowed = self.calls[0][4]['request_context']['subagent_allowed_tools']
        self.assertIn('qd_world_team__team_case', allowed)
        for forbidden in ('team_request_help', 'team_recruit', 'spawn_subagent', 'submit_to_agent',
                          'chat_with_agent', 'execute_shell_command'):
            self.assertFalse(any(forbidden in item for item in allowed), forbidden)

    def test_task_final_status_uses_nested_result_without_claiming_world_fix(self):
        result = self.help()
        for outcome, expected in (({'status': 'running'}, False),
                                  ({'status': 'finished', 'result': {'status': 'completed'}}, True),
                                  ({'status': 'finished', 'result': {'status': 'failed'}}, False),
                                  ({'status': 'finished', 'task_status': 'completed'}, False),
                                  ({'status': 'finished', 'result': None}, False)):
            self.outcome = outcome
            actual = help_lane.help_status(PLAYER, result['helpId'], root=self.root, request=self.request)
            self.assertEqual(actual['nativeCompleted'], expected)
            self.assertFalse(actual['worldFixConfirmed'])
            self.assertEqual(self.goddess.case(self.case_id)['case']['status'], 'open')

    def test_help_status_checks_participation_and_id_before_api(self):
        result = self.help(); count = len(self.calls)
        with self.assertRaisesRegex(ValueError, 'participant_required'):
            help_lane.help_status(YUI, result['helpId'], root=self.root, request=self.request)
        with self.assertRaisesRegex(ValueError, 'invalid_help_id'):
            help_lane.help_status(PLAYER, '../specialists', root=self.root, request=self.request)
        self.assertEqual(len(self.calls), count)


if __name__ == '__main__': unittest.main()
