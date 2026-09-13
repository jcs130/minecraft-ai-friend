"""An offline command-service report must not hide a dead current service."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('player_service_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class PlayerServiceHealth(unittest.TestCase):
    def probe(self, *, age=10, changes=None, behavior=True, sources=True, malformed=False, capability=...):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root/'server/world-data/world-heartbeat.json'
            target.parent.mkdir(parents=True)
            service = {'schema': 1, 'ready': True, 'queueEnabled': True, 'modelRequired': False}
            service.update(changes or {})
            if capability is not ...:
                service = capability
            target.write_text('invalid' if malformed else json.dumps({
                'ts': (1000-age)*1000, 'playerCommands': service}), encoding='utf-8')
            with patch.object(health, 'PROJECT', root), patch.object(health.time, 'time', return_value=1000), \
                    patch.object(health, 'probe_recorded_behavior', return_value={'ok': behavior}), \
                    patch.object(health, 'probe_source_record', return_value={'ok': sources}):
                return health.probe_player_commands()

    def test_live_service_requires_both_behavior_and_matching_sources(self):
        self.assertTrue(self.probe()['ok'])
        self.assertFalse(self.probe(behavior=False)['ok'])
        self.assertFalse(self.probe(sources=False)['ok'])

    def test_historical_success_cannot_hide_stale_or_missing_capabilities(self):
        for kwargs in [{'age': 180}, {'age': -6}, {'changes': {'schema': None}},
                       {'changes': {'ready': False}}, {'changes': {'queueEnabled': False}},
                       {'changes': {'modelRequired': True}}, {'malformed': True}]:
            with self.subTest(kwargs=kwargs):
                self.assertFalse(self.probe(**kwargs)['ok'])

    def test_small_measured_clock_skew_is_tolerated(self):
        self.assertTrue(self.probe(age=-3)['ok'])

    def test_non_object_capabilities_fail_closed_without_crashing(self):
        for capability in ([], None, 'ready', True, 1):
            with self.subTest(capability=capability):
                result = self.probe(capability=capability)
                self.assertFalse(result['ok'])
                self.assertFalse(result['live'])
                self.assertTrue(result['behavior']['ok'])

    def test_schema_requires_integer_one_and_never_boolean_or_float(self):
        for schema in (True, False, '1', 1.0, None, 2):
            with self.subTest(schema=schema):
                self.assertFalse(self.probe(changes={'schema': schema})['ok'])
        self.assertTrue(self.probe(changes={'schema': 1})['ok'])


if __name__ == '__main__':
    unittest.main()
