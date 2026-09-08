"""Schema-2 recorder health uses deployed bytes and report sources, never runtime/."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('recording_build_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)

SOURCES = ['world/god-voice-src/'+name for name in (
    'dev/god/godvoice/MicCapture.java', 'dev/god/godvoice/CaptureInterval.java',
    'build.py', 'source-origin.json', 'tests/CaptureIntervalTest.java', 'META-INF/neoforge.mods.toml')]
PRESERVED = ['dev/god/godvoice/'+name+'.class' for name in (
    'GodVoiceLog', 'GodVoiceMod', 'GodVoicePlugin', 'TtsQueueWatcher')]


class RecordingBuildHealth(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-recorder-health-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.report_path = self.root/'reports/recording-build.json'
        self.paths = [self.root/name for name in (
            'server/mc/mods/god-voice-0.1.0.jar', 'client/mods/god-voice-0.1.0.jar')]
        for path in self.paths:
            path.parent.mkdir(parents=True)
            path.write_bytes(b'fixture for exact recorder artifact identity')
        rows = []
        for name in SOURCES:
            path = self.root/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('// offline recorder source identity fixture\n', encoding='utf-8')
            rows.append({'path': name, 'sha256': self.sha(path)})
        self.report = {
            'ok': True, 'mod_id': 'godvoice', 'recording_schema': 2,
            'minecraft': '1.21.1', 'neoforge': '21.1.248',
            'sha256': self.sha(self.paths[0]), 'comparison_server_jar_sha256': '0'*64,
            'deployed_path': 'server/mc/mods/god-voice-0.1.0.jar',
            'source_files': rows, 'recording_allowlist_expanded': False,
            'unchanged_server_bytecode': {name: True for name in PRESERVED},
            'tests': {'CaptureIntervalTest': {'ok': True, 'assertions': 15}},
        }
        self.write(self.report)
        for patcher in (patch.object(health, 'PROJECT', self.root),
                        patch.object(health.subprocess, 'run', side_effect=AssertionError('No Docker')),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP'))):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def write(self, data):
        self.report_path.parent.mkdir(parents=True, exist_ok=True)
        self.report_path.write_text(json.dumps(data), encoding='utf-8')

    def probe(self):
        return health.probe_voice_recording()

    def test_matching_dual_installation_and_recorded_build_pass_without_runtime(self):
        self.assertFalse((self.root/'runtime').exists())
        result = self.probe()
        self.assertTrue(result['ok'])
        self.assertEqual(result['recording_schema'], 2)
        self.assertEqual(result['previous_sha256'], '0'*64)
        self.assertEqual(result['current_sha256'], self.sha(self.paths[0]))
        self.assertTrue(result['preserved_playback_and_entrypoints'])
        self.assertTrue(result['capture_interval_tests'])

    def test_schema_identity_destination_and_allowlist_contract_required(self):
        changes = [
            {'ok': 1}, {'ok': False}, {'mod_id': 'another_mod'}, {'recording_schema': 1},
            {'recording_schema': True}, {'recording_schema': '2'}, {'recording_schema': 2.0},
            {'minecraft': '1.21'}, {'neoforge': '21.1.73'}, {'deployed_path': '../outside.jar'},
            {'deployed_path': None}, {'recording_allowlist_expanded': True},
            {'recording_allowlist_expanded': 0}, {'recording_allowlist_expanded': None},
        ]
        for change in changes:
            with self.subTest(change=change):
                self.write({**self.report, **change})
                self.assertFalse(self.probe()['ok'])

    def test_before_and_after_hashes_must_be_complete_sha256_values(self):
        for key in ('sha256', 'comparison_server_jar_sha256'):
            for value in (None, '', 1, 'g'*64, 'a'*63, 'a'*65):
                with self.subTest(key=key, value=value):
                    self.write({**self.report, key: value})
                    self.assertFalse(self.probe()['ok'])

    def test_each_original_playback_and_entrypoint_class_must_be_preserved(self):
        for name in PRESERVED:
            for value in (False, 1, 'true', None):
                with self.subTest(name=name, value=value):
                    values = {**self.report['unchanged_server_bytecode'], name: value}
                    self.write({**self.report, 'unchanged_server_bytecode': values})
                    self.assertFalse(self.probe()['ok'])
            values = {key: value for key, value in self.report['unchanged_server_bytecode'].items() if key != name}
            self.write({**self.report, 'unchanged_server_bytecode': values})
            self.assertFalse(self.probe()['ok'])

    def test_both_actual_installed_jars_must_match_current_build(self):
        for path in self.paths:
            with self.subTest(path=path.name):
                before = path.read_bytes()
                path.write_bytes(b'old recorder without packet bounds')
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertEqual(result['mismatches'], [path.relative_to(self.root).as_posix()])
                path.unlink()
                self.assertFalse(self.probe()['ok'])
                path.write_bytes(before)
                self.assertTrue(self.probe()['ok'])

    def test_current_capture_source_drift_blocks_historical_success(self):
        path = self.root/SOURCES[0]
        path.write_text('// changed after build\n', encoding='utf-8')
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertEqual(result['sources']['mismatches'], [SOURCES[0]])
        self.assertEqual(result['mismatches'], [])

    def test_incomplete_source_inventory_cannot_cover_unrelated_green_files(self):
        for source in SOURCES:
            with self.subTest(source=source):
                self.write({**self.report, 'source_files': [row for row in self.report['source_files'] if row['path'] != source]})
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertTrue(result['sources']['ok'])
                self.assertEqual(result['missing_sources'], [source])

    def test_missing_malformed_or_partial_report_fails_closed(self):
        for raw in ['{partial', 'null', '[]', '{}']:
            self.report_path.write_text(raw, encoding='utf-8')
            self.assertFalse(self.probe()['ok'])
        self.report_path.unlink()
        self.assertFalse(self.probe()['ok'])

    def test_interval_regression_result_is_required(self):
        for value in [None, [], {}, {'CaptureIntervalTest': None}, {'CaptureIntervalTest': {}},
                      {'CaptureIntervalTest': {'ok': 1, 'assertions': 15}},
                      {'CaptureIntervalTest': {'ok': True, 'assertions': 14}},
                      {'CaptureIntervalTest': {'ok': True, 'assertions': True}},
                      {'CaptureIntervalTest': {'ok': True, 'assertions': '15'}}]:
            with self.subTest(value=value):
                self.write({**self.report, 'tests': value})
                self.assertFalse(self.probe()['ok'])

    def test_panel_smoke_requires_current_schema2_recorder(self):
        with patch.object(health, 'probe_panel_http', return_value={'ok': True}), \
                patch.object(health, 'probe_management', return_value={'ok': True}), \
                patch.object(health, 'probe_operations_team', return_value={'ok': True}), \
                patch.object(health, 'probe_game_qwenpaw', return_value={'ok': True}), \
                patch.object(health, 'probe_survivor', return_value={'ok': True}), \
                patch.object(health, 'probe_model_routing', return_value={'ok': True}), \
                patch.object(health, 'probe_recorded_behavior', return_value={'ok': True}), \
                patch.object(health, 'probe_source_record', return_value={'ok': True}), \
                patch.object(health, 'probe_player_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_staff', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_boundary_deployment', return_value={'ok': True}), \
                patch.object(health, 'probe_skillbar_editor', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_client', return_value={'ok': True}):
            self.assertTrue(health.probe_panel_smoke()['ok'])
            self.write({**self.report, 'recording_schema': 1})
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertFalse(result['voice_recording']['ok'])
            self.assertTrue(result['voice_commands']['ok'])


if __name__ == '__main__':
    unittest.main()
