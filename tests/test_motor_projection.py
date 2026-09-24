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

    def test_old_terminal_rows_keep_outcomes_and_repeat_chain_without_observations(self):
        full = self.queue()
        for row in full['recent']:
            row['command'] = {'tool': 'goto', 'args': {'x': 10, 'y': 70, 'z': 20}}
        old = full['recent'][0]
        old.update(status='completed', previousRequestId='predecessor',
                   nextRepeat={'previousRequestId': old['requestId']})
        old['receipt'] = self.receipt('completed')
        old['receipt']['navigationOutcome'].update(success=True, reason='arrival checked')
        failed = full['recent'][1]['receipt']
        failed.update(code='partial_mining_failure', tool='mine', completionConfirmed=True,
                      mining={'status': 'terminal', 'requested': 4, 'gathered': 2, 'code': 'no_more_blocks'})
        failed['navigationVerdict'] = {'code': 'destination_unusable', 'targetUsable': False,
                                       'instruction': 'choose a fresh candidate'}
        full['recent'][1]['command'] = {'tool': 'mine', 'args': {'block_ids': ['minecraft:oak_log'], 'count': 4}}
        original = copy.deepcopy(full)
        brief = mailbox.compact_public(full)
        self.assertEqual(full, original)
        for i in (0, 1):
            row = brief['recent'][i]
            for key in ('requestId', 'turnId', 'kind', 'status', 'command', 'nextRepeat', 'previousRequestId'):
                self.assertEqual(row.get(key), full['recent'][i].get(key))
            for key in ('actionId', 'nativeTaskId', 'completionConfirmed', 'navigationEpoch', 'observedAt'):
                self.assertEqual(row['receipt'][key], full['recent'][i]['receipt'][key])
            self.assertNotIn('candidates', row['receipt'].get('navigationSense', {}).get('destination', {}))
            self.assertNotIn('positionAfter', row['receipt'])
            self.assertNotIn('receiptDetail', row)
            self.assertIn('omitted', brief['receiptDetail'])
        self.assertEqual(brief['recent'][1]['receipt']['mining'], failed['mining'])
        self.assertEqual(brief['recent'][1]['receipt']['code'], 'partial_mining_failure')
        self.assertEqual(brief['recent'][1]['receipt']['navigationSense']['destination']['code'],
                         'requested_stance_blocked')
        self.assertEqual(brief['recent'][1]['receipt']['navigationVerdict'],
                         {'code': 'destination_unusable', 'targetUsable': False})
        self.assertFalse(brief['recent'][1]['receipt']['navigationOutcome']['success'])
        self.assertEqual(brief['recent'][1]['receipt']['navigationOutcome']['reason'], 'no_path')
        for i in (-2, -1):
            self.assertIn('navigationSense', brief['recent'][i]['receipt'])

    def test_unknown_and_unsettled_recent_rows_are_never_reduced(self):
        for status in ('unknown', 'claimed', 'queued', 'dispatched'):
            full = self.queue()
            full['recent'][0]['status'] = status
            full['recent'][0]['receipt'].update(status=status, before={'unusual': ['evidence']})
            brief = mailbox.compact_public(full)
            self.assertEqual(brief['recent'][0], full['recent'][0])
            self.assertEqual(brief['active'], full['active'])
        full = self.queue()
        full['recent'][0]['receipt']['status'] = 'unknown'
        self.assertEqual(mailbox.compact_public(full)['recent'][0], full['recent'][0])

    def test_historical_projection_is_idempotent_and_keeps_legacy_target(self):
        full = self.queue()
        brief = mailbox.compact_public(full)
        self.assertEqual(brief, mailbox.compact_public(brief))
        self.assertEqual(brief['recent'][0]['receipt']['requested'], full['recent'][0]['receipt']['requested'])

    def test_full_query_keeps_all_history_bytes_after_brief_query(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            write_json(root/'motor-inbox.json', {'schema': 1, 'requests': self.queue()['recent']})
            before = (root/'motor-inbox.json').read_bytes()
            full = mailbox.public(root)
            brief = mailbox.public(root, detail='brief')
            self.assertNotIn('candidates', brief['recent'][0]['receipt']['navigationSense']['destination'])
            self.assertEqual(mailbox.public(root), full)
            self.assertEqual((root/'motor-inbox.json').read_bytes(), before)

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

    def test_known_equipment_rejections_keep_latest_advice_and_every_identity(self):
        full = self.queue()
        for i, row in enumerate(full['recent'][:3]):
            row['receipt'] = {'actionId': 'cast-' + str(i), 'status': 'rejected',
                'tool': 'game_cast', 'completionConfirmed': False, 'observedAt': i,
                'outcomeDetail': 'Native spell must be equipped.',
                'gameSkill': {'code': 'not_equipped', 'ok': False, 'requestId': 'native-' + str(i),
                    'engine': 'irons_spellbooks', 'nativeSpell': 'irons_spellbooks:heal'},
                'recovery': {'requiredNextStep': 'equip_then_observe', 'retryAutomatically': False,
                    'instruction': 'Equip the spell, then observe; do not guess a healing alias.'},
                'futureSafety': {'noReplay': True}}
        original = copy.deepcopy(full)
        brief = mailbox.compact_public(full)
        self.assertEqual(full, original)
        for i in (0, 1):
            r = brief['recent'][i]['receipt']
            self.assertNotIn('outcomeDetail', r)
            self.assertNotIn('instruction', r['recovery'])
            for key in ('actionId', 'gameSkill', 'futureSafety', 'completionConfirmed'):
                self.assertEqual(r[key], full['recent'][i]['receipt'][key])
            self.assertEqual(r['recovery']['requiredNextStep'], 'equip_then_observe')
            self.assertFalse(r['recovery']['retryAutomatically'])
        self.assertEqual(brief['recent'][2]['receipt'], full['recent'][2]['receipt'])
        self.assertEqual(brief, mailbox.compact_public(brief))

    def test_other_native_rejection_and_future_recovery_text_are_not_dropped(self):
        full = self.queue()
        for i, code in enumerate(('cooldown', 'not_equipped')):
            full['recent'][i]['receipt'].update(status='rejected',
                gameSkill={'code': code, 'ok': False},
                outcomeDetail='Specific diagnostic that is not a known duplicate.',
                recovery={'requiredNextStep': 'future_policy', 'instruction': 'Keep this safety rule.'})
        brief = mailbox.compact_public(full)
        for i in (0, 1):
            self.assertEqual(brief['recent'][i]['receipt']['outcomeDetail'],
                             full['recent'][i]['receipt']['outcomeDetail'])
            self.assertEqual(brief['recent'][i]['receipt']['recovery'], full['recent'][i]['receipt']['recovery'])

    def test_unrecognized_legacy_rows_are_preserved_without_crashing(self):
        full = {'recent': [None, 'legacy-row', 42, {'receipt': None}]}
        self.assertEqual(mailbox.compact_public(full)['recent'], full['recent'])

    def test_success_coordinates_only_collapse_when_identical_and_failure_reason_stays(self):
        r = self.receipt('completed')
        r['navigationOutcome'].update(success=True,
            reason='the task ended and the core keeps no readable navigation terminal; '
                   'arrival is judged from the body against the request',
            navigation_mode='observed_from_body', final_x=9, final_y=69, final_z=20,
            requested={'x': 10, 'y': 70, 'z': 20}, horizontalDistance=1,
            futureSafety={'pathNotVerified': True})
        brief = mailbox.brief_receipt(r)
        self.assertNotIn('reason', brief['navigationOutcome'])
        self.assertNotIn('positionAfter', brief)
        for key in ('navigation_mode', 'requested', 'horizontalDistance', 'futureSafety', 'final_x', 'final_y', 'final_z'):
            self.assertEqual(brief['navigationOutcome'][key], r['navigationOutcome'][key])
        r['positionAfter']['y'] = 70
        self.assertEqual(mailbox.brief_receipt(r)['positionAfter']['y'], 70)
        r['navigationOutcome']['reason'] = 'A new native success diagnostic must remain visible.'
        self.assertEqual(mailbox.brief_receipt(r)['navigationOutcome']['reason'],
                         'A new native success diagnostic must remain visible.')
        r['navigationOutcome'].update(success=False, reason='no_path')
        self.assertEqual(mailbox.brief_receipt(r)['navigationOutcome']['reason'], 'no_path')

    def test_effect_unconfirmed_and_unknown_under_terminal_row_remain_exact(self):
        for patch in ({'status': 'unknown'}, {'status': 'in_flight'},
                      {'status': 'completed', 'completionConfirmed': False},
                      {'status': 'completed', 'effectConfirmed': False},
                      {'status': 'future_native_state'}):
            full = self.queue()
            row = full['recent'][0]
            row.update(status='completed')
            row['receipt'].update(patch, before={'inventory': ['uncertain effect']}, noReplay=True)
            self.assertEqual(mailbox.compact_public(full)['recent'][0], row)


class ActionOutcomeProjectionTests(unittest.TestCase):
    def test_query_success_is_not_native_action_success(self):
        execution = {'ok': True, 'inFlight': False, 'receipt': {
            'actionId': 'native-cast', 'tool': 'game_cast', 'status': 'rejected',
            'completionConfirmed': False, 'observedAt': 42, 'requested': {'skill_id': 'heal'},
            'gameSkill': {'code': 'not_equipped', 'engine': 'irons_spellbooks',
                          'nativeSpell': 'irons_spellbooks:heal', 'executionConfirmed': False},
            'recovery': {'requiredNextStep': 'equip_then_observe', 'retryAutomatically': False,
                         'instruction': 'The full advice remains in the receipt.'}}}
        before = copy.deepcopy(execution)
        result = mailbox.action_outcome(execution)
        self.assertTrue(result['queryOk'])
        self.assertEqual(result['status'], 'rejected')
        self.assertFalse(result['completionConfirmed'])
        self.assertEqual(result['gameSkill'], execution['receipt']['gameSkill'])
        self.assertEqual(result['recovery'], {'requiredNextStep': 'equip_then_observe', 'retryAutomatically': False})
        self.assertEqual(result['requested'], {'skill_id': 'heal'})
        self.assertNotIn('ok', result)
        self.assertEqual(execution, before)

    def test_missing_unknown_and_unconfirmed_outcomes_do_not_gain_success(self):
        self.assertIsNone(mailbox.action_outcome({'ok': False, 'code': 'action_busy', 'inFlight': True}))
        for receipt in ({'status': 'unknown', 'completionConfirmed': False, 'noReplay': True},
                        {'status': 'completed'},
                        {'status': 'dispatched', 'dispatchConfirmed': True, 'effectConfirmed': False}):
            result = mailbox.action_outcome({'ok': True, 'receipt': receipt})
            self.assertEqual({k: result[k] for k in receipt}, receipt)
            self.assertNotIn('success', result)
            self.assertEqual(result.get('completionConfirmed'), receipt.get('completionConfirmed'))
        self.assertIsNone(mailbox.action_outcome(None))


if __name__ == '__main__':
    unittest.main()
