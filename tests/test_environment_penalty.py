"""Tests for the environment-penalty detector (真实反馈触发进化).

Two of these are the acceptance criteria from docs/ENVIRONMENT-PENALTY-EVOLUTION.md:
the 2026-09-17 loop must fire at the third repetition, and the agent's normal
post-fix round trip must not fire at all.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from environment_penalty import (EnvironmentPenaltyDetector, detect, normalize, parse,
                                 REJECTION_REPEAT_THRESHOLD)

COOLDOWN = 300


def plant_refusal():
    """The refusal the live agent hit fifteen times in twenty minutes on 2026-09-17."""
    return normalize({
        'tool': 'farm',
        'args': {'operation': 'plant', 'item_id': 'minecraft:wheat_seeds', 'x': -639, 'y': 64, 'z': 1054},
        'result': {'ok': False, 'code': 'invalid_planting_target_or_seed'},
    })


def aim_refusal(x, z):
    """About 66 of these in a single day: one obstacle, many cells."""
    return normalize({
        'tool': 'farm',
        'args': {'operation': 'plant', 'item_id': 'minecraft:wheat_seeds', 'x': x, 'y': 65, 'z': z},
        'result': {'ok': False, 'code': 'action_rejected',
                   'result': {'success': False,
                              'message': 'aim %d,64,%d is blocked from here - the crosshair lands on wheat' % (x, z)}},
    })


def executed(tool, args=None, counts=None, hp=None, at=None):
    body = {}
    if counts is not None:
        body['counts'] = counts
    if hp is not None:
        body['hp'] = hp
    raw = {'tool': tool, 'args': args or {}, 'result': {'ok': True, 'code': 'executed'},
           'before': dict(body), 'after': dict(body)}
    if at is not None:
        raw['acceptedAt'] = at
    return normalize(raw)


def damaged(tool, hp_before, hp_after, args=None):
    return normalize({'tool': tool, 'args': args or {}, 'result': {'ok': True, 'code': 'executed'},
                      'before': {'hp': hp_before, 'counts': {}},
                      'after': {'hp': hp_after, 'counts': {}}})


class RejectionTests(unittest.TestCase):
    def test_fires_at_the_third_identical_refusal(self):
        self.assertEqual(detect([plant_refusal(), plant_refusal()]), [])
        signals = detect([plant_refusal()] * REJECTION_REPEAT_THRESHOLD)
        self.assertEqual([s['kind'] for s in signals], ['repeated_rejection'])
        self.assertEqual(signals[0]['repeats'], 3)
        self.assertEqual(signals[0]['tool'], 'farm')

    def test_the_2026_09_17_loop_is_caught(self):
        """Fifteen refusals over twenty minutes, with the position moving every time."""
        signals = detect([plant_refusal()] * 15)
        self.assertTrue(any(s['kind'] == 'repeated_rejection' for s in signals))

    def test_different_cells_group_as_one_obstacle(self):
        """Masking coordinates is what turns 66 daily refusals into one signal."""
        signals = detect([aim_refusal(-639, 1054), aim_refusal(-638, 1056), aim_refusal(-640, 1055)])
        self.assertEqual([s['kind'] for s in signals], ['repeated_rejection'])
        self.assertEqual(signals[0]['repeats'], 3)
        self.assertIn('crosshair', signals[0]['observed'])
        self.assertNotIn('-639', signals[0]['observed'])

    def test_unrelated_refusals_do_not_group(self):
        self.assertEqual(detect([plant_refusal(), aim_refusal(-639, 1054), plant_refusal()]), [])


class NoFalsePositiveTests(unittest.TestCase):
    """The sibling detector fired on this exact run. The environment one must not."""

    def test_normal_round_trip_is_silent(self):
        signals = detect([
            executed('goto', {'x': -640.0, 'z': 1054.0}),
            executed('goto', {'x': -639.0, 'z': 1051.0}),
            executed('goto', {'x': -645.0, 'z': 1065.0}),
            executed('goto', {'x': -640.0, 'z': 1055.0}),
            executed('goto', {'x': -639.0, 'z': 1055.0}),
            executed('farm', {'x': -639, 'y': 65, 'z': 1054}, counts={'minecraft:wheat': 3}),
        ])
        self.assertEqual(signals, [])

    def test_one_ordinary_hit_is_not_a_pattern(self):
        self.assertEqual(detect([damaged('goto', 20.0, 17.6)]), [])

    def test_repeated_target_with_real_output_is_not_stuck(self):
        spot = {'x': -639, 'y': 64, 'z': 1054}
        signals = detect([executed('farm', spot, counts={'minecraft:wheat': n}) for n in (1, 2, 3)])
        self.assertEqual([s['kind'] for s in signals], [])


class NoOutputTests(unittest.TestCase):
    """The signal that actually describes 2026-09-17.

    That day the agent was not refused (almost nothing was rejected) and it did
    not hammer one cell (61 distinct destinations). It simply spent about a
    hundred minutes moving while nothing was tilled, planted, mined or crafted.
    ``acceptedAt`` is epoch milliseconds, as the gateway writes it.
    """

    BASE = 1789628400000

    def test_busy_without_output_fires(self):
        stream = [executed('goto', {'x': -638.5, 'z': 1054.5 + i}, at=self.BASE + i * 90000)
                  for i in range(7)]
        signals = detect(stream)
        self.assertEqual([s['kind'] for s in signals], ['no_output'])
        self.assertEqual(signals[0]['actions'], 7)
        self.assertGreaterEqual(signals[0]['span'], 480)

    def test_one_productive_result_in_the_window_is_enough_to_stay_quiet(self):
        stream = [executed('goto', {'x': -638.5, 'z': 1054.5 + i}, at=self.BASE + i * 90000)
                  for i in range(6)]
        stream.append(executed('farm', {'x': -639, 'y': 65, 'z': 1054}, at=self.BASE + 600000))
        self.assertEqual(detect(stream), [])

    def test_a_short_burst_is_not_reported(self):
        """Distinct destinations, so this isolates the span rule only."""
        stream = [executed('goto', {'x': -638.5 + i, 'z': 1054.5}, at=self.BASE + i * 10000)
                  for i in range(8)]
        self.assertEqual([s['kind'] for s in detect(stream)], [])

    def test_one_cell_hammered_is_still_the_other_signal(self):
        """Eight returns to one cell is stuck_no_progress, not no_output."""
        stream = [executed('goto', {'x': -638.5, 'z': 1054.5}, at=self.BASE + i * 10000)
                  for i in range(8)]
        self.assertEqual([s['kind'] for s in detect(stream)], ['stuck_no_progress'])

    def test_the_message_allows_for_travel_instead_of_asserting_failure(self):
        """Only the world's facts are asserted; intent is left to the agent."""
        stream = [executed('goto', {'x': -600.0 + i, 'z': 900.0}, at=self.BASE + i * 90000)
                  for i in range(7)]
        from environment_penalty import _message
        text = _message(detect(stream))
        self.assertIn('环境反馈', text)
        self.assertIn('赶路', text)


