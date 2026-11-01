import hashlib
from pathlib import Path
import tempfile
import unittest
from manage import ReadinessTracker
from prepare import retained_components


class NativeMaintenanceTests(unittest.TestCase):
    def test_done_does_not_report_native_ready_early(self):
        tracker = ReadinessTracker([{'filename': 'maw-native263-0.1.0.jar'}])
        self.assertFalse(tracker.observe('Done (0.8s)!'))
        self.assertTrue(tracker.observe('[MAW Native] registry ready: states=38417'))

    def test_native_export_alone_is_not_world_ready(self):
        tracker = ReadinessTracker([{'filename': 'maw-native263-0.1.0.jar'}])
        self.assertFalse(tracker.observe('[MAW Native] registry ready: states=38417'))
        self.assertTrue(tracker.observe('Done (0.8s)!'))

    def test_original_non_native_deployment_still_becomes_ready(self):
        self.assertTrue(ReadinessTracker([]).observe('Done (0.8s)!'))

    def test_optional_components_survive_and_tampering_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            server, client = Path(tmp)/'server', Path(tmp)/'client'
            (server/'mods').mkdir(parents=True); client.mkdir()
            file = server/'mods/maw-native263-0.1.0.jar'; file.write_bytes(b'fixture')
            entry = {'filename': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'sides': ['server']}
            config = {'server': str(server), 'client': str(client), 'localComponents': [entry]}
            self.assertEqual(retained_components(config, server, client), [entry])
            self.assertEqual(retained_components(config, Path(tmp)/'different', client), [])
            file.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'differs'): retained_components(config, server, client)


if __name__ == '__main__': unittest.main()
