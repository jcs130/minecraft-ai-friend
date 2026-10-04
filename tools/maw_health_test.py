"""The society probe reports its isolated service, never historical Docker health."""
import importlib.util
import io
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('maw_health_monitor', Path(__file__).resolve().parents[1] / 'world/ops/health/health_mon.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class SocietyHealthTests(unittest.TestCase):
    def values(self):
        supervisor = {'healthy': True, 'heartbeatEpoch': time.time(), 'paused': False, 'services': [
            {'id': name, 'pid': index + 10, 'ready': True, 'host': '127.0.0.1', 'port': row['port']}
            for index, (name, row) in enumerate(health.SOCIETY_SERVICE_MANIFEST.items())]}
        viewer = {'ready': True, 'identity': {'player': 'MawExplorer'}, 'agent': {'details': {
            'username': 'MawExplorer', 'online': True, 'mode': 'acting', 'native': {'failed': False, 'packets': 15}}}}
        return supervisor, viewer

    def probe(self, values):
        with patch.object(health.urllib.request, 'urlopen', side_effect=[io.BytesIO(json.dumps(value).encode()) for value in values]):
            return health.probe_society_service()

    def test_current_identity_and_native_stream_are_required(self):
        values = self.values()
        self.assertTrue(self.probe(values)['ok'])
        values[1]['identity']['player'] = 'AnotherPlayer'
        self.assertFalse(self.probe(values)['ok'])

    def test_stale_supervisor_or_paused_autonomy_is_not_success(self):
        values = self.values()
        values[0]['heartbeatEpoch'] -= 60
        self.assertFalse(self.probe(values)['ok'])
        values = self.values()
        values[1]['agent']['details']['mode'] = 'paused_unknown'
        self.assertFalse(self.probe(values)['ok'])

    def test_unavailable_endpoint_remains_explicitly_false(self):
        with patch.object(health.urllib.request, 'urlopen', side_effect=OSError('offline')):
            report = health.probe_society_service()
        self.assertFalse(report['ok'])
        self.assertIn('offline', report['error'])


if __name__ == '__main__':
    unittest.main()
