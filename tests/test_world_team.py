import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from world_team import TeamStore


class TeamTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.player = TeamStore('game:qd-survivor', self.path)
        self.goddess = TeamStore('game:mc-god', self.path)
        self.engineer = TeamStore('operations:mc-god', self.path)

    def report(self, request='feedback-test-0001', observed='实际任务失败，有回执'):
        return self.player.report(request, 'navigation-test-case', '矿坑通路受阻', 'bug',
                                  observed, '需要可行通路', ['task-test / action-test: failed'])

    def test_feedback_is_documented_attributed_idempotent(self):
        row = self.report()
        self.assertEqual(row, self.report())
        content = (self.path / row['document']).read_text(encoding='utf-8')
        self.assertIn('game:qd-survivor', content)
        case = self.goddess.case(row['caseId'])
        self.assertEqual(case['case']['owner'], 'game:mc-god')
        self.assertEqual(len(case['events']), 1)

    def test_conflicting_request_cannot_rewrite_history(self):
        self.report()
        with self.assertRaisesRegex(ValueError, 'request_conflict'):
            self.report(observed='把失败改称成功')

    def test_same_issue_adds_evidence_without_creating_second_case(self):
        original = self.report()
        later = self.report('feedback-test-0002', '新的失败回执')
        self.assertEqual(original['caseId'], later['caseId'])
        self.assertEqual(len(self.goddess.case(original['caseId'])['events']), 2)
        self.assertEqual(len(self.goddess.cases()['cases']), 1)

    def test_handoff_same_id_different_runtime_and_cas(self):
        case_id = self.report()['caseId']
        with self.assertRaisesRegex(ValueError, 'case_owner_required'):
            self.engineer.update('update-test-0001', case_id, 1, 'working', '接单', ['task1'])
        handoff = self.goddess.update('handoff-test-0001', case_id, 1, 'open', '交给工程师', ['task1'], 'operations:mc-god')
        self.assertEqual(handoff['version'], 2)
        self.assertEqual(self.engineer.update('update-test-0002', case_id, 1, 'working', '旧版本', ['task1'])['code'], 'case_changed')
        self.engineer.update('update-test-0003', case_id, 2, 'needs_review', '候选已测', ['commit/abc / test/xyz'])
        with self.assertRaisesRegex(ValueError, 'independent_review_required'):
            self.engineer.update('update-test-0004', case_id, 3, 'resolved', '自行认证上线', ['commit/abc'])
        self.goddess.update('review-test-0001', case_id, 3, 'resolved', '有独立现场复测', ['action/new: success'])
        self.assertEqual(len(self.engineer.cases()['cases']), 0)

    def test_late_recurrence_reopens_history(self):
        case_id = self.report()['caseId']
        self.goddess.update('close-test-0001', case_id, 1, 'resolved', '已复测', ['action/one'])
        self.report('feedback-test-0002', '同问题再次发生')
        self.assertEqual(self.goddess.case(case_id)['case']['status'], 'open')

    def test_case_pages_preserve_every_event_and_current_version(self):
        case_id = self.report()['caseId']
        for n in range(1, 8):
            self.report('feedback-page-' + str(n), 'Original observation ' + str(n))
        with self.goddess.db() as db:
            before = [tuple(row) for row in db.execute('SELECT * FROM events ORDER BY seq')]
        first = self.goddess.case(case_id)
        self.assertEqual([e['observed'] for e in first['events']],
                         ['Original observation ' + str(n) for n in (5, 6, 7)])
        self.assertTrue(first['has_more'])
        # Another writer can append while this reader is walking older evidence.
        self.report('feedback-page-late', 'Late observation')
        newer = first['events']
        cursor = first['next_before_seq']
        while cursor is not None:
            page = self.goddess.case(case_id, event_limit=2, before_seq=cursor)
            self.assertEqual(page['case']['version'], 9)
            self.assertLess(page['events'][-1]['seq'], cursor)
            newer = page['events'] + newer
            cursor = page['next_before_seq']
        self.assertEqual([e['seq'] for e in newer], [row[0] for row in before])
        self.assertEqual(newer[0]['actor'], 'game:qd-survivor')
        self.assertEqual(newer[0]['evidence'], ['task-test / action-test: failed'])
        with self.goddess.db() as db:
            self.assertEqual([tuple(row) for row in db.execute('SELECT * FROM events ORDER BY seq')][:-1], before)

    def test_case_page_boundary_and_validation(self):
        case_id = self.report()['caseId']
        for n in range(2): self.report('feedback-boundary-' + str(n))
        page = self.goddess.case(case_id)
        self.assertFalse(page['has_more'])
        self.assertIsNone(page['next_before_seq'])
        empty = self.goddess.case(case_id, before_seq=page['events'][0]['seq'])
        self.assertEqual(empty['events'], [])
        self.assertFalse(empty['has_more'])
        for bad in (0, 21, True, 1.5, '3'):
            with self.assertRaisesRegex(ValueError, 'invalid_event_limit'):
                self.goddess.case(case_id, event_limit=bad)
        for bad in (0, -1, True, 1.5, '2'):
            with self.assertRaisesRegex(ValueError, 'invalid_before_seq'):
                self.goddess.case(case_id, before_seq=bad)

    def test_registered_case_tool_exposes_progressive_history(self):
        from world_team_mcp import register_team_tools
        class App:
            def __init__(self): self.tools = {}
            def tool(self):
                def add(fn): self.tools[fn.__name__] = fn; return fn
                return add
        app = App()
        register_team_tools(app, 'game:mc-god', self.path)
        case_id = self.report()['caseId']
        self.report('feedback-tool-second')
        page = app.tools['team_case'](case_id, event_limit=1)
        self.assertTrue(page['has_more'])
        older = app.tools['team_case'](case_id, before_seq=page['next_before_seq'])
        self.assertEqual(len(older['events']), 1)
        self.assertFalse(older['has_more'])

    def test_case_cursor_does_not_include_other_cases(self):
        case_id = self.report()['caseId']
        other = self.goddess.report('other-report', 'different-issue', 'Other issue', 'bug',
                                   'Unrelated evidence', 'Expected behavior', ['other:1'])
        self.report('feedback-isolated-second')
        page = self.goddess.case(case_id, event_limit=1)
        older = self.goddess.case(case_id, before_seq=page['next_before_seq'])
        self.assertEqual(len(older['events']), 1)
        self.assertNotEqual(older['events'][0]['seq'], self.goddess.case(other['caseId'])['events'][0]['seq'])
        self.assertFalse(older['has_more'])

    def test_unregistered_role_and_evidenceless_claim_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unregistered'):
            TeamStore('mc-god', self.path)
        with self.assertRaisesRegex(ValueError, 'evidence_required'):
            self.player.report('feedback-0001', 'test-issue', '测试', 'bug', '看见问题', '改善', [])


if __name__ == '__main__': unittest.main()
