"""Freshness tests integrated from the Agent's reviewed commit 5de7f8af.

Keep the lazy OperationsTools import patched during invocation, and isolate
the root branch's separate survivor projection from live /public reads.
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
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}), \
             patch.object(mcp, 'survivor_snapshot', return_value={'status': 'unknown', 'fresh': False}):
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
        self.assertEqual(result['survivor'], {'status': 'unknown', 'fresh': False})

    def test_fresh_context_stays_quiet_and_malformed_sections_are_ignored(self):
        result = self.context({'snapshots': {
            'world': {'fresh': True}, 'operations': {}, 'broken': 'not-a-dict'}})
        self.assertEqual(result['world']['staleSnapshots'], [])
        self.assertNotIn('expired inspection records', result['notice'])

    def test_expired_records_remain_evidence_not_current_faults(self):
        historical = {'fresh': False, 'ageSeconds': 9000, 'data': {'ok': False}}
        result = self.context({'snapshots': {'world': historical, 'health': historical,
                                           'unknown': {'fresh': None}}})
        self.assertEqual(result['world']['staleSnapshots'], ['health', 'world'])
        self.assertEqual(result['world']['snapshots']['health'], historical)
        self.assertIn('not current health or current faults', result['notice'])


if __name__ == '__main__':
    unittest.main()
