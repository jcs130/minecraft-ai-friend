"""Tombstone (case-638934 Step1a): superseded by test_survival_trajectory.py.

This suite targeted the earlier survivor_trajectory.py draft API
(build_turn_trajectories/scan_state/TrajectoryError codes) that was never
finished or aligned. Keeping it executable would fail the shared tests/ run
on import. The canonical suite is test_survival_trajectory.py. Safe to delete.
"""
import unittest


@unittest.skip('superseded by test_survival_trajectory.py (case-638934 Step1a)')
class SupersededDraftTests(unittest.TestCase):
    def test_placeholder(self):
        pass


if __name__ == '__main__':
    unittest.main()
