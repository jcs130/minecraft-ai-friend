"""Tests for the strict-arrival failure verdict (2026-09-17 navigation deadlock).

The fixtures are the real surveys captured from the live agent's failed gotos on
2026-09-14, so the mapping from "what the survey said" to "what the agent should
do next" is pinned to observed data rather than to a guess about it.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from navigation_sense import verdict, STRICT_ARRIVAL_MARKER
from numen_gateway import receipt_evidence

REJECTED = {'success': False, 'reason': STRICT_ARRIVAL_MARKER + ': horizontal/unstable endpoint '
            'is not a dry supported destination; choose a verified landing cell'}


def survey(dest):
    return {'ok': True, 'code': 'executed', 'destination': dest}


# 09-14 15:33 — the survey says the requested stance is fine, but the coordinate
# sits exactly on a cell corner (floor(-640.5) = -641 while a body at -639.98 is
# in -640), so which cell the contract demands is a coin flip.
CORNER_CASE = ({'x': -640.5, 'y': 64.0, 'z': 1056.5},
               {'available': True, 'requestedStanceClear': True, 'requestedStanceSupported': True,
                'pathVerified': False, 'destinationChanged': False, 'examinedCells': 125,
                'unloadedCells': 0, 'truncated': True, 'code': 'requested_stance_observed',
                'targetBlock': 'minecraft:air',
                'requested': {'x': -640.5, 'y': 64.0, 'z': 1056.5},
                'candidates': [{'x': -640.5, 'y': 64.0, 'z': 1056.5,
                                'supportBlock': 'minecraft:grass_block', 'pathVerified': False}]})

# 09-14 13:20 — integral target, survey says the cell is clear and supported:
# the destination was never the problem.
SETTLE_CASE = ({'x': -644.0, 'z': 1059.0, 'y': 64.0},
               {'available': True, 'requestedStanceClear': True, 'requestedStanceSupported': True,
                'code': 'requested_stance_observed', 'targetBlock': 'minecraft:air',
                'requested': {'x': -644.0, 'y': 64.0, 'z': 1059.0},
                'candidates': [{'x': -644.5, 'y': 64.0, 'z': 1059.5,
                                'supportBlock': 'minecraft:grass_block', 'pathVerified': False}]})

# 09-14 15:17 — the target really is unusable: it is a water cell.
FLUID_CASE = ({'x': -665.0, 'z': 1058.0},
              {'available': True, 'requestedStanceClear': False, 'requestedStanceSupported': False,
               'code': 'target_contains_fluid', 'targetBlock': 'minecraft:water',
               'requested': {'x': -665.0, 'y': 61.05889, 'z': 1058.0},
               'candidates': [{'x': -666.5, 'y': 63.0, 'z': 1057.5,
                               'supportBlock': 'minecraft:grass_block', 'pathVerified': False},
                              {'x': -666.5, 'y': 63.0, 'z': 1058.5,
                               'supportBlock': 'minecraft:grass_block', 'pathVerified': False}]})

# 09-14 12:54 — nothing was surveyed at all, so the destination is unproven.
UNSURVEYED_CASE = ({'x': -650.0, 'z': 1053.0},
                   {'available': False, 'pathVerified': False, 'destinationChanged': False,
                    'code': 'target_outside_local_survey',
                    'requested': {'x': -650.0, 'y': 64.0, 'z': 1053.0}})


class VerdictTests(unittest.TestCase):
    def test_only_strict_arrival_failures_are_interpreted(self):
        """Everything else must pass through untouched."""
        for outcome in ({'success': False, 'reason': 'no path to target (from x toward y)'},
                        {'success': True},
                        {},
                        None,
                        {'success': False, 'reason': None},
                        {'success': False, 'reason': 42}):
            self.assertIsNone(verdict(survey(CORNER_CASE[1]), outcome, CORNER_CASE[0]))

    def test_a_cell_corner_coordinate_is_named_rather_than_guessed(self):
        args, dest = CORNER_CASE
        found = verdict(survey(dest), REJECTED, args)
        self.assertEqual(found['code'], 'destination_cell_ambiguous')
        self.assertEqual(found['action'], 'resend_integer_cell')
        self.assertEqual(found['cell'], -641)
        self.assertIn('-641', found['instruction'])
        self.assertIn('整数', found['instruction'])

    def test_an_integral_target_with_a_clean_survey_is_not_the_agents_fault(self):
        """The lived misdirection: the cell was fine and the message sent it hunting."""
        args, dest = SETTLE_CASE
        found = verdict(survey(dest), REJECTED, args)
        self.assertEqual(found['code'], 'destination_usable_settle_failed')
        self.assertIs(found['targetUsable'], True)
        self.assertEqual(found['action'], 'retry_same_target')
        self.assertIn('不要改坐标', found['instruction'])

    def test_an_unusable_target_hands_over_the_surveyed_candidates(self):
        args, dest = FLUID_CASE
        found = verdict(survey(dest), REJECTED, args)
        self.assertEqual(found['code'], 'destination_unusable')
        self.assertIs(found['targetUsable'], False)
        self.assertEqual(found['action'], 'choose_candidate')
        self.assertEqual(len(found['candidates']), 2)
        self.assertEqual(found['candidates'][0]['supportBlock'], 'minecraft:grass_block')

    def test_an_unusable_target_with_no_candidates_never_says_pick_one(self):
        """Observed live at 19:2x: a water target whose survey returned no candidates,
        while the instruction still said 'pick one from candidates'."""
        args = {'x': -775.0, 'z': 1102.0}
        dest = {'available': True, 'requestedStanceClear': False, 'requestedStanceSupported': False,
                'code': 'target_contains_fluid', 'targetBlock': 'minecraft:water',
                'requested': {'x': -775.0, 'y': 61.0, 'z': 1102.0}, 'candidates': []}
        found = verdict(survey(dest), REJECTED, args)
        self.assertEqual(found['code'], 'destination_unusable')
        self.assertEqual(found['action'], 'move_clear_then_retry')
        self.assertEqual(found['candidates'], [])
        self.assertNotIn('candidates 里挑', found['instruction'])
        self.assertIn('干处', found['instruction'])

    def test_an_unsurveyed_destination_is_retried_before_being_abandoned(self):
        args, dest = UNSURVEYED_CASE
        found = verdict(survey(dest), REJECTED, args)
        self.assertEqual(found['code'], 'destination_not_surveyable')
        self.assertEqual(found['action'], 'retry_once')
        self.assertIsNone(found['targetUsable'])

    def test_the_more_specific_diagnosis_wins(self):
        """A corner coordinate explains the failure better than a clean survey does."""
        args, dest = CORNER_CASE
        found = verdict(survey(dest), REJECTED, args)
        self.assertEqual(found['code'], 'destination_cell_ambiguous')

    def test_a_fractional_height_is_not_a_cell_corner(self):
        """y=64.9375 is a normal farm stance, only x/z define the feet cell."""
        args = {'x': -639.0, 'z': 1054.0, 'y': 64.9375}
        found = verdict(survey(SETTLE_CASE[1]), REJECTED, args)
        self.assertEqual(found['code'], 'destination_usable_settle_failed')


class ProjectionTests(unittest.TestCase):
    def test_the_verdict_reaches_the_model(self):
        args, dest = FLUID_CASE
        row = {'tool': 'goto', 'args': args, 'status': 'failed',
               'result': {'ok': False, 'code': 'action_rejected'},
               'navigationVerdict': verdict(survey(dest), REJECTED, args)}
        summary = receipt_evidence(row)
        self.assertEqual(summary['navigationVerdict']['code'], 'destination_unusable')
        self.assertEqual(len(summary['navigationVerdict']['candidates']), 2)

    def test_a_verdict_nested_in_the_result_is_also_projected(self):
        args, dest = SETTLE_CASE
        row = {'tool': 'goto', 'args': args,
               'result': {'ok': True, 'result': {'navigationVerdict': verdict(survey(dest), REJECTED, args)}}}
        self.assertEqual(receipt_evidence(row)['navigationVerdict']['code'],
                         'destination_usable_settle_failed')

    def test_a_receipt_without_a_verdict_is_unchanged(self):
        row = {'tool': 'farm', 'args': {'x': -639, 'y': 64, 'z': 1054},
               'result': {'ok': True, 'code': 'executed'}}
        self.assertNotIn('navigationVerdict', receipt_evidence(row))


if __name__ == '__main__':
    unittest.main()
