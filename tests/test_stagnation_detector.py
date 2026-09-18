"""Tests for the stagnation detector (P1): a stale goal, corroborated by the world."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from stagnation_detector import (StagnationDetector, detect, MIN_STAGNATION_SECONDS,
                                 COOLDOWN_SECONDS)

# The goal Kirito was actually holding on 2026-09-18 while the farm was unreachable.
HELD_GOAL = {'goal': '监控营地小麦成熟度，成熟后 harvest→plant 循环', 'goalState': 'ongoing'}
NO_OUTPUT = [{'kind': 'no_output', 'actions': 24, 'span': 4860}]
REFUSAL = [{'kind': 'repeated_rejection', 'tool': 'farm', 'repeats': 3}]
PRODUCTIVE = [{'kind': 'damage', 'events': 2, 'total': 6.4, 'lowest': 8.0}]


class DetectTests(unittest.TestCase):
    def setUp(self):
        self.now = 1_000_000.0
        self.seen = {'at': self.now - MIN_STAGNATION_SECONDS - 1}

    def test_a_recently_set_goal_is_never_stale(self):
        self.assertIsNone(detect(HELD_GOAL, NO_OUTPUT, {'at': self.now - 60}, self.now))

    def test_a_stale_goal_with_the_world_agreeing_fires(self):
        finding = detect(HELD_GOAL, NO_OUTPUT, self.seen, self.now)
        self.assertIsNotNone(finding)
        self.assertEqual(finding['corroboration'], ['no_output'])
        self.assertIn('①', finding['instruction'])
        self.assertIn('③', finding['instruction'])

    def test_a_stale_goal_with_a_productive_world_does_not_fire(self):
        """A long haul is not stagnation: walking somewhere is a legitimately fixed goal."""
        self.assertIsNone(detect(HELD_GOAL, PRODUCTIVE, self.seen, self.now))

    def test_no_environment_evidence_is_not_enough(self):
        self.assertIsNone(detect(HELD_GOAL, [], self.seen, self.now))

    def test_a_refusal_corroborates_too(self):
        finding = detect(HELD_GOAL, REFUSAL, self.seen, self.now)
        self.assertEqual(finding['corroboration'], ['repeated_rejection'])

    def test_a_finished_goal_is_not_stagnant(self):
        done = dict(HELD_GOAL, goalState='done')
        self.assertIsNone(detect(done, NO_OUTPUT, self.seen, self.now))

    def test_no_goal_at_all(self):
        for memory in ({}, {'goal': ''}, {'goal': None}, None):
            self.assertIsNone(detect(memory, NO_OUTPUT, self.seen, self.now))


class DetectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.now = [1_000_000.0]
        self.detector = StagnationDetector(self.root, clock=lambda: self.now[0])

    def test_the_first_sighting_only_starts_the_clock(self):
        self.assertEqual(self.detector.check(HELD_GOAL, NO_OUTPUT), [])
        self.assertIsNone(self.detector.get_pending_hint())

    def test_it_fires_once_the_goal_has_been_stale_long_enough(self):
        self.detector.check(HELD_GOAL, NO_OUTPUT)                     # starts the clock
        self.now[0] += MIN_STAGNATION_SECONDS - 10
        self.assertEqual(self.detector.check(HELD_GOAL, NO_OUTPUT), [])
        self.now[0] += 20
        hints = self.detector.check(HELD_GOAL, NO_OUTPUT)
        self.assertEqual(len(hints), 1)
        self.assertEqual(hints[0]['type'], 'stagnation_hint')
        self.assertIn('没有推进', hints[0]['message'])
        self.assertIsNotNone(self.detector.get_pending_hint())

    def test_a_new_goal_restarts_the_clock(self):
        self.detector.check(HELD_GOAL, NO_OUTPUT)
        self.now[0] += MIN_STAGNATION_SECONDS + 60
        moved_on = {'goal': '去河边钓鱼换点吃的', 'goalState': 'ongoing'}
        self.assertEqual(self.detector.check(moved_on, NO_OUTPUT), [])

    def test_progress_clears_the_hint_and_keeps_quiet(self):
        self.detector.check(HELD_GOAL, NO_OUTPUT)
        self.now[0] += MIN_STAGNATION_SECONDS + 60
        self.detector.check(HELD_GOAL, NO_OUTPUT)
        self.assertTrue(self.detector.hint_path.exists())
        self.now[0] += 60
        # The world reports production again: the stale-goal finding no longer stands.
        self.assertEqual(self.detector.check(HELD_GOAL, PRODUCTIVE), [])
        self.assertFalse(self.detector.hint_path.exists())

    def test_the_cooldown_stops_it_nagging(self):
        self.detector.check(HELD_GOAL, NO_OUTPUT)
        self.now[0] += MIN_STAGNATION_SECONDS + 60
        self.assertEqual(len(self.detector.check(HELD_GOAL, NO_OUTPUT)), 1)
        self.now[0] += COOLDOWN_SECONDS - 60
        self.assertEqual(self.detector.check(HELD_GOAL, NO_OUTPUT), [])
        self.now[0] += 120
        self.assertEqual(len(self.detector.check(HELD_GOAL, NO_OUTPUT)), 1)

    def test_a_malformed_state_file_does_not_break_it(self):
        (self.root / 'stagnation-state.json').write_text('{not json', encoding='utf-8')
        self.assertEqual(self.detector.check(HELD_GOAL, NO_OUTPUT), [])

    def test_the_tracked_goals_stay_bounded(self):
        for i in range(60):
            self.detector.check({'goal': 'goal number %d' % i, 'goalState': 'ongoing'}, [])
        state = json.loads((self.root / 'stagnation-state.json').read_text(encoding='utf-8'))
        self.assertLessEqual(len(state['tracked']), 32)


if __name__ == '__main__':
    unittest.main()
