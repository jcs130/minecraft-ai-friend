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

    def test_unregistered_role_and_evidenceless_claim_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unregistered'):
            TeamStore('mc-god', self.path)
        with self.assertRaisesRegex(ValueError, 'evidence_required'):
            self.player.report('feedback-0001', 'test-issue', '测试', 'bug', '看见问题', '改善', [])


if __name__ == '__main__': unittest.main()
