"""team_context pairs survivor unhealthy windows with controller self-report samples (case-7772).

The survivor container flap of 2026-09-14 22:29 CST showed state=exited in the health inspection
record while the controller re-established itself online (bodyReconnect restored_identity_verified)
97 seconds later; the divergence had to be reconstructed by hand from adjacent snapshots. The
store must now sample the controller channel on every unhealthy survivor read, keep absent
channels quiet, distinguish an expired controller record (fresh=false) from a missing one, stay
bounded, and the mcp pairing layer must surface controllerReads while the container-probe verdict
still waits for host receipts. Exposing survivor.json as an OperationsTools snapshot section is a
parked candidate (coverage-gated) in drafts/parked-survivor-snapshot-section-20260914.md.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
import world_team_mcp as mcp


def health_section(unhealthy, timestamp, fresh=True, data=None):
    body = data if data is not None else {'ok': not unhealthy, 'services': {
        name: {'ok': name not in unhealthy} for name in ('survivor', 'qwenpaw', 'mc')}}
    return {'fresh': fresh, 'timestamp': timestamp, 'data': body}


def controller_section(online=True, fresh=True, reason='restored_identity_verified'):
    return {'fresh': fresh, 'ageSeconds': 2.0, 'timestamp': '2026-09-14T14:29:40.000Z',
            'sha256': 'deadbeef', 'data': {
                'status': 'thinking' if online else 'reconnecting', 'bodyOnline': online,
                'reconnectStatus': 'online' if online else 'offline',
                'reconnectReason': reason if online else None,
                'enabled': True, 'autonomous': True, 'goalState': 'ongoing',
                'bodyOk': online, 'actionExecutionOk': True,
                'lastDecisionTaskId': 'task-9428f97a090e', 'lastDecisionCompleted': True}}


class SurvivorControllerEvidenceHelperTests(unittest.TestCase):
    def test_missing_or_malformed_channel_returns_none(self):
        self.assertIsNone(mcp.survivor_controller_evidence({}))
        self.assertIsNone(mcp.survivor_controller_evidence({'survivor': 'not-a-section'}))

    def test_fields_are_picked_plain_with_fresh_flag(self):
        evidence = mcp.survivor_controller_evidence(
            {'survivor': controller_section(online=False, fresh=False)})
        self.assertEqual(evidence, {'fresh': False, 'status': 'reconnecting', 'bodyOnline': False,
                                    'reconnectStatus': 'offline', 'reconnectReason': None})


class SurvivorControllerPairingTests(unittest.TestCase):
    def contexts(self, *snapshots):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        pending = list(snapshots)
        fake = N(snapshot=lambda: pending.pop(0))
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return [registered['team_context']() for _ in snapshots]

    def flap(self, controller):
        return self.contexts(
            {'snapshots': {'health': health_section([], '2026-09-14T14:23:35Z')},
             'survivor': controller_section()},
            {'snapshots': {'health': health_section(['survivor'], '2026-09-14T14:29:36Z')},
             'survivor': controller},
            {'snapshots': {'health': health_section([], '2026-09-14T14:33:35Z')},
             'survivor': controller_section()})

    def test_exited_container_verdict_pairs_with_restored_controller_sample(self):
        results = self.flap(controller_section(online=True))
        window = results[1]['world']['healthIncidents']
        self.assertEqual(window[0]['service'], 'survivor')
        self.assertEqual(window[0]['controllerReads'], [
            {'fresh': True, 'status': 'thinking', 'bodyOnline': True,
             'reconnectStatus': 'online', 'reconnectReason': 'restored_identity_verified'}])
        closed = results[2]['world']['healthIncidents']
        self.assertEqual(closed[0]['recoveredAfter'], '2026-09-14T14:33:35Z')
        self.assertEqual(closed[0]['controllerReads'][0]['reconnectReason'],
                         'restored_identity_verified')
        self.assertIn('controllerReads', results[2]['notice'])
        self.assertIn('host receipts', results[2]['notice'])

    def test_expired_controller_report_is_recorded_as_fresh_false(self):
        results = self.flap({'fresh': False, 'code': 'snapshot_unavailable'})
        reads = results[1]['world']['healthIncidents'][0]['controllerReads']
        self.assertEqual(reads, [{'fresh': False, 'status': None, 'bodyOnline': None,
                                  'reconnectStatus': None, 'reconnectReason': None}])

    def test_absent_or_malformed_channel_stays_quiet(self):
        for channel in (None, 'not-a-section'):
            with self.subTest(channel=channel):
                snapshot = {'snapshots': {'health': health_section(['survivor'],
                                                                   '2026-09-14T14:29:36Z')}}
                if isinstance(channel, dict):
                    snapshot['survivor'] = channel
                result = self.contexts(snapshot)[0]
                row = result['world']['healthIncidents'][0]
                self.assertNotIn('controllerReads', row)
                self.assertNotIn('controllerReads', result['notice'])

    def test_other_services_are_not_paired_with_controller_reads(self):
        results = self.contexts(
            {'snapshots': {'health': health_section(['qwenpaw'], '2026-09-14T14:23:35Z')},
             'survivor': controller_section()})
        row = results[0]['world']['healthIncidents'][0]
        self.assertEqual(row['service'], 'qwenpaw')
        self.assertNotIn('controllerReads', row)

    def test_persistent_window_keeps_bounded_samples_through_close(self):
        base = datetime(2026, 9, 14, 14, 0, tzinfo=timezone.utc)
        snapshots = [{'snapshots': {'health': health_section(
            ['survivor'], (base + timedelta(minutes=i)).isoformat().replace('+00:00', 'Z'))},
            'survivor': controller_section()} for i in range(10)]
        snapshots.append({'snapshots': {'health': health_section(
            [], (base + timedelta(minutes=11)).isoformat().replace('+00:00', 'Z'))},
            'survivor': controller_section()})
        window = self.contexts(*snapshots)[-1]['world']['healthIncidents'][0]
        self.assertEqual(window['reads'], 10)
        self.assertEqual(len(window['controllerReads']), 8)
        self.assertEqual(window['controllerReads'][0], {
            'fresh': True, 'status': 'thinking', 'bodyOnline': True,
            'reconnectStatus': 'online', 'reconnectReason': 'restored_identity_verified'})


if __name__ == '__main__':
    unittest.main()
