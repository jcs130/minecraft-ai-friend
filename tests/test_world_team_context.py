"""team_context must separate expired inspection records from current facts.

Not part of the fixed engineering checks baseline yet; pinned plans still cover
world_team_mcp.py via test_world_team*.py imports. Proposed for inclusion so the
behaviour below is executed in isolation too.

OperationsTools.snapshot() is imported lazily inside the team_context call, so
the fake-module patch must stay active while the tool runs; patching only around
registration would let the real snapshot reader touch /public paths.
"""
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
import world_team_mcp as mcp


class TeamContextFreshnessTests(unittest.TestCase):
    def context(self, snapshot):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        fake = N(snapshot=lambda: snapshot)
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return registered['team_context']()

    def test_stale_snapshot_sections_are_flagged_as_expired_records(self):
        result = self.context({'worldActionsAllowed': True, 'snapshots': {
            'world': {'fresh': True, 'data': {}},
            'health': {'fresh': False, 'ageSeconds': 7532.5, 'data': {'ok': False}}}})
        self.assertEqual(result['world']['staleSnapshots'], ['health'])
        self.assertNotIn('worldActionsAllowed', result['world'])
        self.assertEqual(result['world']['worldActionsExecuted'], 0)
        self.assertIn('expired inspection records', result['notice'])

    def test_fresh_context_stays_quiet_and_malformed_sections_are_ignored(self):
        result = self.context({'snapshots': {
            'world': {'fresh': True}, 'operations': {}, 'broken': 'not-a-dict'}})
        self.assertEqual(result['world']['staleSnapshots'], [])
        self.assertNotIn('expired inspection records', result['notice'])

    def test_unhealthy_services_are_summarised_from_health_record(self):
        result = self.context({'snapshots': {'health': {'fresh': True, 'data': {
            'ok': False, 'services': {
                'mc': {'ok': True}, 'qwenpaw': {'ok': False}, 'npc': {'ok': True}}}}}})
        self.assertEqual(result['world']['unhealthyServices'], ['qwenpaw'])
        self.assertIn('health inspection record', result['notice'])
        self.assertNotIn('that record is expired', result['notice'])

    def test_unhealthy_services_flag_expired_when_health_record_is_stale(self):
        result = self.context({'snapshots': {'health': {'fresh': False, 'data': {
            'ok': False, 'services': {'qwenpaw': {'ok': False}}}}}})
        self.assertEqual(result['world']['staleSnapshots'], ['health'])
        self.assertEqual(result['world']['unhealthyServices'], ['qwenpaw'])
        self.assertIn('that record is expired', result['notice'])

    def test_unhealthy_services_stay_quiet_when_health_data_missing_or_malformed(self):
        result = self.context({'snapshots': {'health': {'fresh': True, 'data': {}},
                                             'operations': {'fresh': True, 'data': {
                                                 'services': {'qwenpaw': {'ok': False}}}}}})
        self.assertEqual(result['world']['unhealthyServices'], [])
        self.assertNotIn('health inspection record', result['notice'])
        malformed = self.context({'snapshots': {'health': {'fresh': True, 'data': {
            'services': ['qwenpaw', 'npc']}}}})
        self.assertEqual(malformed['world']['unhealthyServices'], [])


if __name__ == '__main__':
    unittest.main()
