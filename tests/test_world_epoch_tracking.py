"""team_context derives and persists world-process start epochs (case-3a152890).

Restart epochs were recomputed by hand from updatedAt minus uptimeSec across shifts and the
arithmetic was misread twice; team_context must derive the epoch itself, fold reading jitter
into one epoch, append a history entry on a real restart, stay quiet on stale or malformed
records, and keep the reported history bounded.
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


def world_section(updated_at, uptime, fresh=True):
    return {'fresh': fresh, 'timestamp': updated_at,
            'data': {'world': {'updatedAt': updated_at, 'uptimeSec': uptime}}}


class EpochTrackingTests(unittest.TestCase):
    def contexts(self, *sections):
        registered = {}

        class App:
            def tool(self):
                def deco(fn):
                    registered[fn.__name__] = fn
                    return fn
                return deco

        pending = [{'snapshots': {'world': section}} for section in sections]
        fake = N(snapshot=lambda: pending.pop(0))
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        with patch.dict(sys.modules, {'operations_team_mcp': N(OperationsTools=lambda actor: fake)}):
            mcp.register_team_tools(App(), 'operations:mc-god', state=Path(tmp.name))
            return [registered['team_context']() for _ in sections]

    def test_first_reading_derives_epoch_with_quiet_notice(self):
        result = self.contexts(world_section('2026-09-14T11:04:45.516Z', 7036))[0]
        self.assertEqual(result['world']['worldProcessEpoch'], '2026-09-14T09:07:29.516000Z')
        self.assertEqual(result['world']['worldProcessEpochs'], [
            {'startedAt': '2026-09-14T09:07:29.516000Z', 'firstObserved': '2026-09-14T11:04:45.516000Z',
             'lastObserved': '2026-09-14T11:04:45.516000Z', 'reads': 1}])
        self.assertNotIn('restarted near', result['notice'])

    def test_reading_jitter_folds_into_the_same_epoch(self):
        second = self.contexts(world_section('2026-09-14T11:04:45Z', 7036),
                               world_section('2026-09-14T11:09:45Z', 7337))[1]
        history = second['world']['worldProcessEpochs']
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['reads'], 2)
        self.assertEqual(history[0]['lastObserved'], '2026-09-14T11:09:45Z')
        self.assertNotIn('restarted near', second['notice'])

    def test_restart_appends_history_entry_and_notice(self):
        second = self.contexts(world_section('2026-09-14T11:04:45Z', 7036),
                               world_section('2026-09-14T12:04:45Z', 600))[1]
        history = second['world']['worldProcessEpochs']
        self.assertEqual(len(history), 2)
        self.assertEqual(history[-1]['startedAt'], '2026-09-14T11:54:45Z')
        self.assertEqual(second['world']['worldProcessEpoch'], '2026-09-14T11:54:45Z')
        notice = second['notice']
        self.assertIn('restarted near', notice)
        self.assertIn('RestartCount/StartedAt', notice)

    def test_stale_or_malformed_world_records_stay_quiet(self):
        for section in (world_section('2026-09-14T11:04:45Z', 7036, fresh=False),
                        {'fresh': True, 'data': 'not-a-dict'},
                        {'fresh': True, 'data': {'world': {'updatedAt': '2026-09-14T11:04:45Z'}}},
                        {'fresh': True, 'data': {'world': {'uptimeSec': 7036}}},
                        {'fresh': True, 'data': {'world': {'updatedAt': 'not-a-time', 'uptimeSec': 5}}},
                        {'fresh': True, 'data': {'world': {'updatedAt': '2026-09-14T11:04:45Z',
                                                           'uptimeSec': '7036'}}},
                        {'fresh': True, 'data': {'world': {'updatedAt': '2026-09-14T11:04:45Z',
                                                           'uptimeSec': -1}}}):
            world = self.contexts(section)[0]['world']
            self.assertNotIn('worldProcessEpoch', world)
            self.assertNotIn('worldProcessEpochs', world)
        stale_then_missing = self.contexts(world_section('2026-09-14T11:04:45Z', 7036, fresh=False),
                                           {'fresh': True, 'data': {}})[1]['world']
        self.assertNotIn('worldProcessEpoch', stale_then_missing)

    def test_reported_history_stays_bounded(self):
        base = datetime(2026, 9, 14, 1, 0, tzinfo=timezone.utc)
        stamps = [(base + timedelta(hours=i)).isoformat().replace('+00:00', 'Z') for i in range(41)]
        history = self.contexts(*[world_section(stamp, 60) for stamp in stamps])[-1]['world']['worldProcessEpochs']
        self.assertEqual(len(history), 8)
        self.assertEqual(history[-1]['startedAt'], '2026-09-15T16:59:00Z')
        self.assertEqual(history[0]['startedAt'], '2026-09-15T09:59:00Z')
        self.assertEqual(history[-1]['reads'], 1)


if __name__ == '__main__':
    unittest.main()
