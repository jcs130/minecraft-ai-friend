"""An explicitly opted return route yields at an idle boundary."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from auto_patrol import yield_to_explicit
from motor_mailbox import enqueue_locked, open_cognition
from numen_gateway import action_lock, read_json, write_json


class MotionContinuationYieldTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = 1800000000.0
        self.clock = lambda: self.now
        self.turn = 'survival-patrol-0001'
        self.body = {'bodyUuid': 'actor', 'hp': 16, 'hunger': 12,
                     'onGround': True, 'inWater': False, 'inLava': False}
        self.goal = {'goal': '巡逻观察', 'goalState': 'ongoing'}
        self.c = SimpleNamespace(root=self.root, clock=self.clock,
            environment={'ok': True, 'bodyUuid': 'actor',
                         'observedAt': int(self.now * 1000), 'hostiles': []},
            record=Mock())
        self.c.memory = lambda: self.goal
        write_json(self.root / 'control.json', {'enabled': True})
        write_json(self.root / 'settings.json', {'asyncMotor': True})
        open_cognition(self.root, self.turn, (self.now + 120) * 1000, self.clock)
        self.job = {'status': 'running', 'name': 'base_motion_plan',
                    'motorRequestId': 'original', 'memory': {
                        'continueWhileThinking': True, 'continuationUsed': True,
                        'goalClaim': '巡逻观察'}}
        write_json(self.root / 'skill-job.json', self.job)

    def test_return_route_keeps_running_when_safe(self):
        self.assertFalse(yield_to_explicit(self.c, self.body))
        self.assertEqual(read_json(self.root / 'skill-job.json'), self.job)
        self.c.record.assert_not_called()

    def test_new_planner_command_preempts_return_route(self):
        with action_lock(self.root):
            enqueue_locked(self.root, self.turn, 'action',
                           {'tool': 'eat', 'args': {}}, self.clock)
        self.assertTrue(yield_to_explicit(self.c, self.body))
        stopped = read_json(self.root / 'skill-job.json')
        self.assertEqual(stopped['status'], 'replan')
        self.assertEqual(stopped['reason'], 'planner_command_preempted')

    def test_danger_or_goal_change_preempts_return_route(self):
        self.assertTrue(yield_to_explicit(self.c, self.body | {'hp': 7}))
        self.assertEqual(read_json(self.root / 'skill-job.json')['reason'],
                         'unsafe_body_or_scene')
        write_json(self.root / 'skill-job.json', self.job)
        self.goal = {'goal': '别的目标', 'goalState': 'ongoing'}
        self.assertTrue(yield_to_explicit(self.c, self.body))
        write_json(self.root / 'skill-job.json', self.job)
        self.goal = {'goal': '巡逻观察', 'goalState': 'ongoing'}
        self.c.environment['hostiles'] = [{'type': 'zombie'}]
        self.assertTrue(yield_to_explicit(self.c, self.body))

    def test_original_leg_still_yields_to_danger(self):
        write_json(self.root / 'skill-job.json', self.job | {'memory':
            self.job['memory'] | {'continuationUsed': False}})
        self.assertTrue(yield_to_explicit(self.c, self.body | {'hp': 7}))


if __name__ == '__main__':
    unittest.main()
