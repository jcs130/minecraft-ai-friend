"""PARKED: dispatch-time water guard for world/survival/numen_gateway.py.

The candidate (goto refused BEFORE dispatch when the leg touches an observed
water corridor or ends inside an observed in-water stall zone, with codes
water_crossing_unverified / water_target_unverified so the planner can
reroute instead of stalling underwater) is implemented with unit tests in
the qd-engineer workspace draft drafts/river-dispatch-guard/, but
world/survival/ sits outside the coverage of the only fixed engineering test
plan (team-guild-admin-python): engineering_test rejected the snapshot with
engineering_changes_not_covered_by_plan (2026-09-15). Nothing in
world/survival/ has landed — do NOT assume goto refuses water legs today.

Restore path: once a plan covers world/survival/, land the draft and move
its guard tests here, pinning the enforcement constants against
world/sidecar/world_content.py OBSERVED_WATER_CROSSINGS so the two copies
cannot drift. Until then the live half is the advisory flag tested in
tests/test_world_content_water_evidence.py.
"""
import unittest


class ParkedDispatchGuardTests(unittest.TestCase):
    def test_guard_is_parked_not_landed(self):
        self.skipTest('world/survival/ awaits test-plan coverage; candidate in '
                      'qd-engineer drafts/river-dispatch-guard/')


if __name__ == '__main__':
    unittest.main()
