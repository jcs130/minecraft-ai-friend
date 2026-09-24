"""Model projections retain correction evidence without replaying sensor dumps."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))

import motor_mailbox as mailbox
from behavior_context import prepare, acknowledge
from numen_gateway import write_json


class MotorProjectionTests(unittest.TestCase):
    def receipt(self, status='failed'):
        return {'actionId': 'a' * 32, 'tool': 'goto', 'status': status,
                'completionConfirmed': status == 'completed', 'nativeTaskId': 't17',
                'navigationEpoch': 42, 'observedAt': 2000,
                'requested': {'x': 10, 'y': 70, 'z': 20},
                'positionAfter': {'x': 9, 'y': 69, 'z': 20},
                'navigationOutcome': {'task_id': 't17', 'state': 'ended', 'success': False,
                                      'reason': 'no_path'},
                'outcomeDetail': 'no_path',
                'navigationSense': {'ok': True, 'code': 'observed', 'observedAt': 1990,
                    'position': {'x': 9, 'y': 69, 'z': 20},
                    'bodyControl': {'notice': 'repeated explanation ' * 100},
                    'destination': {'available': True, 'code': 'requested_stance_blocked',
                        'pathVerified': False, 'requestedStanceClear': False,
                        'requestedStanceSupported': True, 'notice': 'same caveat ' * 100,
                        'candidates': [{'x': 10+i, 'y': 70, 'z': 20, 'pathVerified': False,
                                        'supportBlock': 'minecraft:stone'} for i in range(6)]}}}

    def queue(self):
        return {'version': 1, 'capacity': 8, 'pending': 0,
                'active': [{'requestId': 'unknown-id', 'turnId': 'turn-id',
                            'motorTurnId': 'motor-id', 'status': 'unknown',
                            'receipt': {'actionId': 'unknown-action', 'nativeTaskId': 't18',
                                        'status': 'unknown', 'navigationEpoch': 43}}],
                'recent': [{'requestId': 'r' + str(i), 'turnId': 'turn-id',
                            'kind': 'action', 'status': 'failed', 'receipt': self.receipt()}
                           for i in range(6)]}

    def test_brief_keeps_failed_target_candidates_and_unknown_identity(self):
        full = self.queue()
        original = copy.deepcopy(full)
        brief = mailbox.compact_public(full)
        self.assertEqual(full, original)
        self.assertEqual(brief['active'], full['active'])
        outcome = brief['recent'][-1]['receipt']
        for key in ('actionId', 'nativeTaskId', 'navigationEpoch', 'requested', 'positionAfter'):
            self.assertEqual(outcome[key], full['recent'][-1]['receipt'][key])
        self.assertEqual(outcome['navigationOutcome']['reason'], 'no_path')
        target = outcome['navigationSense']['destination']
        self.assertFalse(target['pathVerified'])
        self.assertEqual(target['code'], 'requested_stance_blocked')
        self.assertEqual(len(target['candidates']), 3)
        self.assertTrue(target['candidatesTruncated'])
        self.assertNotIn('notice', target)
        self.assertLess(len(json.dumps(brief)), len(json.dumps(full)) * .5)

    def test_success_drops_old_navigation_scan_but_retains_arrival(self):
        brief = mailbox.brief_receipt(self.receipt('completed'))
        self.assertNotIn('navigationSense', brief)
        self.assertTrue(brief['completionConfirmed'])
        self.assertEqual(brief['positionAfter']['y'], 69)

    def test_preflight_failure_preserves_exact_rejection_and_command(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_json(root/'motor-inbox.json', {'schema': 1, 'requests': [{
                'requestId': 'r', 'turnId': 'turn', 'motorTurnId': 'motor', 'kind': 'action',
                'status': 'claimed', 'payload': {'tool': 'goto', 'args': {'x': 30, 'z': 0}}}]})
            mailbox.finish_locked(root, 'r', 'failed', {'ok': False, 'code': 'walk_target_too_far',
                'dispatched': False, 'navigationPreflight': {'origin': {'x': 0, 'y': 64, 'z': 0},
                    'requested': {'x': 30, 'z': 0}, 'maxHorizontalDistance': 24}})
            full = mailbox.public(root)
            brief = mailbox.public(root, detail='brief')
            self.assertEqual(brief['recent'][0]['command'], {'tool': 'goto', 'args': {'x': 30, 'z': 0}})
            self.assertEqual(brief['recent'][0]['receipt']['code'], 'walk_target_too_far')
            self.assertFalse(brief['recent'][0]['receipt']['dispatched'])
            self.assertEqual(brief['recent'][0]['receipt']['navigationPreflight'],
                             full['recent'][0]['receipt']['navigationPreflight'])

    def test_wake_projects_motor_without_mutation_or_duplicate_delta(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            life = {'bodyUuid': 'body', 'primarySessionId': 'life-original'}
            context = {'turn_id': 'survival-one', 'currentTime': 1, 'mission': 'explore',
                       'wakeReason': 'world_changed', 'body': {},
                       'motor': {'bodyAccess': 'queued', 'queue': self.queue()}}
            original = copy.deepcopy(context)
            _, wake, delivery = prepare(root, life, context, {'goal': 'explore'})
            self.assertEqual(context, original)
            self.assertLess(len(json.dumps(wake['updates']['motor'])),
                            len(json.dumps(context['motor'])) * .5)
            acknowledge(root, life, delivery)
            context['turn_id'] = 'survival-two'
            _, second, _ = prepare(root, life, context, {'goal': 'explore'})
            self.assertNotIn('motor', second['updates'])


if __name__ == '__main__':
    unittest.main()
