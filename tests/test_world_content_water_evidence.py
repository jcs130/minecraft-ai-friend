"""Water-corridor advisory evidence (case-52f0d5bb65c49ef1cb2a, 2026-09-15).

Pins the two observed entries after the seq462/463 two-bank ruling: the
>70-block village-camp corridor, and the z≈803-809 north pocket accepted
from paired entity observations — rivercase-18 (yui, dry east edge, y=63.0),
rivercase-19 (yui, in-water west point, y=61.6, continuously moving), with
Kirito's y=59 in-water stall between them. minWidthBlocks stays a confirmed
in-water LOWER bound (never the full pocket width) and the west edge of the
pocket was never observed. The dispatch-time goto guard for world/survival
is a PARKED candidate pending test-plan coverage — see the skipped test in
tests/test_numen_gateway_water_guard.py; only this advisory half is live.
"""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
import world_content as content

CORRIDOR = content.OBSERVED_WATER_CROSSINGS[0]
POCKET = content.OBSERVED_WATER_CROSSINGS[1]
PLAZA = {'x': -547, 'y': 64, 'z': 868}
SHI_LEI_NPC = {'x': -568, 'y': 71, 'z': 886}
SAFE_LANDING = {'x': -597.5, 'y': 63, 'z': 801.5}    # rescue landing, dry east of pocket
STALL_APPROACH = {'x': -599.0, 'y': 59, 'z': 806.0}  # the doomed step class toward the stall zone
KIRITO_STALL = {'x': -599.3, 'y': 59, 'z': 802.3}


class CorridorEvidenceTests(unittest.TestCase):
    def test_corridor_sources_carry_every_rescue_receipt(self):
        sources = CORRIDOR['sources']
        for needle in ('admin-receipt:goddess-rescue-20260915-rivercase-1:native_teleport_confirmed',
                       'goddess-rescue-20260915-rivercase-2:native_teleport_confirmed',
                       'goddess-rescue-20260915-rivercase-3:native_teleport_confirmed',
                       'case-3c85d05fe93243fca371:seq442-fourth-stall-double-observed'):
            self.assertIn(needle, sources)
        self.assertEqual(CORRIDOR['minWidthBlocks'], 70)
        self.assertEqual(CORRIDOR['banks'], ((-582.8, 847.3), (-639.0, 1055.0)))


class NorthPocketRulingTests(unittest.TestCase):
    """The engineering ruling on rivercase-18/19 (case-b29410d5d257b5c1387b)."""

    def test_pocket_entry_is_pinned(self):
        self.assertEqual(POCKET['id'], 'river-north-pocket-2026-09-15')
        self.assertEqual(POCKET['banks'], ((-596.36, 805.46), (-602.51, 804.51)))
        self.assertEqual(POCKET['minWidthBlocks'], 3)
        self.assertEqual(POCKET['observedAt'], '2026-09-15')
        sources = POCKET['sources']
        self.assertIn('goddess-inspect-20260915-rivercase-18:yui-east-dry-y63', sources)
        self.assertIn('goddess-inspect-20260915-rivercase-19:yui-west-wading-y61.6-moving', sources)
        self.assertIn('case-3c85d05fe93243fca371:rivercase-9-19-kirito-stall-y59-in-water', sources)

    def test_confirmed_in_water_lower_bound_is_honest(self):
        """Kirito's stall lies between the observed pair, and the recorded
        minimum stays at or below the measured in-water span, so the entry
        can never overstate the pocket."""
        (ex, ez), (wx, wz) = POCKET['banks']
        self.assertTrue(min(ex, wx) <= KIRITO_STALL['x'] <= max(ex, wx))
        measured = ((KIRITO_STALL['x'] - wx) ** 2 + (KIRITO_STALL['z'] - wz) ** 2) ** 0.5
        self.assertGreaterEqual(measured, POCKET['minWidthBlocks'])
        # The west point itself is wading water, so the pocket does not end
        # there; the entry must not claim a dry west bank exists.
        self.assertNotIn('west-dry', ' '.join(POCKET['sources']))


class AdvisoryFlagTests(unittest.TestCase):
    def test_step_from_safe_landing_into_pocket_is_flagged(self):
        row = content.classify_reachability(STALL_APPROACH, SAFE_LANDING)
        ids = [crossing['id'] for crossing in row['waterCrossings']]
        self.assertIn('river-north-pocket-2026-09-15', ids)
        pocket = row['waterCrossings'][0]
        self.assertEqual(pocket['tpRelayCasts'], 1)
        self.assertEqual(pocket['tpManaEstimate'], 20)
        self.assertIn('跨水警示', row['suggestion'])

    def test_east_side_village_legs_stay_unflagged(self):
        row = content.classify_reachability(SHI_LEI_NPC, PLAZA)
        self.assertEqual(row['waterCrossings'], [])
        self.assertNotIn('跨水警示', row['suggestion'])

    def test_village_to_camp_leg_still_flags_the_corridor(self):
        row = content.classify_reachability({'x': -639, 'y': 64, 'z': 1055}, PLAZA)
        ids = [crossing['id'] for crossing in row['waterCrossings']]
        self.assertIn('village-camp-river-2026-09-15', ids)


if __name__ == '__main__':
    unittest.main()
