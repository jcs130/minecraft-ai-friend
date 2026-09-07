"""Clock boundaries for the host reader of the NPC's atomic health snapshots."""
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'ops/health/health_mon.py'
SPEC = importlib.util.spec_from_file_location('guild_health_clock_test_target', SOURCE)
HEALTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HEALTH)


class GuildHealthClockTests(unittest.TestCase):
    NOW = 1_788_744_000.0

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.data = self.project / 'server/mcdata'
        self.data.mkdir(parents=True)
        for patcher in (patch.object(HEALTH, 'PROJECT', self.project),
                        patch.object(HEALTH.time, 'time', return_value=self.NOW)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def probe(self, age=0, *, guild_thread=True, **overrides):
        record = {'last_success_at': self.NOW - age, 'updated_at': self.NOW,
                  'basic_quests': True, 'autogenerate': False,
                  'board_date': datetime.now().strftime('%Y-%m-%d'),
                  'error_type': None, 'task_counts': {}}
        record.update(overrides)
        (self.data / 'guild-health.json').write_text(json.dumps(record), encoding='utf-8')
        (self.data / 'npc-health.json').write_text(
            json.dumps({'threads': {'guild': guild_thread}}), encoding='utf-8')
        return HEALTH.probe_guild()

    def test_measured_container_lead_is_healthy_and_visible(self):
        result = self.probe(age=-3.2)
        self.assertTrue(result['ok'])
        self.assertEqual(result['age_seconds'], -3.2)
        self.assertEqual(result['clock_skew_tolerance_seconds'], 5)

    def test_future_clock_boundary_is_bounded(self):
        self.assertTrue(self.probe(age=-5)['ok'])
        self.assertFalse(self.probe(age=-5.001)['ok'])
        self.assertFalse(self.probe(age=-3600)['ok'])

    def test_original_expiry_boundary_is_unchanged(self):
        for age in (0, 30, 99.999):
            with self.subTest(age=age):
                self.assertTrue(self.probe(age=age)['ok'])
        for age in (100, 100.001, 3600):
            with self.subTest(age=age):
                self.assertFalse(self.probe(age=age)['ok'])

    def test_updated_snapshot_does_not_hide_stale_last_success(self):
        self.assertFalse(self.probe(age=101, updated_at=self.NOW)['ok'])

    def test_skew_tolerance_does_not_bypass_other_health_failures(self):
        for overrides in ({'guild_thread': False}, {'error_type': 'OSError'},
                          {'basic_quests': False}, {'autogenerate': True},
                          {'board_date': '2000-01-01'}):
            with self.subTest(overrides=overrides):
                self.assertFalse(self.probe(age=-3, **overrides)['ok'])

    def test_missing_or_invalid_success_timestamp_fails(self):
        for value in (None, 'invalid', float('nan'), float('inf'), float('-inf')):
            with self.subTest(value=value):
                self.assertFalse(self.probe(last_success_at=value)['ok'])
        (self.data / 'guild-health.json').write_text('{}', encoding='utf-8')
        self.assertFalse(HEALTH.probe_guild()['ok'])


if __name__ == '__main__':
    unittest.main()
