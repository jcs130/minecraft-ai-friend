"""team_context persists per-service unhealthy windows from fresh health records (case-6457).

Probe incidents were tallied by hand from inspection snapshots across shifts; the store must
open a window on the first unhealthy read, extend it while the service stays unhealthy, close
it on the next healthy read with the recovery upper bound while healthy_before brackets the
onset, keep services independent, stay quiet on stale or malformed records, and keep the
reported series bounded.
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
        name: {'ok': name not in unhealthy} for name in ('qwenpaw', 'world', 'mc')}}
    return {'fresh': fresh, 'timestamp': timestamp, 'data': body}


class HealthIncidentTrackingTests(unittest.TestCase):
    def contexts(self, *sections):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        pending = [{'snapshots': {'health': section}} for section in sections]
        fake = N(snapshot=lambda: pending.pop(0))
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return [registered['team_context']() for _ in sections]

    def test_unhealthy_read_opens_window_with_bracket_note(self):
        result = self.contexts(health_section(['qwenpaw'], '2026-09-14T12:23:33.760Z'))[0]
        self.assertEqual(result['world']['healthIncidents'], [
            {'service': 'qwenpaw', 'firstObserved': '2026-09-14T12:23:33.760000Z',
             'lastObserved': '2026-09-14T12:23:33.760000Z', 'healthyBefore': None,
             'recoveredAfter': None, 'reads': 1}])
        notice = result['notice']
        self.assertIn('healthIncidents lists per-service unhealthy windows', notice)
        self.assertIn('bracketing the true fault bounds', notice)

    def test_persistent_unhealthy_extends_then_healthy_read_closes_and_brackets_next_window(self):
        results = self.contexts(health_section(['qwenpaw'], '2026-09-14T12:23:33Z'),
                                health_section(['qwenpaw'], '2026-09-14T12:35:33Z'),
                                health_section([], '2026-09-14T12:39:34Z'),
                                health_section(['qwenpaw'], '2026-09-14T13:05:00Z'))
        ongoing = results[1]['world']['healthIncidents']
        self.assertEqual(len(ongoing), 1)
        self.assertEqual(ongoing[0]['reads'], 2)
        self.assertEqual(ongoing[0]['lastObserved'], '2026-09-14T12:35:33Z')
        self.assertIsNone(ongoing[0]['recoveredAfter'])
        history = results[3]['world']['healthIncidents']
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]['recoveredAfter'], '2026-09-14T12:39:34Z')
        self.assertEqual(history[1]['healthyBefore'], '2026-09-14T12:39:34Z')
        self.assertEqual(history[1]['firstObserved'], '2026-09-14T13:05:00Z')
        self.assertIsNone(history[1]['recoveredAfter'])

    def test_independent_service_windows_close_separately(self):
        results = self.contexts(health_section(['qwenpaw', 'world'], '2026-09-14T11:29:34Z'),
                                health_section(['qwenpaw'], '2026-09-14T11:33:34Z'))
        by_service = {row['service']: row for row in results[1]['world']['healthIncidents']}
        self.assertEqual(set(by_service), {'qwenpaw', 'world'})
        self.assertEqual(by_service['qwenpaw']['reads'], 2)
        self.assertIsNone(by_service['qwenpaw']['recoveredAfter'])
        self.assertEqual(by_service['world']['reads'], 1)
        self.assertEqual(by_service['world']['recoveredAfter'], '2026-09-14T11:33:34Z')

    def test_stale_or_malformed_health_records_stay_quiet(self):
        for section in (health_section(['qwenpaw'], '2026-09-14T12:23:33Z', fresh=False),
                        health_section(None, '2026-09-14T12:23:33Z', data='not-a-dict'),
                        {'fresh': True, 'data': {'ok': False, 'services': {'qwenpaw': {'ok': False}}}},
                        {'fresh': True, 'data': {'ok': True, 'services': {}}}):
            world = self.contexts(section)[0]['world']
            self.assertNotIn('healthIncidents', world)
        sequence = self.contexts(health_section([], '2026-09-14T12:13:34Z'),
                                 health_section(['qwenpaw'], '2026-09-14T12:18:34Z', fresh=False),
                                 health_section(['qwenpaw'], '2026-09-14T12:23:33Z'))
        window = sequence[2]['world']['healthIncidents']
        self.assertEqual(len(window), 1)
        self.assertEqual(window[0]['firstObserved'], '2026-09-14T12:23:33Z')
        self.assertEqual(window[0]['healthyBefore'], '2026-09-14T12:13:34Z')
        self.assertEqual(window[0]['reads'], 1)

    def test_reported_series_stays_bounded(self):
        base = datetime(2026, 9, 14, 1, 0, tzinfo=timezone.utc)
        stamps = [(base + timedelta(minutes=10 * i)).isoformat().replace('+00:00', 'Z')
                  for i in range(10)]
        sections = [section
                    for i, stamp in enumerate(stamps)
                    for section in (health_section(['qwenpaw'], stamp),
                                    health_section([], (base + timedelta(minutes=10 * i + 5))
                                                   .isoformat().replace('+00:00', 'Z')))]
        history = self.contexts(*sections)[-1]['world']['healthIncidents']
        self.assertEqual(len(history), 8)
        self.assertEqual(history[0]['firstObserved'], stamps[2])
        self.assertEqual(history[-1]['firstObserved'], stamps[9])
        self.assertTrue(all(row['recoveredAfter'] is not None for row in history))
        self.assertTrue(all(row['reads'] == 1 for row in history))


if __name__ == '__main__':
    unittest.main()