class DamageTests(unittest.TestCase):
    def test_a_near_death_result_reports_even_once(self):
        signals = detect([damaged('goto', 20.0, 2.0)])
        self.assertEqual([s['kind'] for s in signals], ['damage'])
        self.assertTrue(signals[0]['nearDeath'])
        self.assertEqual(signals[0]['lowest'], 2.0)

    def test_repeated_drops_report_the_total(self):
        signals = detect([damaged('goto', 20.0, 18.4), damaged('goto', 18.4, 13.6)])
        self.assertEqual([s['kind'] for s in signals], ['damage'])
        self.assertEqual(signals[0]['events'], 2)
        self.assertEqual(signals[0]['total'], 6.4)
        self.assertFalse(signals[0]['nearDeath'])


class StuckTests(unittest.TestCase):
    def test_same_target_without_output_is_stuck(self):
        spot = {'x': -638.5, 'y': 64.9375, 'z': 1055.5}
        signals = detect([executed('goto', spot) for _ in range(3)])
        self.assertEqual([s['kind'] for s in signals], ['stuck_no_progress'])
        self.assertEqual(signals[0]['repeats'], 3)


class DetectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.receipts = self.root / 'action-receipts'
        self.receipts.mkdir()
        self.now = [1000.0]

    def write(self, index, payload):
        (self.receipts / ('%03d.json' % index)).write_text(
            json.dumps(payload, ensure_ascii=False), encoding='utf-8')

    def test_check_persists_a_hint_and_the_cooldown_suppresses_the_next(self):
        for i in range(3):
            self.write(i, {'tool': 'farm', 'args': {'x': -639, 'y': 64, 'z': 1054},
                           'result': {'ok': False, 'code': 'invalid_planting_target_or_seed'}})
        detector = EnvironmentPenaltyDetector(self.root, clock=lambda: self.now[0])
        hints = detector.check(self.receipts)
        self.assertEqual(len(hints), 1)
        self.assertEqual(hints[0]['type'], 'environment_penalty_hint')
        self.assertIn('环境反馈', hints[0]['message'])
        self.assertIsNotNone(detector.get_pending_hint())

        later = EnvironmentPenaltyDetector(self.root, clock=lambda: self.now[0] + 10)
        self.assertEqual(later.check(self.receipts), [])

    def test_hint_is_cleared_once_the_environment_stops_complaining(self):
        for i in range(3):
            self.write(i, {'tool': 'farm', 'args': {'x': -639, 'y': 64, 'z': 1054},
                           'result': {'ok': False, 'code': 'invalid_planting_target_or_seed'}})
        detector = EnvironmentPenaltyDetector(self.root, clock=lambda: self.now[0])
        detector.check(self.receipts)
        self.assertTrue(detector.hint_path.exists())

        for f in self.receipts.glob('*.json'):
            f.unlink()
        for i in range(4):
            self.write(i, {'tool': 'farm', 'args': {'x': -639, 'y': 65, 'z': 1054},
                           'result': {'ok': True, 'code': 'executed'},
                           'before': {'counts': {'minecraft:wheat': i}},
                           'after': {'counts': {'minecraft:wheat': i + 1}}})
        fresh = EnvironmentPenaltyDetector(self.root, clock=lambda: self.now[0] + COOLDOWN)
        self.assertEqual(fresh.check(self.receipts), [])
        self.assertFalse(fresh.hint_path.exists())

    def test_malformed_receipts_are_skipped_not_raised(self):
        (self.receipts / 'broken.json').write_text('{not json', encoding='utf-8')
        (self.receipts / 'empty.json').write_text('[]', encoding='utf-8')
        self.write(9, {'tool': 'farm', 'args': {'x': -639, 'y': 64, 'z': 1054},
                       'result': {'ok': False, 'code': 'invalid_planting_target_or_seed'}})
        detector = EnvironmentPenaltyDetector(self.root, clock=lambda: self.now[0])
        self.assertEqual(detector.check(self.receipts), [])


if __name__ == '__main__':
    unittest.main()
