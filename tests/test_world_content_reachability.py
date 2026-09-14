"""Contract reachability accounting: the seq309 manual Pythagorean intercept
(case-fe0b3f68) preserved as a receipt channel shared by every content actor.

The gateway goto pre-check rejects one goto beyond 24 horizontal blocks
(x/z only, y never participates). world/survival/numen_gateway.py owns the
constant; these tests pin the copied default here and keep the planner's
2026-09 "22 blocks to Shi Lei" under-report (missing the z delta) from
regressing into contract text nobody can walk.
"""
from pathlib import Path
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
sys.path.insert(0, str(ROOT / 'world/ops'))
import world_content as content
from world_content_tools import register_content_tools

DESIGNER, ADMIN, AUTHOR = content.ACTORS
PLAZA_WAYPOINT = {'x': -547, 'y': 64, 'z': 868}   # planner plaza anchor (seq297/309)
GUILD_PLAZA = {'x': -544, 'y': 65, 'z': 864}      # mc_guild.PLAZA world anchor
SHI_LEI = {'x': -568, 'y': 71, 'z': 886}          # 27.7 blocks out (not 22)
HE_SHU = {'x': -560, 'y': 80, 'z': 905}           # 39.2
ZHU_JIU = {'x': -538, 'y': 68, 'z': 768}          # 100.4, beyond two hops
HOME_HALL = {'name': '家·千灯堂', 'x': -541, 'y': 64, 'z': 868}
MINE_RELAY = {'name': '矿道中转', 'x': -557, 'y': 64, 'z': 877}


class ClassifyReachabilityTests(unittest.TestCase):
    def test_copied_gateway_limit_is_pinned(self):
        self.assertEqual(content.GOTO_SINGLE_HOP_LIMIT, 24)

    def test_real_world_bands_and_hops(self):
        cases = [({'x': -568, 'y': 71, 'z': 886}, (27.7, 2, 'relay_within_two_hops')),
                 ({'x': -570, 'y': 71, 'z': 886}, (29.2, 2, 'relay_within_two_hops')),
                 (HE_SHU, (39.2, 2, 'relay_within_two_hops')),
                 (ZHU_JIU, (100.4, 5, 'beyond_two_hops')),
                 ({'x': -547, 'y': 64, 'z': 880}, (12.0, 1, 'single_hop')),
                 (dict(PLAZA_WAYPOINT), (0.0, 0, 'single_hop'))]
        for target, expected in cases:
            row = content.classify_reachability(target, PLAZA_WAYPOINT)
            self.assertEqual((row['horizontalDistance'], row['requiredHops'], row['band']), expected)
            self.assertEqual(row['singleHopLimit'], 24)
            self.assertTrue(row['suggestion'])
        # The planner's 22-block claim only holds without the z delta; the
        # tool must keep reporting the full horizontal distance.
        self.assertEqual(content.classify_reachability(SHI_LEI, PLAZA_WAYPOINT)['horizontalDistance'], 27.7)

    def test_y_never_participates(self):
        self.assertEqual(content.classify_reachability(SHI_LEI, PLAZA_WAYPOINT),
                         content.classify_reachability({'x': -568, 'y': 320, 'z': 886},
                                                        {'x': -547, 'y': -60, 'z': 868}))

    def test_anchor_choice_is_explicit_and_changes_the_numbers(self):
        row = content.classify_reachability(SHI_LEI, GUILD_PLAZA)
        self.assertEqual((row['horizontalDistance'], row['band']), (32.6, 'relay_within_two_hops'))

    def test_named_waypoint_relay_requires_two_short_legs(self):
        row = content.classify_reachability(SHI_LEI, PLAZA_WAYPOINT, (HOME_HALL, MINE_RELAY))
        self.assertEqual(row['band'], 'relay_within_two_hops')
        self.assertEqual(row['relayViaWaypoint'],
                         {'x': -557, 'y': 64, 'z': 877, 'name': '矿道中转', 'maxLeg': 14.2})
        alone = content.classify_reachability(SHI_LEI, PLAZA_WAYPOINT, (HOME_HALL,))
        self.assertIsNone(alone['relayViaWaypoint'])

    def test_bad_points_are_rejected(self):
        for bad in ({'x': True, 'z': 0}, {'x': 1}, {'z': 1}, (1, 2), 'x1z2'):
            with self.assertRaisesRegex(ValueError, 'target'):
                content.classify_reachability(bad, PLAZA_WAYPOINT)
        with self.assertRaisesRegex(ValueError, 'anchor'):
            content.classify_reachability(SHI_LEI, {'x': 1.5})
        with self.assertRaisesRegex(ValueError, 'waypoint'):
            content.classify_reachability(SHI_LEI, PLAZA_WAYPOINT, ({'x': 1},))


class QueueReachabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.team = Path(self.tmp.name)
        self.queue = content.ContentQueue(self.team, clock=lambda: 2000)

    def write_context(self, issuers, origin=(-547, 64, 868), updated_at=2000):
        self.queue.root.mkdir(parents=True, exist_ok=True)
        content.save(self.queue.root / 'context.json',
                     {'schema': 1, 'updatedAt': updated_at, 'issuers': issuers,
                      'destinations': {'far_horizon': {'origin': list(origin)}}})

    def test_explicit_target_and_anchor_needs_no_context(self):
        row = self.queue.reachability(DESIGNER, target=SHI_LEI, anchor=PLAZA_WAYPOINT)
        self.assertTrue(row['ok'])
        self.assertEqual((row['horizontalDistance'], row['requiredHops'], row['band']),
                         (27.7, 2, 'relay_within_two_hops'))
        self.assertEqual(row['anchorSource'], 'explicit')
        self.assertEqual(row['worldActionsExecuted'], 0)

    def test_issuer_resolves_from_fresh_context_and_default_anchor(self):
        self.write_context([{'key': 'mc-stone', 'display': '石磊', 'position': [-568, 71, 886]}])
        row = self.queue.reachability(DESIGNER, issuer='mc-stone')
        self.assertEqual(row['anchorSource'], 'context_far_horizon_origin')
        self.assertEqual((row['horizontalDistance'], row['band']), (27.7, 'relay_within_two_hops'))
        self.assertEqual(row['target'], {'x': -568, 'y': 71, 'z': 886})
        self.assertEqual(row['worldActionsExecuted'], 0)

    def test_issuer_failures_and_stale_context(self):
        self.write_context([])
        with self.assertRaisesRegex(ValueError, 'issuer'):
            self.queue.reachability(ADMIN, issuer='mc-nobody')
        self.write_context([{'key': 'mc-stone', 'position': [-568, 71, 886]}], updated_at=1700)
        with self.assertRaisesRegex(ValueError, 'context_unavailable'):
            self.queue.reachability(AUTHOR, issuer='mc-stone')
        # Even with no usable context the pure path still answers.
        row = self.queue.reachability(AUTHOR, target=SHI_LEI, anchor=PLAZA_WAYPOINT)
        self.assertTrue(row['ok'])
        with self.assertRaisesRegex(ValueError, 'actor'):
            self.queue.reachability('game:qd-survivor', target=SHI_LEI, anchor=PLAZA_WAYPOINT)

    def test_exactly_one_destination_source(self):
        for kwargs in ({}, {'target': SHI_LEI, 'issuer': 'mc-stone'}):
            with self.assertRaisesRegex(ValueError, 'source'):
                self.queue.reachability(ADMIN, **kwargs)


class ReachabilityToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.team = Path(self.tmp.name)
        root = content.ContentQueue(self.team).root
        root.mkdir(parents=True, exist_ok=True)
        content.save(root / 'context.json',
                     {'schema': 1, 'updatedAt': time.time(),
                      'issuers': [{'key': 'mc-stone', 'display': '石磊', 'position': [-568, 71, 886]}],
                      'destinations': {'far_horizon': {'origin': [-547, 64, 868]}}})

    def app(self, actor):
        class App:
            def __init__(self):
                self.tools = {}
            def tool(self):
                def add(fn):
                    self.tools[fn.__name__] = fn
                    return fn
                return add
        app = App()
        names = register_content_tools(app, actor, self.team)
        self.assertIn('world_content_reachability', names)
        return app

    def test_every_content_actor_gets_the_shared_tool(self):
        for actor in content.ACTORS:
            row = self.app(actor).tools['world_content_reachability'](issuer='mc-stone')
            self.assertTrue(row['ok'])
            self.assertEqual((row['horizontalDistance'], row['requiredHops']), (27.7, 2))
            self.assertEqual(row['worldActionsExecuted'], 0)

    def test_explicit_geometry_follows_the_given_anchor_and_waypoints(self):
        row = self.app(DESIGNER).tools['world_content_reachability'](
            target=SHI_LEI, anchor=GUILD_PLAZA, waypoints=[MINE_RELAY])
        self.assertEqual((row['horizontalDistance'], row['band']), (32.6, 'relay_within_two_hops'))
        self.assertEqual(row['relayViaWaypoint']['maxLeg'], 18.4)
        self.assertEqual(row['anchorSource'], 'explicit')


if __name__ == '__main__':
    unittest.main()
