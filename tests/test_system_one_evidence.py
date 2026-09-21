"""A healthy policy or nearby action must never pass as a bound live loop."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from audit_survival_evidence import system_one_chains


class SystemOneEvidenceTests(unittest.TestCase):
    def setUp(self):
        body = {'ok': True, 'bodyUuid': 'body-a', 'dimension': 'minecraft:overworld', 'counts': {}}
        self.action = {'tool': 'equip_item', 'args': {'item_id': 'minecraft:iron_sword', 'action': 'equip', 'slot': 'mainhand'}}
        self.receipt = {'actionId': 'action-a', 'turnId': 'skill-a', **self.action,
            'status': 'completed', 'completionConfirmed': True, 'before': body, 'after': body,
            'result': {'ok': True, 'result': {'success': True}}}
        self.policy = {'ok': True, 'stateSha256': 'hash-a', 'observedAt': 1000,
                       'choice': 'sword', 'model': 'decider-dev'}
        binding = {'name': 'prepare', 'version': 'version-a', 'practiceRunId': 'run-a'}
        self.choice = {**binding, 'kind': 'system_one_choice', 'selection': {
            **self.policy, 'action': self.action, 'state': {'body': body}}}
        self.dispatch = {**binding, 'kind': 'system_one_dispatch', 'turnId': 'skill-a', 'policy': self.policy}

    def audit(self, events=None, receipt=None):
        return system_one_chains(events if events is not None else [self.choice, self.dispatch],
                                 [{'receipt': receipt or self.receipt}])

    def test_exact_success_links(self):
        self.assertEqual(self.audit()['verifiedActionLoops'], 1)

    def test_shadow_is_not_execution(self):
        self.assertEqual(self.audit([self.choice])['verifiedActionLoops'], 0)

    def test_dispatch_without_choice_is_unverified(self):
        self.assertEqual(self.audit([self.dispatch])['verifiedActionLoops'], 0)

    def test_choice_after_dispatch_cannot_explain_it(self):
        self.assertEqual(self.audit([self.dispatch, self.choice])['verifiedActionLoops'], 0)

    def test_different_turn_body_arguments_or_failed_receipt_cannot_pass(self):
        for changes in ({'turnId': 'another-turn'}, {'args': {}}, {'completionConfirmed': False},
                        {'status': 'in_flight'}, {'before': {'bodyUuid': 'body-b'}},
                        {'status': 'failed', 'result': {'ok': False, 'result': {'success': False}}}):
            with self.subTest(changes=changes):
                self.assertEqual(self.audit(receipt={**self.receipt, **changes})['verifiedActionLoops'], 0)

    def test_different_version_run_or_policy_cannot_pass(self):
        for key in ('name', 'version', 'practiceRunId'):
            self.assertEqual(self.audit([self.choice, {**self.dispatch, key: 'other'}])['verifiedActionLoops'], 0)
        for key in ('stateSha256', 'observedAt', 'choice', 'model', 'ok'):
            event = copy.deepcopy(self.dispatch)
            event['policy'][key] = False if key == 'ok' else 'other'
            self.assertEqual(self.audit([self.choice, event])['verifiedActionLoops'], 0)

    def test_duplicate_dispatch_or_choice_is_ambiguous(self):
        for events in ([self.choice, self.dispatch, self.dispatch], [self.choice, self.choice, self.dispatch]):
            self.assertEqual(self.audit(events)['verifiedActionLoops'], 0)


if __name__ == '__main__':
    unittest.main()
