import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from world_team import TeamStore
from world_team_mcp import unhealthy_service_evidence
import test_world_team as _baseline


class UnhealthyServiceEvidenceTests(unittest.TestCase):
    def test_running_but_unhealthy_service_keeps_raw_fields_from_both_records(self):
        sections = {
            'health': {'fresh': True, 'data': {'services': {
                'mc': {'ok': True, 'state': 'running', 'health': 'healthy'},
                'qwenpaw': {'ok': False, 'state': 'running', 'health': 'unhealthy'}}}},
            'operations': {'fresh': True, 'data': {'services': [
                {'id': 'mc', 'state': 'running', 'ready': True},
                {'id': 'qwenpaw', 'state': 'running', 'ready': True},
                {'id': 'gate', 'state': 'running', 'ready': True}]}}}
        unhealthy, evidence = unhealthy_service_evidence(sections)
        # case-3a152890: one record can mark a service unhealthy while the panel
        # keeps it ready — the raw state/health/ready fields stay in the receipt
        # so each role judges the divergence from the record itself.
        self.assertEqual(unhealthy, ['qwenpaw'])
        self.assertEqual(evidence, [{'name': 'qwenpaw', 'state': 'running',
                                     'health': 'unhealthy', 'ready': True}])

    def test_malformed_or_absent_sections_yield_no_evidence(self):
        self.assertEqual(unhealthy_service_evidence({}), ([], []))
        self.assertEqual(unhealthy_service_evidence(
            {'health': {'data': {'services': {'npc': {'ok': False, 'state': 'restarting'}}}},
             'operations': None}),
            (['npc'], [{'name': 'npc', 'state': 'restarting', 'health': None, 'ready': None}]))
